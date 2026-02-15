---
layout: default
title: ZeroGTM + Google Sheets Integration
description: "Connect Google Sheets to ZeroGTM. Enrich leads from spreadsheets. Export and sync. Lead enrichment without code."
permalink: /integrations/google-sheets/
---

# ZeroGTM + Google Sheets Integration

Use **Google Sheets** as a source and destination for **ZeroGTM** lead enrichment. Pull leads from a sheet, run the pipeline, and export enriched data back—no code required for basic flows.

---

## How to connect Google Sheets with ZeroGTM

1. **Export from Sheets** — Export your sheet as CSV (or use a connector/n8n if you run automation). Columns should include at least company name or website (and optionally location) so the pipeline can find emails and DMs.
2. **Run the pipeline** — Upload or sync the CSV into ZeroGTM. Run contact mining, DM identification, and email verification as jobs from the mobile app or workers.
3. **Import back** — Download enriched results as CSV and re-import into Google Sheets, or use a sync script/n8n to update the sheet automatically.

ZeroGTM does not store your sheet data in a third-party cloud; processing runs on your infra or our hosted tier.

---

## Top 3 workflows

1. **Enrich a list from Sheets** — Export a list of businesses or contacts from Sheets, run the full [lead enrichment]({{ site.baseurl }}/glossary/lead-enrichment/) pipeline, then paste or import the enriched columns (email, phone, DM name) back into the sheet.
2. **Map scrape → Sheets** — Run a Map Scrape job by location/category, then export results to Sheets for review. Run enrichment on selected rows and merge back.
3. **Ongoing sync** — Use n8n or a script to watch a Sheet for new rows, trigger enrichment jobs, and append results to the same or another sheet. Ideal for shared lead lists and round-robin flows.

---

## Technical FAQs

**What format does ZeroGTM expect for import?**  
CSV with headers. Recommended columns: company name, website, and/or address. Optional: phone, existing email. The pipeline uses these to find and verify emails and decision makers.

**Is there a native Google Sheets connector?**  
Today we support CSV export/import and API. A native “Connect Google Sheets” OAuth flow is on the roadmap. [Changelog →]({{ site.baseurl }}/changelog/)

**Data sync direction?**  
One-way (Sheets → ZeroGTM) for enrichment; results can be written back via CSV download or your own sync. ZeroGTM does not write directly to Sheets unless you build a small integration (e.g. Google Sheets API + worker).

---

[All integrations →]({{ site.baseurl }}/integrations/)  
[Features →]({{ site.baseurl }}/features/)  
[What is lead enrichment? →]({{ site.baseurl }}/glossary/lead-enrichment/)
