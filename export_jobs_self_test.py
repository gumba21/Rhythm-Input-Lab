from __future__ import annotations

import base64
import tempfile
import time
from pathlib import Path

import app
import backend
import fnf_importer
import quaver_import_backend
import quaver_loose_audio
import ril_export_jobs
import ril_package_backend as packages
from ril_version import APP_VERSION


def chart() -> str:
    return """---
QuaVersion: 1
AudioFile: song.mp3
Mode: Keys4
Title: Folder Audio Test
Artist: Rhythm Input Lab
Creator: gumba21
DifficultyName: Hard
TimingPoints:
  - StartTime: 0
    Bpm: 120
    Signature: 4
SliderVelocities:
  - StartTime: 500
    Multiplier: 1.25
HitObjects:
  - StartTime: 250
    Lane: 1
    EndTime: 0
  - StartTime: 500
    Lane: 2
    EndTime: 900
  - StartTime: 1000
    Lane: 3
    EndTime: 0
    Type: Mine
  - StartTime: 1250
    Lane: 4
    EndTime: 0
"""


class FakeApp:
    def __init__(self, root: Path) -> None:
        self._root = root
        self.settings = {"profile": {"username": "gumba21"}}

    @property
    def output_root(self) -> Path:
        self._root.mkdir(parents=True, exist_ok=True)
        return self._root

    def song_folder(self, name: str) -> Path:
        folder = self._root / name
        if not folder.is_dir():
            raise FileNotFoundError(name)
        return folder

    def list_songs(self) -> list[dict]:
        return [backend.build_song_entry(path) for path in self._root.iterdir() if path.is_dir() and path.name != "RIL Exports"]

    def song_bundle(self, name: str) -> dict:
        folder = self.song_folder(name)
        return {"song": backend.build_song_entry(folder), "bundle": fnf_importer.load_chart_bundle(folder), "attempts": []}


def wait_for_job(job_id: str, timeout: float = 8.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = ril_export_jobs._job(job_id)
        if job["status"] in {"completed", "error", "cancelled"}:
            return job
        time.sleep(0.02)
    raise AssertionError("Background export did not finish in time")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="ril_export_jobs_test_") as temp:
        root = Path(temp)
        fake = FakeApp(root)
        upload_id = "quaveraudiofixture0000000000000001"
        upload_dir = quaver_import_backend._TEMP_ROOT / upload_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        (upload_dir / "source.qua").write_text(chart(), encoding="utf-8")
        (upload_dir / "filename.txt").write_text("Folder Audio Test [Hard].qua", encoding="utf-8")

        audio = b"ID3" + b"folder-audio" * 4096
        uploaded = quaver_loose_audio._upload_audio_chunk({
            "upload_id": upload_id,
            "filename": "song.mp3",
            "relative_path": "Quaver Song/song.mp3",
            "index": 0,
            "total": 1,
            "data": base64.b64encode(audio).decode("ascii"),
        })
        assert uploaded["complete"] is True
        assert uploaded["filename"] == "song.mp3"

        imported = quaver_loose_audio._commit_import(fake, upload_id, {}, APP_VERSION)
        assert imported["count"] == 1
        assert imported["companion_audio"] is True
        assert imported["imported"][0]["audio_saved"] is True
        song = imported["imported"][0]["song"]
        song_folder = fake.song_folder(song["folder"])
        saved_audio = song_folder / "audio" / "instrumental.mp3"
        assert saved_audio.read_bytes() == audio
        assert fnf_importer.load_chart_bundle(song_folder)["summary"]["event_type_counts"] == {"Quaver SV change": 1}

        started = ril_export_jobs._start_job(fake, {
            "folder": song["folder"],
            "username": "gumba21",
            "include_instrumental": True,
            "include_vocals": False,
            "include_original": False,
            "discord_limit": False,
        }, APP_VERSION)
        assert started["status"] in {"queued", "running"}
        finished = wait_for_job(started["job_id"])
        assert finished["status"] == "completed", finished.get("error")
        assert finished["progress"] == 100
        result = finished["result"]
        exported = Path(result["saved_path"])
        assert exported.is_file()
        assert exported.parent.name == "RIL Exports"
        inspected = packages.inspect_ril_package(exported)
        assert inspected["preview"]["instrumental"] is True
        assert inspected["preview"]["notes"] == 4
        assert not any(path.name.endswith(".partial") for path in exported.parent.iterdir())

    web = Path(__file__).parent / "web"
    jobs_js = (web / "ril-export-jobs.js").read_text(encoding="utf-8")
    quaver_js = (web / "quaver-multi-import.js").read_text(encoding="utf-8")
    app_js = (web / "app.js").read_text(encoding="utf-8")
    assert "/api/ril/export/start" in jobs_js
    assert "/api/ril/export/status" in jobs_js
    assert "/api/ril/export/cancel" in jobs_js
    assert "Choose Quaver folder" in quaver_js
    assert "/api/quaver/import/audio/chunk" in quaver_js
    assert "webkitdirectory" in quaver_js
    assert "/ril-export-jobs.js" in app_js
    assert getattr(app._backend.Handler, "_ril_export_jobs_installed", False)
    assert getattr(app._backend.Handler, "_ril_quaver_loose_audio_installed", False)
    assert APP_VERSION == "5.0.0-dev"
    print(f"Rhythm Input Lab {APP_VERSION} background export and Quaver folder-audio self-test passed.")


if __name__ == "__main__":
    main()
