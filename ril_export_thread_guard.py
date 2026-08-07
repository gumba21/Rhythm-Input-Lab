from __future__ import annotations

import sys
import threading
import time
import uuid
from types import ModuleType
from typing import Any

import ril_export_jobs as jobs

_INSTALLED = False


def _start_job_responsive(app: Any, payload: dict[str, Any], app_version: str) -> dict[str, Any]:
    """Create the job response before the CPU-heavy worker can take the GIL.

    The prior implementation started the worker thread immediately. On large
    charts the worker could enter compact-chart serialization before the HTTP
    request returned, making the browser look frozen even though a background
    thread existed. A short timer lets the start response flush first, while a
    smaller thread switch interval keeps status polling responsive during local
    Python work.
    """
    jobs._cleanup_jobs()
    folder = str(payload.get("folder") or "")
    if not folder:
        raise ValueError("Choose a song to export")
    app.song_folder(folder)

    with jobs._JOBS_LOCK:
        for job in jobs._JOBS.values():
            if job.get("folder") == folder and job.get("status") in {"queued", "running"}:
                raise ValueError("An export for this song is already running")

        job_id = uuid.uuid4().hex
        cancel_event = threading.Event()
        job = {
            "job_id": job_id,
            "folder": folder,
            "status": "queued",
            "stage": "Queued",
            "progress": 0,
            "bytes_written": 0,
            "bytes_total": 0,
            "current_file": "",
            "error": "",
            "result": None,
            "created_at_epoch": time.time(),
            "updated_at_epoch": time.time(),
            "cancel_event": cancel_event,
        }
        jobs._JOBS[job_id] = job
        worker = threading.Thread(
            target=jobs._worker,
            args=(app, dict(payload), app_version, job_id),
            daemon=True,
            name=f"ril-export-{job_id[:8]}",
        )
        job["thread"] = worker

        # Do not let the worker begin until the /start response has had time to
        # leave the request handler. Timer itself is daemonized by Python.
        starter = threading.Timer(0.20, worker.start)
        starter.daemon = True
        starter.start()
        return jobs._public_job(job)


def install_ril_export_thread_guard(backend: ModuleType) -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    try:
        sys.setswitchinterval(0.001)
    except (AttributeError, ValueError):
        pass
    jobs._start_job = _start_job_responsive
    backend.Handler._ril_export_thread_guard_installed = True
    _INSTALLED = True
