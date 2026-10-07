from __future__ import annotations

from pathlib import Path

from ril_version import APP_VERSION


ROOT = Path(__file__).parent
WEB = ROOT / "web"


def read(name: str) -> str:
    return (WEB / name).read_text(encoding="utf-8")


def require(text: str, *needles: str) -> None:
    for needle in needles:
        assert needle in text, f"Missing transport/session marker: {needle}"


def main() -> None:
    app = read("app.js")
    transport = read("song-transport.js")
    practice = read("practice.js")
    polish = read("practice-polish.js")
    state_hotfix = read("practice-state-hotfix.js")
    backpolish = read("practice-engine-backpolish.js")
    tools = read("practice-tools.js")
    comfort = read("practice-comfort.js")
    visualizer = read("visualizer.js")
    v45 = read("v45-polish.js")
    media = read("song-media.js")
    multi = read("multi-vocals.js")
    preferences = read("visualizer-preferences.js")
    workspace = read("workspace-ui.js")

    # One shared transport is installed before Practice/Visualizer patches use it.
    require(app, "'/song-transport.js'", "'/practice.js'", "'/multi-vocals.js'", "'/workspace-ui.js'")
    assert app.index("/song-transport.js") < app.index("/practice.js")
    assert app.index("/song-transport.js") < app.index("/multi-vocals.js")

    # The shared transport owns sessions, operations, lifecycle, media starts and drift safety.
    require(
        transport,
        'const STATES = new Set(["unloaded", "loading", "ready", "counting-in", "playing", "paused", "seeking", "finished"])',
        "const ALLOWED =",
        "sessionId: 0",
        "operationId: 0",
        "function beginSession(",
        "function playAt(",
        "function pause(",
        "function seek(",
        "function finish(",
        "function settleSeek(",
        "operationCurrent(token)",
        "staleAsyncDrops",
        "invalidTransitions",
        "correctDrift",
        'emit("ril:transport-session"',
    )
    assert ".play()" in transport, "transport must own media play requests"

    # New Practice song selection is a hard live-session boundary and stale loads are rejected.
    require(
        practice,
        "loadGeneration",
        "sessionId",
        'lifecycle: "unloaded"',
        "resetPracticeSessionForLoad(folder)",
        'practice.lastAttempt = null',
        'new CustomEvent("ril:practice-session-reset"',
        'beginSession?.("practice", folder',
        "generation !== practice.loadGeneration",
        "practiceSessionCurrent(practice.sessionId)",
        "setDuration?.(practice.durationMs",
        "playAt?.(practice.currentMs",
        "seek?.(practice.currentMs",
        'finish?.(practice.endMs',
        "renderNotes",
        "lowerBoundByTime",
        "!window.rilPracticeEngine?.backpolish",
    )
    assert "if (practice.loading) return;" not in practice
    assert ".play()" not in practice

    # Count-in presentation funnels into the engine/transport instead of a synthetic restart click.
    require(
        polish,
        'p.lifecycle = "counting-in"',
        'prepareAudio(p.startMs, "counting-in")',
        "runtime.engine?.startPractice?.()",
        'window.addEventListener("ril:practice-session-reset"',
    )
    assert ".play()" not in polish

    # Backpolish keeps precise conductor ownership while using the shared master and culled render window.
    require(
        backpolish,
        "window.rilSongTransport?.masterNode?.()",
        "function visiblePracticeNotes(",
        "lowerBoundNoteTime",
        "practice.renderMetrics.activeNotes",
        "requestAnimationFrame(tick)",
    )

    # Saved media and extra vocal stems may load/clear nodes but do not own a playback loop.
    require(media, "sessionStillOwns", '"ril:transport-session"', "markReady?.", "markNotReady?.")
    require(multi, '"ril:transport-session"', "registerStem?.", "markReady?.", "loadingToken")
    assert "requestAnimationFrame" not in media
    assert "requestAnimationFrame" not in multi
    assert ".play()" not in media
    assert ".play()" not in multi

    # Visualizer song/attempt replacement is session guarded and transport routed.
    require(
        visualizer,
        "loadGeneration",
        'beginSession?.("visualizer", songFolder',
        "visualizerSessionCurrent",
        "state.viz.sessionId",
        "songTransport()?.playAt?.",
        "songTransport()?.seek?.",
        "songTransport()?.finish?.",
        "renderCache",
        "visibleChartNotes",
        "lowerBoundTime",
        "lastTimelineAt",
        "lastEventsAt",
    )
    assert ".play()" not in visualizer

    # Later visualizer modules no longer create a second media transport.
    require(v45, "transport()?.correctDrift?.", "transport()?.pause?.")
    assert ".play()" not in v45
    require(preferences, "rilSongTransport?.setRate?.")

    # Non-render helpers must not poll at display refresh rate.
    assert "requestAnimationFrame" not in tools
    assert "requestAnimationFrame" not in comfort
    assert "requestAnimationFrame" not in workspace
    require(workspace, "window.rilRenderDiagnostics", "render.fps", "transport.staleAsyncDrops")

    # The old hotfix may still guard trusted user starts, but it must never own media.
    assert ".play()" not in state_hotfix

    assert APP_VERSION == "5.0.0-dev"
    print(f"Rhythm Input Lab {APP_VERSION} transport/session integration self-test passed.")


if __name__ == "__main__":
    main()
