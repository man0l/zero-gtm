---
layout: default
title: What is Lead Enrichment? — Glossary
description: "Lead enrichment definition: appending data (firmographics, emails) to incomplete lead records. Waterfall enrichment, email finder, and pipeline."
permalink: /glossary/lead-enrichment/
---

## What is lead enrichment?

**Lead enrichment** is the process of appending missing data to lead records—such as email addresses, phone numbers, firmographics (company size, industry), and decision-maker names—so that outreach and qualification can run at scale. It turns incomplete lists (e.g. company name + website only) into contact-ready records. **Waterfall enrichment** is a sub-concept: using multiple sources in sequence and falling back to the next when one fails or returns no result, improving coverage and cost control.

---

## Why it matters

Without enrichment, SDRs and [AI SDR]({{ site.baseurl }}/glossary/ai-sdr/) pipelines waste time on wrong contacts or dead emails. Enrichment fills in the right person and a valid inbox (often via an email finder and verification step), so campaigns reach decision makers and avoid bounces. ZeroGTM’s pipeline is built around lead enrichment: map scrape → clean → find emails → find DMs → verify.

---

## Key benefits

- **Higher deliverability** — Verified emails mean fewer bounces and better sender reputation.
- **Better targeting** — Decision-maker identification so you contact the right role, not just “info@”.
- **Scalability** — Enrich at scale via APIs and automation instead of manual lookup.
- **Waterfall** — Use several sources in order to maximize fill rate without over-spending; see [Changelog: Waterfall enrichment]({{ site.baseurl }}/changelog/2026-02-waterfall-enrichment/).

---

## Related

- [What is an AI SDR?]({{ site.baseurl }}/glossary/ai-sdr/) — Enrichment is a core part of an AI SDR pipeline.
- [Features: Enrichment pipeline]({{ site.baseurl }}/features/) — How ZeroGTM does lead enrichment.
- [Enrichment pipeline docs]({{ site.baseurl }}/docs/enrichment-pipeline/) — Step-by-step technical flow.
- [Use case: Med spa lead generation]({{ site.baseurl }}/use-cases/med-spa-lead-generation/) — Example vertical.
- [Integrations]({{ site.baseurl }}/integrations/) — Connect enrichment to your CRM or Sheets.
