#!/usr/bin/env bash
set -Eeuo pipefail

state_dir="${MUVA_SWARM_STATE_DIR:-${XDG_STATE_HOME:-${HOME}/.local/state}/muva/experiment2}"
gateway_port="${MUVA_SWARM_GATEWAY_PORT:-8002}"
health="$(curl -fsS --max-time 2 "http://127.0.0.1:${gateway_port}/api/swarm/health" || true)"
if [[ -n "${health}" ]]; then
    session_id="$(printf '%s' "${health}" | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get("experiment") == 2 and data.get("mode") == "sitl" and data.get("gazebo") is False, "端口上不是实验二后端"; print(data.get("sessionId") or "")')"
    if [[ -n "${session_id}" ]]; then
        if ! curl -fsS --max-time 20 -X POST "http://127.0.0.1:${gateway_port}/api/swarm/shutdown" -H 'Content-Type: application/json' \
            -d "{\"sessionId\":\"${session_id}\",\"action\":\"shutdown\"}"; then
            echo "机群可能仍在飞行或调度中，拒绝停止。请先在实验二页面返航并确认全部降落。" >&2
            exit 1
        fi
    fi
fi
for name in frontend gateway; do
    file="${state_dir}/${name}.pid"
    if [[ -f "${file}" ]]; then
        process_id="$(cat "${file}")"
        if [[ "${process_id}" =~ ^[0-9]+$ ]] && kill -0 "${process_id}" 2>/dev/null; then
            command="$(tr '\0' ' ' <"/proc/${process_id}/cmdline")"
            if [[ "${name}" == gateway && "${command}" == *"muva_gateway.swarm_app:app"* || "${name}" == frontend && "${command}" == *"node_modules/vite/bin/vite.js"* ]]; then
                kill -TERM "${process_id}"
            else
                echo "PID ${process_id} 不属于记录的实验二服务，未终止它" >&2
                exit 1
            fi
        fi
        rm -f "${file}"
    fi
done
echo "实验二已停止；实验一与其他进程未改动。"
