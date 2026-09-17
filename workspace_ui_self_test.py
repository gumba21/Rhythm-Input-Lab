from __future__ import annotations

from pathlib import Path

from ril_version import APP_VERSION


ROOT = Path(__file__).parent
WEB = ROOT / "web"


def read(name: str) -> str:
    return (WEB / name).read_text(encoding="utf-8")


def assert_all(text: str, *needles: str) -> None:
    for needle in needles:
        assert needle in text, f"Missing UI integration marker: {needle}"


def main() -> None:
    app = read("app.js")
    workspace = read("workspace-ui.js")
    styles = read("workspace-ui.css")
    browser = read("song-picker.js")
    song_tools = read("song-tools.js")
    import_center = read("import-center.js")
    fnf_batch = read("fnf-batch-import.js")

    # Final ownership/load order: legacy engines first, workspace composition last.
    assert_all(app, "loadStyle('/workspace-ui.css')", "'/workspace-ui.js'", "'/fnf-batch-import.js'")
    assert "/practice-library-menu.js" not in app, "Old Practice library wrapper should not remain in the load chain"
    assert app.index("/practice.js") < app.index("/practice-tools.js") < app.index("/practice-comfort.js") < app.index("/workspace-ui.js")
    assert app.index("/song-picker.js") < app.index("/import-center.js") < app.index("/fnf-batch-import.js") < app.index("/workspace-ui.js")

    # Shared library foundation and scalable organization.
    assert_all(
        browser,
        'window.rilSongBrowser =',
        'shell.className = "library-shell"',
        '"favorites"',
        '"recent"',
        '"imported"',
        '"attempts"',
        '"unplayed"',
        '"source:fnf"',
        '"source:osu"',
        '"source:quaver"',
        '"source:ril"',
        '"media:audio"',
        '"media:missing"',
        'data-library-view="compact"',
        'data-library-view="comfortable"',
        'data-song-picker-target',
    )
    assert_all(styles, ".library-shell", ".library-rail", ".library-inspector", ".library-row", ".library-comfortable")

    # Song Details launches workflows first and defers deeper information to tabs.
    assert_all(
        song_tools,
        'id="songDetailPractice"',
        'id="songDetailVisualizer"',
        'id="songDetailAnalysis"',
        'id="songDetailExport"',
        'id="songDetailManage"',
        'data-song-detail-tab="overview"',
        'data-song-detail-tab="attempts"',
        'data-song-detail-tab="chart"',
        'data-song-detail-tab="media"',
        'data-song-detail-tab="source"',
        'data-song-detail-tab="statistics"',
        'id="saveMechanicMappings"',
    )

    # Practice keeps the existing bound controls but moves them into contextual surfaces.
    assert_all(
        workspace,
        'toolbar.id = "practiceContextToolbar"',
        'practiceRangePanel',
        'practiceMixerPanel',
        'practiceSettingsPanel',
        'practiceResultsPanel',
        'practiceDiagnosticsPanel',
        '#practicePrecisionSelector',
        '#practiceHotfixControls',
        '#practiceJudgmentBreakdown',
        '#practicePolishResultActions',
        '#practiceWorkspaceResultHeadline',
        'window.rilMultiVocals?.diagnostics?.stems',
        'Conductor + event timestamps',
        'Keyboard shortcuts',
        'practiceWorkspaceLibraryModal',
    )
    assert_all(styles, ".practice-context-toolbar", ".practice-context-panel", "#practiceRangePanel .practice-precision-track", ".workspace-modal")

    # Dashboard and navigation are task-oriented rather than lifetime-stat-first.
    assert_all(
        workspace,
        'navGroup("Library"',
        'navGroup("Play"',
        'navGroup("Analyze"',
        'navGroup("System"',
        'Continue where you left off',
        'data-workspace-go="practice"',
        'data-workspace-go="import"',
        'data-workspace-go="record"',
        'data-workspace-go="analysis"',
        'Lifetime statistics',
    )

    # Import is one selected adapter at a time; FNF folder/single modes live inside FNF.
    assert_all(
        import_center,
        'data-import-tab="fnf"',
        'data-import-tab="osu"',
        'data-import-tab="quaver"',
        'data-import-tab="ril"',
        'import-format-hidden',
        'data-fnf-mode-tab="folder"',
        'data-fnf-mode-tab="single"',
        'id="fnfFolderImportMount"',
        'id="fnfSingleImportMount"',
    )
    assert '#fnfFolderImportMount' in fnf_batch
    assert_all(styles, ".import-format-hidden", ".fnf-mode-hidden")

    # Responsive desktop/laptop fallback remains part of the workspace layer.
    assert_all(styles, "@media(max-width:1250px)", "@media(max-width:1030px)", "@media(max-width:760px)")

    assert APP_VERSION == "5.0.0-dev"
    print(f"Rhythm Input Lab {APP_VERSION} workspace UI self-test passed.")


if __name__ == "__main__":
    main()
