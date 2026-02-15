---
layout: default
title: Web App and Landing Page
description: "ZeroGTM web app and landing page. GTM engine and AI SDR for GTM engineers. Deploy and use the marketing landing."
permalink: /docs/web-app/
---

# Web App and Landing Page

The **web** side of ZeroGTM today is the **landing page**: a static marketing site that explains the product and drives sign-ups. Deploy it to GitHub Pages, Netlify, or Vercel for a fast, SEO-friendly presence. A future web dashboard would be documented here too.

---

## What Exists Today

- **Landing page** — Single-page site in `landing/index.html`. Tailwind CSS, dark theme, hero, features, pipeline overview, pricing, CTAs. Uses the same Google Analytics ID as this docs site.

---

## Setup and Deploy

The landing is static HTML/CSS/JS. To run it locally, open `landing/index.html` in a browser or serve the `landing/` folder with any static server (e.g. `npx serve landing`).

To deploy:

- **GitHub Pages** — You can point a branch or `/docs` at the repo; this docs site lives under `/docs`. The main marketing site could be the same Jekyll site (this one) with the homepage as the main landing, or a separate deployment.
- **Any static host** — Upload the contents of `landing/` to Netlify, Vercel, or your own server.

No build step required for the current landing.

---

## What the Landing Page Does

- **Hero** — Value prop: AI SDR, lead generation, 71% savings.
- **How it works** — Short pipeline overview (map scrape → contact mining → DM identification → verification → sanitization).
- **Economics table** — Human SDR vs ZeroGTM cost comparison.
- **Features** — Mobile-first, self-hosted, enrichment pipeline.
- **CTAs** — Sign up, get started, or link to docs/app.

If you add a **web dashboard** (e.g. React app for managing campaigns from the browser), add a subsection here describing setup and usage.

The landing positions ZeroGTM as a **GTM engine** and **AI SDR for GTM engineers**: a local-first, signal-driven engine for teams that want to own their outreach stack without vendor lock-in.

[Getting started →]({{ site.baseurl }}/docs/getting-started/)  
[Mobile app →]({{ site.baseurl }}/docs/mobile-app/)  
[Features →]({{ site.baseurl }}/features/)  
[Pricing →]({{ site.baseurl }}/pricing/) · [Compare →]({{ site.baseurl }}/compare/)
