#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
frontend_dir="${project_dir}/MUVA_unified_full_student_v2_integrated"
node_bin_dir="${project_dir}/.tools/node/bin"

[[ -f "${frontend_dir}/package.json" ]] || {
    echo "错误：未找到统一平台前端 ${frontend_dir}/package.json" >&2
    exit 1
}

export PATH="${node_bin_dir}:${PATH}"
export VITE_DATA_SOURCE="${VITE_DATA_SOURCE:-mock}"
cd "${frontend_dir}"
exec npm run dev -- "$@"
