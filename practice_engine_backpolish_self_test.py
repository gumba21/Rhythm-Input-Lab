from __future__ import annotations

from pathlib import Path

from ril_version import APP_VERSION


def main() -> None:
    root = Path(__file__).parent
    engine = (root / "web" / "practice-engine-backpolish.js").read_text(encoding="utf-8")
    release = (root / "web" / "practice-engine-release-reconcile.js").read_text(encoding="utf-8")
    app_js = (root / "web" / "app.js").read_text(encoding="utf-8")
    notices = (root / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")

    required = [
        'const ENGINE_VERSION = "1"',
        "performance.timeOrigin",
        "function eventSongTime",
        "function sampleClock",
        "function preciseKeyDown",
        "function preciseKeyUp",
        "function processLateNotes",
        "function rebuildStats",
        "function drawBackpolishedPractice",
        "state.holdDropped",
        "state.holdComplete",
        "visibilitychange",
        "Focus was lost",
        "Precise input · conductor clock",
    ]
    for marker in required:
        assert marker in engine, marker

    release_required = [
        "backpolish.eventSongTime(event)",
        "state?.pressId === press.id",
        "matched.state.holdDropped = true",
        "matched.state.holdComplete = true",
        "backpolish.rebuildStats()",
    ]
    for marker in release_required:
        assert marker in release, marker

    save_index = app_js.index("/practice-save.js")
    engine_index = app_js.index("/practice-engine-backpolish.js")
    release_index = app_js.index("/practice-engine-release-reconcile.js")
    media_index = app_js.index("/song-media.js")
    assert save_index < engine_index < release_index < media_index
    assert "Friday Night Funkin'" in notices
    assert "Apache License 2.0" in notices
    assert APP_VERSION == "5.0.0-dev"
    print(f"Rhythm Input Lab {APP_VERSION} Practice engine backpolish self-test passed.")


if __name__ == "__main__":
    main()
