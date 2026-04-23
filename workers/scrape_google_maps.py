"""
Worker: scrape_google_maps
Adapted from execution/scrape_google_maps.py
Scrapes business leads from Google Maps via RapidAPI Maps Data API.
Writes results directly to ninja.leads via Supabase.

Job config:
  - keywords: list of search terms
  - locations_file: path to CSV (default: data/us_locations.csv)
  - max_leads: target number of leads (default: 1000)
  - concurrent: number of concurrent requests (default: 20)
"""

import csv
import os
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Set
from urllib.parse import urlparse

import requests

from base import SupabaseWorkerBase

logger = logging.getLogger(__name__)

API_URL = "https://maps-data.p.rapidapi.com/searchmaps.php"
RESULTS_PER_REQUEST = 20
BATCH_SIZE = 50  # Write to Supabase every N leads


class ScrapeGoogleMapsWorker(SupabaseWorkerBase):
    def run(self):
        keywords = self.config.get("keywords", [])
        locations_file = self.config.get("locations_file", "data/us_locations.csv")
        max_leads = self.config.get("max_leads", 1000)
        concurrent = self.config.get("concurrent", 20)

        api_key = self.get_api_key("rapidapi_maps")
        if not api_key:
            self.fail("RapidAPI Maps Data API key not configured")
            return

        # Load locations
        locations = self._load_locations(locations_file)
        if not locations:
            self.fail(f"No locations loaded from {locations_file}")
            return

        logger.info(f"Scraping: {len(keywords)} keywords x {len(locations)} locations, "
                     f"target: {max_leads} leads, concurrent: {concurrent}")

        seen_place_ids: Set[str] = set()
        all_leads: List[Dict] = []
        total_searches = len(keywords) * len(locations)
        searches_done = 0

        for keyword in keywords:
            if len(all_leads) >= max_leads:
                break

            # Build search tasks
            tasks = []
            for loc in locations:
                search_query = f"{keyword} in {loc['city']}, {loc['state']} {loc['zip']}"
                tasks.append((search_query, keyword, loc))

            # Process in small batches to avoid submitting thousands of futures
            batch_submit_size = max(concurrent * 2, 10)  # Submit 10 tasks at a time
            task_idx = 0

            while task_idx < len(tasks) and len(all_leads) < max_leads:
                batch_end = min(task_idx + batch_submit_size, len(tasks))
                batch_tasks = tasks[task_idx:batch_end]
                task_idx = batch_end

                with ThreadPoolExecutor(max_workers=concurrent) as executor:
                    futures = {}
                    for search_query, kw, loc in batch_tasks:
                        future = executor.submit(
                            self._search_maps, api_key, search_query, kw, loc
                        )
                        futures[future] = (search_query, kw, loc)

                    for future in as_completed(futures):
                        searches_done += 1
                        try:
                            leads = future.result()
                            for lead in leads:
                                place_id = lead.get("place_id", "")
                                if place_id and place_id in seen_place_ids:
                                    continue
                                if place_id:
                                    seen_place_ids.add(place_id)
                                all_leads.append(lead)

                                # Batch write
                                if len(all_leads) % BATCH_SIZE == 0:
                                    self._flush_batch(all_leads[-BATCH_SIZE:])
                                    self.update_progress(len(all_leads), max_leads,
                                                         searches=searches_done,
                                                         total_searches=total_searches)
                        except Exception as e:
                            logger.warning(f"Search error: {e}")

                        if len(all_leads) >= max_leads:
                            break

                logger.info(f"Batch done: {len(all_leads)} leads from {searches_done} searches")

        # Flush remaining leads
        remaining = len(all_leads) % BATCH_SIZE
        if remaining > 0:
            self._flush_batch(all_leads[-remaining:])

        self.update_progress(len(all_leads), len(all_leads))
        self.complete({
            "total_leads": len(all_leads),
            "unique_places": len(seen_place_ids),
            "keywords": keywords,
            "searches_completed": searches_done,
        })
        logger.info(f"Scrape complete: {len(all_leads)} leads from {searches_done} searches")

    def _search_maps(self, api_key: str, query: str, keyword: str,
                     location: Dict) -> List[Dict]:
        """Execute a single Google Maps search and parse results."""
        headers = {
            "x-rapidapi-key": api_key,
            "x-rapidapi-host": "maps-data.p.rapidapi.com",
        }
        params = {"query": query, "limit": RESULTS_PER_REQUEST, "lang": "en", "country": "us"}

        try:
            resp = requests.get(API_URL, headers=headers, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.debug(f"API error for '{query}': {e}")
            return []

        results = data.get("data", [])
        leads = []
        for item in results:
            lead = {
                "company_name": item.get("name", ""),
                "address": item.get("full_address", ""),
                "city": location["city"],
                "state": location["state"],
                "zip": location.get("zip", ""),
                "country": location.get("country", "United States"),
                "phone": item.get("phone_number", ""),
                "company_website": item.get("website", ""),
                "rating": item.get("rating"),
                "reviews": item.get("review_count"),
                "category": ", ".join(item.get("types", [])) if item.get("types") else "",
                "place_id": item.get("place_id", ""),
                "latitude": item.get("latitude"),
                "longitude": item.get("longitude"),
                "search_keyword": keyword,
                "search_location": f"{location['city']}, {location['state']}",
                "source": "google_maps",
                "ice_status": "pending",
            }
            # Extract domain
            website = lead.get("company_website", "")
            if website:
                try:
                    parsed = urlparse(website if "://" in website else f"http://{website}")
                    lead["domain"] = parsed.netloc.replace("www.", "")
                except Exception:
                    pass
            leads.append(lead)

        return leads

    def _flush_batch(self, batch: List[Dict]):
        """Write a batch of leads to Supabase."""
        if not batch or not self.campaign_id:
            return
        try:
            self.write_leads_no_conflict(self.campaign_id, batch)
        except Exception as e:
            logger.warning(f"Batch write error (trying individual): {e}")
            for lead in batch:
                try:
                    self.write_leads_no_conflict(self.campaign_id, [lead])
                except Exception:
                    pass

    def _load_locations(self, file_path: str) -> List[Dict[str, str]]:
        """Load locations from CSV file."""
        locations = []
        seen = set()

        if not os.path.exists(file_path):
            logger.error(f"Locations file not found: {file_path}")
            return []

        with open(file_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                city = row.get("City", "").strip()
                state = row.get("State", "").strip()
                zip_code = row.get("Zip", "").strip()
                country = row.get("Country", "USA").strip()

                if not city or not state:
                    continue

                key = f"{city}|{state}|{zip_code}".lower()
                if key in seen:
                    continue

                seen.add(key)
                locations.append({
                    "city": city,
                    "state": state,
                    "zip": zip_code,
                    "country": country,
                })

        return locations
