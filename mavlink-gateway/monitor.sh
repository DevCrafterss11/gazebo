#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv_python="${project_dir}/.venv/bin/python"

if [[ -x "${venv_python}" ]] && "${venv_python}" -c "import pymavlink" >/dev/null 2>&1; then
    runtime=("${venv_python}")
else
    export PYTHONPATH="${project_dir}/.packages${PYTHONPATH:+:${PYTHONPATH}}"
    runtime=(python3)
fi

cd "${project_dir}"
exec "${runtime[@]}" mavlink_monitor.py "$@"
