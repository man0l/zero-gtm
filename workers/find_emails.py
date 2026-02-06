"""
Worker: find_emails
Adapted from execution/find_emails.py
Enriches leads with emails, phones, and social profiles via OpenWeb Ninja API.
Writes results directly to ninja.leads via Supabase.

Job config:
  - max_leads: max leads to process (default: 100)
  - include_existing: process leads that already have email (default: false)
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests

from base import SupabaseWorkerBase

logger = logging.getLogger(__name__)

API_URL = "https://api.openwebninja.com/website-contacts-scraper/scrape-contacts"
CONCURRENT_REQUESTS = 5  # 5 per second as per API limits


class FindEmailsWorker(SupabaseWorkerBase):
    def run(self):
        max_leads = self.config.get("max_leads", 100)
        include_existing = self.config.get("include_existing", False)
        validated_only = self.config.get("validated_only", True)

        api_key = self.get_api_key("openwebninja")
        if not api_key:
            self.fail("OpenWeb Ninja API key not configured")
            return

        # Fetch leads needing email enrichment
        # Build query directly to apply all filters at the DB level (including JSONB)
        query = self.db.from_("leads").select("*").eq(
            "campaign_id", self.campaign_id
        ).limit(max_leads)

        if not include_existing:
            query = query.is_("email", "null")

        # Filter for validated leads at the DB level so LIMIT works correctly
        if validated_only:
            query = query.contains("enrichment_status", {"website_validated": True})

        result = query.execute()
        leads = result.data or []
        logger.info(f"Fetched {len(leads)} leads (validated_only={validated_only}, include_existing={include_existing})")

        # Filter to leads with websites
        leads = [l for l in leads if l.get("company_website") or l.get("domain")]

        if not leads:
            msg = "No validated leads with websites found. Run clean & validate first." if validated_only else "No leads with websites found"
            self.complete({"processed": 0, "message": msg})
            return

        logger.info(f"Processing {len(leads)} leads for email enrichment")
        self.update_progress(0, len(leads))

        processed = 0
        enriched = 0

        with ThreadPoolExecutor(max_workers=CONCURRENT_REQUESTS) as executor:
            futures = {}
            for lead in leads:
                website = lead.get("company_website") or lead.get("domain", "")
                if not website:
                    continue
                future = executor.submit(self._scrape_contacts, api_key, website)
                futures[future] = lead

            for future in as_completed(futures):
                lead = futures[future]
                processed += 1

                try:
                    contacts = future.result()
                    if contacts:
                        updates = self._map_contacts(contacts)
                        if updates:
                            self.update_lead(lead["id"], updates)
                            enriched += 1
                except Exception as e:
                    logger.warning(f"Error enriching {lead.get('company_name', '?')}: {e}")

                if processed % 10 == 0:
                    self.update_progress(processed, len(leads), enriched=enriched)

        self.update_progress(processed, len(leads), enriched=enriched)
        self.complete({"processed": processed, "enriched": enriched, "total": len(leads)})

    def _scrape_contacts(self, api_key: str, website: str) -> Optional[Dict]:
        """Call OpenWeb Ninja API to scrape contacts from a website."""
        # Ensure URL has protocol
        if not website.startswith("http"):
            website = f"https://{website}"

        headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        params = {"query": website}

        try:
            resp = requests.get(API_URL, headers=headers, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            # API wraps results in {"status": "OK", "data": [...]}
            if data.get("status") == "OK" and data.get("data"):
                return data["data"][0]  # First result
            return None
        except Exception as e:
            logger.debug(f"API error for {website}: {e}")
            return None

    def _map_contacts(self, contacts: Dict) -> Dict[str, Any]:
        """Map OpenWeb Ninja response to lead fields."""
        updates: Dict[str, Any] = {}

        # Emails - API returns [{value: "email@...", sources: [...]}]
        emails = contacts.get("emails", [])
        if emails:
            email_values = []
            for e in emails:
                if isinstance(e, dict):
                    email_values.append(e.get("value", ""))
                elif isinstance(e, str):
                    email_values.append(e)
            if email_values:
                updates["email"] = email_values[0]
                updates["emails"] = email_values

        # Phones - API returns [{value: "123...", sources: [...]}]
        phones = contacts.get("phone_numbers", contacts.get("phones", []))
        if phones:
            phone_values = []
            for p in phones:
                if isinstance(p, dict):
                    phone_values.append(p.get("value", ""))
                elif isinstance(p, str):
                    phone_values.append(p)
            if phone_values:
                updates["phone"] = phone_values[0]
                updates["phones"] = phone_values

        # Social media - API returns [{platform: "facebook", url: "...", ...}]
        socials = contacts.get("social_media", contacts.get("socials", []))
        if isinstance(socials, list):
            for s in socials:
                if isinstance(s, dict):
                    platform = s.get("platform", "").lower()
                    url = s.get("url", s.get("value", ""))
                    if "facebook" in platform:
                        updates["social_facebook"] = url
                    elif "instagram" in platform:
                        updates["social_instagram"] = url
                    elif "linkedin" in platform:
                        updates["social_linkedin"] = url
                    elif "twitter" in platform or "x.com" in str(url):
                        updates["social_twitter"] = url
        elif isinstance(socials, dict):
            for platform, url in socials.items():
                key = f"social_{platform.lower()}"
                if key in ("social_facebook", "social_instagram", "social_linkedin", "social_twitter"):
                    updates[key] = url

        if updates:
            updates["enrichment_status"] = {
                "find_emails": "done",
            }

        return updates
