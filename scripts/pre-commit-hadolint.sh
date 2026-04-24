#!/usr/bin/env bash
# Thin wrapper so the pre-commit hook works whether hadolint is installed
# locally or only available via Docker. Exits 0 silently if neither is found
# (prints a notice) so contributors without either can still commit.

set -euo pipefail

config=".hadolint.yaml"

if command -v hadolint >/dev/null 2>&1; then
    hadolint --config "${config}" "$@"
elif command -v docker >/dev/null 2>&1; then
    for file in "$@"; do
        docker run --rm -i \
            -v "${PWD}/${config}:/.config/hadolint.yaml:ro" \
            hadolint/hadolint hadolint --config /.config/hadolint.yaml - \
            < "${file}"
    done
else
    echo "hadolint: skipped — install hadolint (brew install hadolint) or run Docker" >&2
fi
