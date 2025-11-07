from __future__ import annotations

import copy
import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Literal, Optional

JobState = Literal["queued", "running", "done", "failed"]
MAX_MESSAGE_LENGTH = 2000


def _now_iso() -> str:
    """Return current UTC timestamp as ISO string with second precision."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _trim_message(text: str, limit: int = MAX_MESSAGE_LENGTH) -> str:
    """Clamp message length to avoid unbounded memory growth."""
    if len(text) <= limit:
        return text
    return text[-limit:]


def _tail_line(lines: Iterable[str]) -> Optional[str]:
    for line in reversed(list(lines)):
        striped = line.strip()
        if striped:
            return striped
    return None


def _final_message(stdout: str, stderr: str, returncode: Optional[int]) -> str:
    """Pick a short status message from process output."""
    if returncode == 0:
        stdout_line = _tail_line(stdout.splitlines()) if stdout else None
        message = stdout_line or "Return code 0"
    else:
        stderr_line = _tail_line(stderr.splitlines()) if stderr else None
        stdout_line = _tail_line(stdout.splitlines()) if stdout else None
        base = stderr_line or stdout_line or f"Return code {returncode}"
        message = f"{base} (rc={returncode})" if returncode is not None else base
    return _trim_message(message)


@dataclass
class Job:
    id: str
    project_dir: str
    cmd: List[str] = field(default_factory=list)
    state: JobState = "queued"
    created_at: str = field(default_factory=_now_iso)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    returncode: Optional[int] = None
    message: str = ""

    def to_dict(self) -> Dict[str, object]:
        return {
            "id": self.id,
            "project_dir": self.project_dir,
            "cmd": list(self.cmd),
            "state": self.state,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "returncode": self.returncode,
            "message": self.message,
        }


class JobStore:
    """Minimal in-memory job registry with background execution threads."""

    def __init__(self) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def create_job(self, project_dir: Path, cmd: List[str]) -> Job:
        job = Job(id=str(uuid.uuid4()), project_dir=str(project_dir), cmd=list(cmd))
        with self._lock:
            self._jobs[job.id] = job
        return job

    def start_job(self, job: Job) -> None:
        thread = threading.Thread(target=self._run_job, args=(job.id,), daemon=True)
        thread.start()

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            job = self._jobs.get(job_id)
            return copy.deepcopy(job) if job else None

    def list_jobs(self) -> List[Job]:
        with self._lock:
            jobs = list(self._jobs.values())
        jobs.sort(key=lambda j: j.created_at, reverse=True)
        return [copy.deepcopy(job) for job in jobs]

    def _get_cmd(self, job_id: str) -> List[str]:
        with self._lock:
            job = self._jobs[job_id]
            return list(job.cmd)

    def _update_job(self, job_id: str, **changes: object) -> None:
        with self._lock:
            job = self._jobs[job_id]
            for key, value in changes.items():
                if key == "message" and isinstance(value, str):
                    value = _trim_message(value)
                setattr(job, key, value)

    def _run_job(self, job_id: str) -> None:
        self._update_job(job_id, state="running", started_at=_now_iso())
        cmd = self._get_cmd(job_id)
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=False)
            message = _final_message(result.stdout or "", result.stderr or "", result.returncode)
            state: JobState = "done" if result.returncode == 0 else "failed"
            self._update_job(
                job_id,
                state=state,
                finished_at=_now_iso(),
                returncode=result.returncode,
                message=message,
            )
        except Exception as exc:  # pragma: no cover - defensive logging path
            self._update_job(
                job_id,
                state="failed",
                finished_at=_now_iso(),
                message=_trim_message(str(exc)),
            )
