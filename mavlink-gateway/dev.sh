#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv_dir="${project_dir}/.venv"
package_dir="${project_dir}/.packages"

if python3 -m ensurepip --version >/dev/null 2>&1; then
    if [[ ! -x "${venv_dir}/bin/pip" ]]; then
        python3 -m venv "${venv_dir}"
    fi
    runtime=("${venv_dir}/bin/python")
    if ! "${runtime[@]}" -c "import fastapi, pymavlink, uvicorn" >/dev/null 2>&1; then
        "${venv_dir}/bin/pip" install -r "${project_dir}/requirements.txt"
    fi
else
    mkdir -p "${package_dir}"
    export PYTHONPATH="${package_dir}${PYTHONPATH:+:${PYTHONPATH}}"
    runtime=(python3)
    if ! "${runtime[@]}" -c "import fastapi, pymavlink, uvicorn" >/dev/null 2>&1; then
        python3 -m pip install --target "${package_dir}" -r "${project_dir}/requirements.txt"
    fi
fi

cd "${project_dir}"
exec "${runtime[@]}" -m uvicorn muva_gateway.app:app --host 0.0.0.0 --port "${MUVA_GATEWAY_PORT:-8000}" "$@"
