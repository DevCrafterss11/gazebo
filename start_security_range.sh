#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gateway_dir="${project_dir}/mavlink-gateway"
state_dir="${XDG_STATE_HOME:-${HOME}/.local/state}/muva/security-range"
runtime_dir="${XDG_RUNTIME_DIR:-/tmp}/muva-${UID}"
pid_file="${runtime_dir}/security-range.pid"
log_file="${state_dir}/gateway.log"
port=8004
action="${1:-start}"

mkdir -p "${state_dir}" "${runtime_dir}"

running_pid() {
    [[ -r "${pid_file}" ]] || return 1
    local pid
    pid="$(tr -dc '0-9' <"${pid_file}")"
    [[ -n "${pid}" && -r "/proc/${pid}/cmdline" ]] || return 1
    tr '\0' ' ' <"/proc/${pid}/cmdline" | grep -Fq "muva_gateway.app:app" || return 1
    printf '%s\n' "${pid}"
}

is_healthy() {
    curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/v1/security/range/status" >/dev/null 2>&1
}

case "${action}" in
    start)
        if is_healthy; then
            echo "实验四独立 Gateway 已运行：http://127.0.0.1:${port}"
            exit 0
        fi
        if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq ":${port}$"; then
            echo "端口 ${port} 已被其他服务占用，未启动实验四 Gateway。" >&2
            exit 1
        fi

        if [[ -x "${gateway_dir}/.venv/bin/python" ]] && "${gateway_dir}/.venv/bin/python" -c 'import fastapi, pymavlink, uvicorn' >/dev/null 2>&1; then
            runtime=("${gateway_dir}/.venv/bin/python")
            export PYTHONPATH="${gateway_dir}${PYTHONPATH:+:${PYTHONPATH}}"
        else
            mkdir -p "${gateway_dir}/.packages"
            export PYTHONPATH="${gateway_dir}/.packages:${gateway_dir}${PYTHONPATH:+:${PYTHONPATH}}"
            runtime=(python3)
            if ! "${runtime[@]}" -c 'import fastapi, pymavlink, uvicorn' >/dev/null 2>&1; then
                python3 -m pip install --target "${gateway_dir}/.packages" -r "${gateway_dir}/requirements.txt"
            fi
        fi

        env \
            PYTHONPATH="${PYTHONPATH}" \
            MUVA_PROJECT_DIR="${project_dir}" \
            MUVA_LOG_DIR="${state_dir}/runtime" \
            MUVA_PLATFORM_DATA="${state_dir}/platform.json" \
            MUVA_MAVLINK_ENDPOINT="udpin:0.0.0.0:14754" \
            MUVA_MONITOR_ENDPOINT="udpin:0.0.0.0:14755" \
            MUVA_SECURITY_MAVLINK_ENDPOINT="udpin:0.0.0.0:14752" \
            MUVA_SECURITY_MONITOR_ENDPOINT="udpin:0.0.0.0:14753" \
            MUVA_SECURITY_SITL_MAVLINK_PORT="14752" \
            MUVA_SECURITY_SITL_MONITOR_PORT="14753" \
            MUVA_CORS_ORIGINS="http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5175,http://localhost:5175" \
            setsid "${runtime[@]}" -m uvicorn muva_gateway.app:app --app-dir "${gateway_dir}" --host 127.0.0.1 --port "${port}" \
            >>"${log_file}" 2>&1 </dev/null &
        pid=$!
        printf '%s\n' "${pid}" >"${pid_file}"

        for _ in $(seq 1 50); do
            if is_healthy; then
                echo "实验四独立 Gateway 已就绪：http://127.0.0.1:${port}"
                exit 0
            fi
            if ! kill -0 "${pid}" 2>/dev/null; then
                rm -f "${pid_file}"
                echo "实验四 Gateway 启动失败，查看日志：${log_file}" >&2
                exit 1
            fi
            sleep 0.2
        done
        echo "实验四 Gateway 未能及时就绪，查看日志：${log_file}" >&2
        exit 1
        ;;
    status)
        if is_healthy; then
            echo "实验四独立 Gateway 正常：http://127.0.0.1:${port}"
        else
            echo "实验四独立 Gateway 未运行。"
            exit 1
        fi
        ;;
    stop)
        if ! is_healthy; then
            if pid="$(running_pid)"; then
                echo "Gateway 进程存在但未就绪；拒绝强制终止：${pid}" >&2
                exit 1
            fi
            rm -f "${pid_file}"
            echo "实验四独立 Gateway 未运行。"
            exit 0
        fi
        response="$(curl -fsS --max-time 15 -X POST "http://127.0.0.1:${port}/api/v1/security/range/stop" 2>&1)" || {
            echo "靶场未能通过安全停止检查；Gateway 保持运行：${response}" >&2
            exit 1
        }
        if pid="$(running_pid)"; then
            kill -TERM "${pid}" 2>/dev/null || true
            for _ in $(seq 1 30); do
                kill -0 "${pid}" 2>/dev/null || break
                sleep 0.2
            done
            if kill -0 "${pid}" 2>/dev/null; then
                echo "Gateway 未响应正常关闭信号，保留进程：${pid}" >&2
                exit 1
            fi
        fi
        rm -f "${pid_file}"
        echo "实验四独立 Gateway 已安全停止。"
        ;;
    *)
        echo "用法：$0 {start|status|stop}" >&2
        exit 2
        ;;
esac
