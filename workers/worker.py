#!/usr/bin/env python3
"""
Main worker loop for Contabo.
Polls ninja.bulk_jobs for pending jobs and dispatches to the appropriate worker script.

Run as: python worker.py
Or as systemd service: see workers/cold-email-ninja-worker.service
"""

import os
import sys
import time
import logging
import traceback

from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("worker.log"),
    ],
)
logger = logging.getLogger("worker")

from base import get_supabase_client


# Import worker classes
from scrape_google_maps import ScrapeGoogleMapsWorker
from find_emails import FindEmailsWorker
from find_decision_makers import FindDecisionMakersWorker
from anymail_find_emails import AnymailFindEmailsWorker
from clean_leads import CleanLeadsWorker


# Map job types to worker classes
JOB_HANDLERS = {
    "scrape_maps": ScrapeGoogleMapsWorker,
    "find_emails": FindEmailsWorker,
    "find_decision_makers": FindDecisionMakersWorker,
    "anymail_emails": AnymailFindEmailsWorker,
    "clean_leads": CleanLeadsWorker,
}

POLL_INTERVAL = int(os.getenv("WORKER_POLL_INTERVAL", "5"))


def recover_orphaned_jobs(db):
    """Reset any 'running' jobs back to 'pending' on worker startup.

    Since there is only one worker, any job still in 'running' state when
    the worker starts must have been orphaned by a previous crash or
    Watchtower restart.  Resetting them lets the new worker pick them up.
    """
    try:
        result = db.from_("bulk_jobs") \
            .update({"status": "pending", "started_at": None, "progress": {}}) \
            .eq("status", "running") \
            .execute()
        recovered = len(result.data) if result.data else 0
        if recovered:
            logger.info(f"Recovered {recovered} orphaned job(s) → reset to pending")
    except Exception as e:
        logger.warning(f"Orphan recovery check failed (non-fatal): {e}")


def main():
    logger.info("Cold Email Ninja Worker starting...")
    logger.info(f"Supabase URL: {os.getenv('SUPABASE_URL')}")
    logger.info(f"Poll interval: {POLL_INTERVAL}s")
    logger.info(f"Registered job types: {list(JOB_HANDLERS.keys())}")

    db = get_supabase_client()

    # On startup, recover any jobs orphaned by a previous crash / restart
    recover_orphaned_jobs(db)

    while True:
        try:
            # Claim next pending job (atomic via DB function)
            result = db.rpc("claim_next_bulk_job").execute()

            if not result.data:
                time.sleep(POLL_INTERVAL)
                continue

            job = result.data
            if isinstance(job, list):
                job = job[0] if job else None
            if not job:
                time.sleep(POLL_INTERVAL)
                continue

            job_type = job["type"]
            job_id = job["id"]
            logger.info(f"Claimed job {job_id} (type: {job_type})")

            handler_class = JOB_HANDLERS.get(job_type)
            if not handler_class:
                logger.error(f"Unknown job type: {job_type}")
                db.from_("bulk_jobs").update({
                    "status": "failed",
                    "error": f"Unknown job type: {job_type}",
                }).eq("id", job_id).execute()
                continue

            # Execute the job
            worker = handler_class(job, db)
            try:
                worker.run()
            except Exception as e:
                logger.error(f"Job {job_id} failed: {e}")
                logger.error(traceback.format_exc())
                worker.fail(str(e))

        except KeyboardInterrupt:
            logger.info("Worker shutting down (SIGINT)")
            break
        except Exception as e:
            logger.error(f"Worker loop error: {e}")
            logger.error(traceback.format_exc())
            time.sleep(POLL_INTERVAL * 2)


if __name__ == "__main__":
    main()
