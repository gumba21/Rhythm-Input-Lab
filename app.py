from __future__ import annotations

import backend as _backend
import rhythm_input_lab_core as _core
from ril_version import APP_NAME, APP_VERSION

# The implementation modules historically carried separate hardcoded versions.
# All supported launch paths patch them from the single root VERSION file.
_backend.APP_NAME = APP_NAME
_backend.APP_VERSION = APP_VERSION
_core.APP_NAME = APP_NAME
_core.APP_VERSION = APP_VERSION

RhythmApp = _backend.RhythmApp
RecorderState = _backend.RecorderState
press_rows = _backend.press_rows
run_server = _backend.run_server
main = _backend.main


if __name__ == "__main__":
    main()
