from __future__ import annotations

import backend as _backend
import rhythm_input_lab_core as _core
from asset_backend import install_note_atlas_endpoint
from media_backend import install_song_media_endpoint
from osu_import_backend import install_osu_import_endpoint
from practice_attempt_backend import install_practice_attempt_endpoint
from reports_backend import install_report_endpoint
from ril_package_backend import install_ril_package_endpoint
from ril_version import APP_NAME, APP_VERSION

# The implementation modules historically carried separate hardcoded versions.
# All supported launch paths patch them from the single root VERSION file.
_backend.APP_NAME = APP_NAME
_backend.APP_VERSION = APP_VERSION
_core.APP_NAME = APP_NAME
_core.APP_VERSION = APP_VERSION

install_report_endpoint()
install_note_atlas_endpoint(_backend)
install_song_media_endpoint(_backend)
install_practice_attempt_endpoint(_backend)
install_ril_package_endpoint(_backend)
install_osu_import_endpoint(_backend)

RhythmApp = _backend.RhythmApp
RecorderState = _backend.RecorderState
press_rows = _backend.press_rows
run_server = _backend.run_server
main = _backend.main


if __name__ == "__main__":
    main()
