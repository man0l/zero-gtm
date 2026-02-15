# GitHub Pages SEO Audit — ZeroGTM Docs

**Purpose**: Identify gaps and track improvements for the docs site (GitHub Pages / Jekyll) from an SEO and content perspective.

---

## 1. Technical SEO

| Item | Status | Notes |
|------|--------|--------|
| **Title tags** | ✅ | Per-page titles; keep under ~60 chars. |
| **Meta description** | ✅ | Per-page; keep under ~155 chars. |
| **Canonical URL** | ✅ | In default layout. |
| **Open Graph** | ⚠️→✅ | Had title/description/type/url; **added** `og:image`, `og:site_name`. |
| **Twitter Card** | ⚠️→✅ | Had summary_large_image; **added** `twitter:image`. |
| **robots.txt** | ✅ | Allow all, sitemap reference. |
| **Sitemap** | ✅ | jekyll-sitemap plugin. |
| **Structured data** | ⚠️→✅ | SoftwareApplication on home; **added** FAQPage (home), BreadcrumbList (docs), richer SoftwareApplication. |
| **Mobile viewport** | ✅ | Present. |
| **HTTPS** | ✅ | GitHub Pages default. |

**Fixes applied**: Default OG/Twitter image via config, BreadcrumbList for doc pages, FAQ schema on home, extended SoftwareApplication (featureList, url).

---

## 2. Content & Keyword Gaps

- **potential_tags.md**: Keyword list (e.g. google-maps-scraper, ai sdr, email finder, lead enrichment) is excluded from build. Those terms are now integrated into page copy and headings where relevant.
- **Thin pages**: `web-app.md` and `api-keys.md` were light; intro/outro copy was strengthened and “Keywords” blocks turned into natural prose.
- **No blog yet**: `collections: blog` exists; adding posts (e.g. “How to use a Google Maps scraper for lead gen”) would help long-tail and freshness.
- **Missing topic clusters**: Consider dedicated short pages or sections for: “cold email outreach,” “decision maker discovery,” “B2B lead enrichment” (partially covered in features/compare).

---

## 3. UX & Design

- **404**: Was minimal; updated with nav, primary links, and friendly copy.
- **Navigation**: Clear; doc dropdown and main nav consistent.
- **CTAs**: Home and features have clear next steps; pricing/compare link to signup and docs.
- **Accessibility**: Consider adding a “Skip to main content” link for keyboard/screen-reader users (optional follow-up).

---

## 4. Recommendations (Ongoing)

1. **Add an OG image**: Create a 1200×630 image (logo + tagline), host under `/cold-email-ninja-app/assets/og-default.png`, and set `og_image` in `_config.yml`.
2. **Blog**: Publish 2–3 posts targeting long-tail (e.g. “Google Maps lead generation,” “email finder for sales teams”) and link from features/docs.
3. **Internal linking**: In new content, link to getting-started, enrichment-pipeline, and pricing with descriptive anchor text.
4. **Monitor**: Use Google Search Console for the GitHub Pages URL to track queries, clicks, and indexation.
