"""
Worker: find_decision_makers
Adapted from execution/find_decision_makers.py
Finds decision makers by crawling company about/contact/team pages
and extracting owner/founder/CEO info via OpenAI.

Job config:
  - max_leads: max leads to process (default: 100)
  - include_existing: process leads with existing DM info (default: false)
"""

import json
import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, urljoin

import requests

from base import SupabaseWorkerBase

logger = logging.getLogger(__name__)

# Pages to crawl on each website (in priority order)
ABOUT_PATHS = [
    "/about", "/about-us", "/team", "/our-team",
    "/leadership", "/management", "/staff",
    "/contact", "/contact-us",
]


class FindDecisionMakersWorker(SupabaseWorkerBase):
    def run(self):
        max_leads = self.config.get("max_leads", 100)
        include_existing = self.config.get("include_existing", False)
        validated_only = self.config.get("validated_only", True)

        openai_key = self.get_api_key("openai")
        if not openai_key:
            self.fail("OpenAI API key not configured")
            return

        # Fetch leads needing decision maker info
        # Build query directly to apply all filters at the DB level (including JSONB)
        query = self.db.from_("leads").select("*").eq(
            "campaign_id", self.campaign_id
        ).limit(max_leads)

        if not include_existing:
            query = query.is_("decision_maker_name", "null")

        # Filter for validated leads at the DB level so LIMIT works correctly
        if validated_only:
            query = query.contains("enrichment_status", {"website_validated": True})

        result = query.execute()
        leads = result.data or []
        logger.info(f"Fetched {len(leads)} leads (validated_only={validated_only}, include_existing={include_existing})")

        leads = [l for l in leads if l.get("company_website") or l.get("domain")]

        if not leads:
            msg = "No validated leads found. Run clean & validate first." if validated_only else "No leads need decision maker enrichment"
            self.complete({"processed": 0, "message": msg})
            return

        logger.info(f"Processing {len(leads)} leads for decision maker enrichment")
        self.update_progress(0, len(leads))

        processed = 0
        found = 0

        for lead in leads:
            processed += 1
            website = lead.get("company_website") or lead.get("domain", "")
            if not website.startswith("http"):
                website = f"https://{website}"

            # Strip tracking params / paths from Google Maps URLs to get base domain
            base_url = self._get_base_url(website)

            dm_info = self._find_from_website(base_url, openai_key)

            if dm_info:
                self.update_lead(lead["id"], {
                    **dm_info,
                    "enrichment_status": {
                        **(lead.get("enrichment_status") or {}),
                        "find_decision_makers": "done",
                    },
                })
                found += 1
                logger.info(f"  Found: {dm_info.get('decision_maker_name')} at {lead.get('company_name', '?')}")
            else:
                self.update_lead(lead["id"], {
                    "enrichment_status": {
                        **(lead.get("enrichment_status") or {}),
                        "find_decision_makers": "not_found",
                    },
                })

            if processed % 5 == 0:
                self.update_progress(processed, len(leads), found=found)

        self.update_progress(processed, len(leads), found=found)
        self.complete({"processed": processed, "found": found, "total": len(leads)})

    def _get_base_url(self, website: str) -> str:
        """Extract the base URL (scheme + domain) from a full URL."""
        try:
            parsed = urlparse(website)
            return f"{parsed.scheme}://{parsed.netloc}"
        except Exception:
            return website

    def _find_from_website(self, base_url: str, openai_key: str) -> Optional[Dict]:
        """Crawl about/team/contact pages and extract decision maker via OpenAI."""

        # First try the homepage itself (some small businesses list the owner)
        homepage_content = self._fetch_page(base_url)

        # Then try about/team pages
        page_contents = []
        if homepage_content:
            page_contents.append((base_url, homepage_content))

        for path in ABOUT_PATHS:
            url = urljoin(base_url, path)
            content = self._fetch_page(url)
            if content and len(content) > 500:
                page_contents.append((url, content))
                # Stop after finding 2 good pages to limit API calls
                if len(page_contents) >= 3:
                    break

        if not page_contents:
            return None

        # Combine page content and ask OpenAI to extract decision maker
        combined = ""
        source_urls = []
        for page_url, content in page_contents:
            combined += f"\n--- Page: {page_url} ---\n{content[:4000]}\n"
            source_urls.append(page_url)

        result = self._extract_with_openai(combined[:10000], openai_key)
        if result:
            # Store the actual pages that were crawled as the source
            result["decision_maker_source"] = ", ".join(source_urls)
        return result

    def _fetch_page(self, url: str) -> Optional[str]:
        """Fetch a web page and return its text content."""
        try:
            resp = requests.get(
                url, timeout=10, allow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
            )
            if resp.status_code == 200 and len(resp.text) > 200:
                # Strip HTML tags for a rough text extraction
                import re
                text = re.sub(r'<script[^>]*>.*?</script>', '', resp.text, flags=re.DOTALL)
                text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
                text = re.sub(r'<[^>]+>', ' ', text)
                text = re.sub(r'\s+', ' ', text).strip()
                return text
        except Exception:
            pass
        return None

    def _extract_with_openai(self, page_content: str, openai_key: str) -> Optional[Dict]:
        """Use OpenAI to extract decision maker info from combined page content."""
        try:
            resp = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are extracting the owner, founder, or CEO of a company from their website content. "
                                "Look for names associated with titles like Owner, Founder, CEO, President, Managing Director, Principal. "
                                "Return JSON: {\"name\": \"Full Name\", \"title\": \"Their Title\", \"linkedin\": \"linkedin URL if found\"}\n"
                                "If no decision maker can be identified, return: {\"name\": null}\n"
                                "Only return the MOST senior person. Prefer Owner/Founder over other titles."
                            ),
                        },
                        {"role": "user", "content": page_content},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1,
                },
                timeout=30,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            data = json.loads(content)

            if data and data.get("name"):
                return {
                    "decision_maker_name": data["name"],
                    "decision_maker_title": data.get("title", ""),
                    "decision_maker_linkedin": data.get("linkedin", ""),
                    "decision_maker_confidence": "medium",
                }
        except Exception as e:
            logger.debug(f"OpenAI extraction error: {e}")

        return None
