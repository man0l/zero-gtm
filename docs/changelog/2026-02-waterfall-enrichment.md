---
layout: default
title: Waterfall Enrichment Update — ZeroGTM Changelog
description: "ZeroGTM now supports waterfall enrichment: multiple email finder and enrichment sources in sequence. Better coverage, configurable order and fallbacks."
date: 2026-02-15
permalink: /changelog/2026-02-waterfall-enrichment/
---

# Waterfall enrichment update

**New Feature** · February 15, 2026

We’ve added **waterfall enrichment** to the pipeline—so you can chain multiple email finder and enrichment sources in order and only fall back when a step fails or returns no result. That means better coverage without blowing the budget on the most expensive API for every lead.

---

## Why we built it

Single-source enrichment is brittle: one API is down or has no data, and you’re stuck. With waterfall, you define a sequence (e.g. try Source A, then B, then C) and the pipeline automatically moves to the next provider when needed. You get higher fill rates and more control over cost vs. coverage.

---

## What’s new

- **Configurable order** — Set the sequence of enrichment and email finder steps in the dashboard (or via config). No code change required for common setups.
- **Fallback on empty or error** — If a step returns no email or errors out, the next step in the waterfall runs automatically.
- **Per-step limits** — Optional caps per source so you don’t burn through your priciest API on every lead.

We’ll add screenshots and a short video here once the UI is finalized. For the technical flow, see [What is lead enrichment?]({{ site.baseurl }}/glossary/lead-enrichment/) and the [Enrichment pipeline]({{ site.baseurl }}/docs/enrichment-pipeline/) docs.

---

## How to use it

1. Open your pipeline config (dashboard or YAML).
2. Add or reorder enrichment steps into a single waterfall.
3. Set fallback behavior (next step on empty/error).
4. Run the pipeline as usual from the mobile app or workers.

---

[Changelog →]({{ site.baseurl }}/changelog/)  
[Lead enrichment (glossary) →]({{ site.baseurl }}/glossary/lead-enrichment/)  
[Enrichment pipeline docs →]({{ site.baseurl }}/docs/enrichment-pipeline/)
