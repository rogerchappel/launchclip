#!/bin/sh
# Stands in for local Whisper and Ollama inside the container smoke. The host
# app worker it mirrors has neither; a make that reaches for one hangs or fails in
# production, so the smoke records the call and fails it.
printf '{"kind":"command","command":"%s","args":"%s"}\n' "$(basename "$0")" "$*" >> "${SMOKE_TRIPWIRE:-/dev/stderr}"
echo "container smoke: $(basename "$0") must not run here" >&2
exit 127
