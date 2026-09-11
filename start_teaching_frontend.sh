#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
frontend_dir="${project_dir}/gazebo/gazebo"
node_bin_dir="${project_dir}/.tools/node/bin"

[[ -f "${frontend_dir}/package.json" ]] || {
    echo "错误：未找到教学前端 ${frontend_dir}/package.json" >&2
    exit 1
}

export PATH="${node_bin_dir}:${PATH}"
export VITE_DATA_SOURCE=api
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://127.0.0.1:8000/api}"
export VITE_TELEMETRY_WS_URL="${VITE_TELEMETRY_WS_URL:-ws://127.0.0.1:8000/ws/telemetry}"
export VITE_MAVLINK_MONITOR_WS_URL="${VITE_MAVLINK_MONITOR_WS_URL:-ws://127.0.0.1:8000/ws/mavlink/monitor}"

cd "${frontend_dir}"
exec npm run dev -- "$@"
