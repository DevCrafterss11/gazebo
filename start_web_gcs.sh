#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gateway_pid=""
frontend_pid=""

cleanup() {
    [[ -z "${frontend_pid}" ]] || kill "${frontend_pid}" 2>/dev/null || true
    [[ -z "${gateway_pid}" ]] || kill "${gateway_pid}" 2>/dev/null || true
    [[ -z "${frontend_pid}" ]] || wait "${frontend_pid}" 2>/dev/null || true
    [[ -z "${gateway_pid}" ]] || wait "${gateway_pid}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    "${project_dir}/mavlink-gateway/dev.sh" &
    gateway_pid="$!"
    for _ in $(seq 1 100); do
        curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1 && break
        kill -0 "${gateway_pid}" 2>/dev/null || wait "${gateway_pid}"
        sleep 0.2
    done
fi

if curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
    echo "MUVA Web GCS is already running at http://localhost:5173"
    [[ -z "${gateway_pid}" ]] || wait "${gateway_pid}"
    exit 0
fi

"${project_dir}/web-gcs/dev.sh" "$@" &
frontend_pid="$!"
wait "${frontend_pid}"
