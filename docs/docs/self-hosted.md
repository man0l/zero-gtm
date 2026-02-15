---
layout: default
title: Self-Hosted Setup — Local-First Lead Generation
description: "Self-host ZeroGTM: Docker Compose, Supabase, Contabo workers. Full data control for lead generation and lead enrichment. Local-first."
permalink: /docs/self-hosted/
---

# Self-Hosted Setup

Run ZeroGTM on your own infrastructure for **self-hosted lead generation** and full **data control**. This doc covers backend, workers, and env vars at a high level.

---

## Why Self-Host

- **Local-first** — Your lead data stays in your PostgreSQL and on your servers.
- **No vendor lock-in** — Swap APIs, change pipeline steps, tune prompts.
- **Unit economics** — Pay for APIs and compute only; no per-seat or per-credit SaaS fees (unless you also use a hosted tier for the app).

---

## Components

| Component | Role |
|-----------|------|
| **PostgreSQL** | Database (Supabase uses Postgres). All app and pipeline data in `ninja` schema. |
| **Supabase** | Auth (GoTrue), Edge Functions (Deno), Realtime. Can be self-hosted (Docker) or Supabase Cloud. |
| **Workers** | Python Docker image. Polls `bulk_jobs`, runs scrape/clean/enrichment. Typically on a VPS (e.g. Contabo). |
| **Mobile app** | Points at your Supabase URL and anon key. No hosting of the app itself required. |

---

## Docker Compose (Supabase + Workers)

The repo references a deployment where Supabase (DB, Kong, Edge Functions, Realtime) and the worker run under a single Compose setup (e.g. `docker-compose.prod.yml` on the server). You’ll need:

- Supabase images or your own build (e.g. `supabase/Dockerfile.functions` for Edge Functions).
- Worker image from `workers/Dockerfile` (e.g. `ghcr.io/man0l/cold-email-ninja-app:worker-latest`).

Apply migrations to the Postgres instance so the `ninja` schema and tables exist.

---

## Worker Deployment

- **Image**: Built from `workers/Dockerfile`, pushed to GHCR (or your registry).
- **Env file**: On the server, e.g. `/app/salonease/cold-email-ninja-app-workers/.env`, mounted as `env_file` in Compose. Never bake secrets into the image.
- **Required env**: Supabase URL, service role key, and API keys for RapidAPI, OpenWeb Ninja, Anymail Finder, and optionally OpenAI/Anthropic.

Watchtower (or your CI) can auto-pull new images and restart the worker.

---

## Edge Functions

- Served by the Supabase Edge Runtime (custom image from `supabase/Dockerfile.functions`).
- Require `main/index.ts` as the router. Deploy by pushing the image; Watchtower can pull and restart.
- Env vars for Edge Functions (Supabase URL, keys, optional billing) live in the Supabase/Compose config.

---

## Migrations

- Add SQL files under `supabase/migrations/` (timestamped names).
- Apply with `supabase db push --db-url "postgresql://..."` or your CI. Direct DB URL is used in the referenced setup (e.g. GitHub Actions with manual approval for production).

---

## Summary

**Self-hosted** = your Postgres + your Supabase (or compatible) stack + your worker(s). **Local-first** and **data control** mean you run the full **lead enrichment** and **email finder** pipeline on infra you own.

[Getting started →]({{ site.baseurl }}/docs/getting-started/)  
[API keys →]({{ site.baseurl }}/docs/api-keys/)  
[Enrichment pipeline →]({{ site.baseurl }}/docs/enrichment-pipeline/)  
[Pricing (self-host vs hosted) →]({{ site.baseurl }}/pricing/)  
[Features →]({{ site.baseurl }}/features/) · [Compare →]({{ site.baseurl }}/compare/)
