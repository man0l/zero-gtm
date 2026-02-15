---
layout: default
title: Enrichment Pipeline — Lead Enrichment and Email Finder Steps
description: "ZeroGTM enrichment pipeline: Google Maps scraper, clean leads, find emails (OpenWeb Ninja), find decision makers, Anymail Finder, casualise names, clean spam."
permalink: /docs/enrichment-pipeline/
---

# Enrichment Pipeline

The **enrichment pipeline** is the core of ZeroGTM: from **Google Maps** leads to verified contacts and **decision maker** discovery. Each step is either an async worker job or an inline Edge Function.

---

## Overview

| Step | Type | What it does |
|------|------|--------------|
| 1. Map Scrape | Async (worker) | **Google Maps scraper** — extract leads by location/category via RapidAPI |
| 2. Clean | Async (worker) | Website validation, category filter — remove invalid or off-target leads |
| 3. Find Emails | Async (worker) | **Lead enrichment** — OpenWeb Ninja scrapes emails/socials/phones |
| 4. Find Decision Makers | Async (worker) | Scrape About pages (waterfall: about → ToS → LinkedIn) to find **decision makers** |
| 5. Find DM Emails | Async (worker) | **Email finder** — Anymail Finder for precision DM emails |
| 6. Casualise Names | Inline (Edge) | Heuristic + optional OpenAI to casualise company names (e.g. drop "Inc/LLC") |
| 7. Clean Spam | Inline (Edge) | Remove spam keywords from lead data |

Steps 1–5 run as **bulk_jobs** on the Contabo (or self-hosted) worker. Steps 6–7 run in the Edge Function when you trigger them from the app.

---

## 1. Map Scrape (Google Maps Scraper)

- **Worker**: `scrape_google_maps.py`
- **Trigger**: Edge Function `trigger-scrape` (campaign + config: locations, category, etc.)
- Uses **RapidAPI** Google Maps API. Output: new rows in `leads` for the campaign. Typical use: **lead-generation** from local businesses via a **google-maps-scraper** (Python worker).

---

## 2. Clean Leads

- **Worker**: `clean_leads.py`
- **Trigger**: Edge Function `trigger-clean`
- Validates company websites (e.g. HTTP 200), applies category filter. Updates or removes leads.

---

## 3. Find Emails (Lead Enrichment)

- **Worker**: `find_emails.py`
- **Trigger**: Edge Function `trigger-enrichment` with type `find_emails`
- Uses **OpenWeb Ninja** to enrich leads with emails, phones, socials. Classic **lead enrichment** step—part of what makes ZeroGTM work as **lead enrichment software** and a practical **email finder tool** in one pipeline.

---

## 4. Find Decision Makers

- **Worker**: `find_decision_makers.py`
- **Trigger**: Edge Function `trigger-enrichment` with type `find_decision_makers`
- Waterfall: scrape About page → fallback ToS → LinkedIn. Writes **decision maker** name (and optionally more) to the lead.

---

## 5. Find DM Emails (Email Finder)

- **Worker**: `anymail_find_emails.py`
- **Trigger**: Edge Function `trigger-enrichment` with type `anymail_emails`
- Uses **Anymail Finder** to get the right **email finder** result per decision maker (**email finder by name**; **email finder by phone number** where the provider supports it).

---

## 6. Casualise Names

- **Edge Function**: `casualise-names` (inline)
- Removes "Inc", "LLC", etc. from company names (heuristic + optional OpenAI). Improves personalization and deliverability.

---

## 7. Clean Spam

- **Edge Function**: `clean-spam` (inline)
- Strips spammy keywords from lead fields. Keeps lists clean for sending.

---

## Order of Use

Typical order: **Scrape → Clean → Find Emails → Find Decision Makers → Find DM Emails**. Then run **Casualise** and **Clean Spam** as needed. The mobile app lets you trigger each step per campaign; job progress is visible in the Jobs tab and on the campaign.

[Getting started →]({{ site.baseurl }}/docs/getting-started/)  
[Mobile app →]({{ site.baseurl }}/docs/mobile-app/)  
[API keys →]({{ site.baseurl }}/docs/api-keys/)  
[Features →]({{ site.baseurl }}/features/)  
[Compare & pricing →]({{ site.baseurl }}/compare/) · [Pricing →]({{ site.baseurl }}/pricing/)
