---
layout: default
title: Blog — ZeroGTM
description: "ZeroGTM blog: Google Maps scraping, AI SDR vs Human SDR cost breakdown, lead enrichment, and BYOK. Technical guides for GTM engineers."
permalink: /blog/
---

# Blog

Technical guides and breakdowns for GTM engineers: **Google Maps** scraping, **AI SDR vs Human SDR** economics, **lead enrichment**, and **BYOK** architecture.

---

## Posts

<ul style="list-style: none; padding-left: 0;">
  {% assign sorted_posts = site.blog | sort: "date" | reverse %}
  {% for post in sorted_posts %}
  <li style="margin-bottom: 1rem;">
    <a href="{{ site.baseurl }}{{ post.url }}"><strong>{{ post.title }}</strong></a>
    {% if post.description %}<br /><span style="color: var(--fg-muted); font-size: 0.9rem;">{{ post.description }}</span>{% endif %}
  </li>
  {% endfor %}
</ul>

[Home →]({{ site.baseurl }}/) · [Features →]({{ site.baseurl }}/features/) · [Pricing →]({{ site.baseurl }}/pricing/)
