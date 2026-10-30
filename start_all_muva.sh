#!/usr/bin/env bash
set -Eeuo pipefail

# Start both API gateways and the unified frontend. Simulation processes remain on demand.

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state_dir="${XDG_STATE_HOME:-${HOME}/.local/state}/muva"
runtime_dir="${XDG_RUNTIME_DIR:-/tmp}/muva-${UID}"
session_id="$(date +%Y%m%d-%H%M%S)"
log_dir="${state_dir}/logs/${session_id}"
lock_file="${runtime_dir}/all-in-one.lock"
pid_file="${runtime_dir}/all-in-one.pid"
browser_url="http://127.0.0.1:5173"
swarm_api_url="http://127.0.0.1:8002/api/swarm"
swarm_ws_url="ws://127.0.0.1:8002/ws/swarm"

mkdir -p "${log_dir}" "${runtime_dir}"

if ! command -v flock >/dev/null 2>&1; then
    echo "错误：系统缺少 flock，无法安全防止重复启动。"
    read -r -p "按回车键关闭..." _
    exit 1
fi

exec 9>"${lock_file}"
if ! flock -n 9; then
    echo "MUVA 仿真已经由另一个一键启动器托管。"
    echo "正在打开地面站：${browser_url}"
    xdg-open "${browser_url}" >/dev/null 2>&1 || true
    read -r -p "按回车键关闭此窗口..." _
    exit 0
fi

printf '%s\n' "$$" >"${pid_file}"

declare -a service_names=()
declare -a service_pids=()
cleanup_started=0
swarm_shutdown_confirmed=0
swarm_gateway_started=0

log() {
    printf '[%(%H:%M:%S)T] %s\n' -1 "$*"
}

fail() {
    printf '\n错误：%s\n' "$*" >&2
    printf '日志目录：%s\n' "${log_dir}" >&2
    if [[ -t 0 ]]; then
        read -r -p "按回车键停止已启动的服务并关闭..." _ || true
    fi
    exit 1
}

port_in_use() {
    ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq ":${1}$"
}

wait_for_http() {
    local url="$1"
    local pid_index="$2"
    local service_name="$3"
    local attempts="$4"
    for _ in $(seq 1 "${attempts}"); do
        if curl -fsS --max-time 1 "${url}" >/dev/null 2>&1; then return 0; fi
        kill -0 "${service_pids[pid_index]}" 2>/dev/null || fail "${service_name} 已意外退出"
        sleep 0.2
    done
    fail "${service_name} 未能在规定时间内就绪"
}

check_swarm_health() {
    curl -fsS --max-time 2 http://127.0.0.1:8002/api/swarm/health 2>/dev/null \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("experiment") == 2 and d.get("mode") == "sitl-gazebo" and d.get("gazeboWorldAvailable") is True' >/dev/null 2>&1
}

safe_shutdown_swarm() {
    local health session_id response
    ((swarm_gateway_started == 1)) || return 0
    health="$(curl -fsS --max-time 2 http://127.0.0.1:8002/api/swarm/health 2>/dev/null)" || {
        log "实验二网关无法确认状态；为安全起见保留所有服务"
        return 1
    }
    if ! printf '%s' "${health}" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("experiment") == 2 and d.get("mode") == "sitl-gazebo"' >/dev/null 2>&1; then
        log "8002 不是受本启动器管理的实验二服务；为安全起见不停止服务"
        return 1
    fi
    session_id="$(printf '%s' "${health}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sessionId") or "")')"
    [[ -z "${session_id}" ]] && return 0
    response="$(curl -fsS --max-time 25 -X POST http://127.0.0.1:8002/api/swarm/shutdown \
        -H 'Content-Type: application/json' -d "{\"sessionId\":\"${session_id}\",\"action\":\"shutdown\"}" 2>&1)" || {
        log "实验二未能安全关闭：${response:-后端拒绝关闭}。请先返航并确认全部无人机落地上锁"
        return 1
    }
    log "实验二机群已安全关闭"
}

start_service() {
    local name="$1"
    local log_name="$2"
    shift 2

    log "启动 ${name}（日志：${log_name}）"
    setsid "$@" >>"${log_dir}/${log_name}" 2>&1 &
    local pid=$!
    service_names+=("${name}")
    service_pids+=("${pid}")
    sleep 1
    kill -0 "${pid}" 2>/dev/null || fail "${name} 启动失败，请查看 ${log_dir}/${log_name}"
}

stop_all() {
    local status=$?
    (( cleanup_started == 0 )) || return "${status}"
    if [[ -x "${project_dir}/start_security_range.sh" ]] && ! "${project_dir}/start_security_range.sh" stop; then
        log "实验四靶场未能安全停止；保留平台服务"
        return 1
    fi
    if ((swarm_shutdown_confirmed == 0)) && ! safe_shutdown_swarm; then
        log "未停止平台服务；实验二网关保持运行以保护飞行中的机群"
        return 1
    fi
    cleanup_started=1
    trap - EXIT INT TERM
    rm -f "${pid_file}"

    if ((${#service_pids[@]} > 0)); then
        printf '\n'
        log "正在停止 MUVA 全部服务..."
        for ((index=${#service_pids[@]} - 1; index >= 0; index--)); do
            local pid="${service_pids[index]}"
            local name="${service_names[index]}"
            if kill -0 "${pid}" 2>/dev/null; then
                log "停止 ${name}"
                kill -TERM -- "-${pid}" 2>/dev/null || true
            fi
        done

        local deadline=$((SECONDS + 8))
        while ((SECONDS < deadline)); do
            local any_running=0
            for pid in "${service_pids[@]}"; do
                kill -0 "${pid}" 2>/dev/null && any_running=1
            done
            ((any_running == 0)) && break
            sleep 0.2
        done

        for pid in "${service_pids[@]}"; do
            if kill -0 "${pid}" 2>/dev/null; then
                kill -KILL -- "-${pid}" 2>/dev/null || true
            fi
            wait "${pid}" 2>/dev/null || true
        done
        log "全部服务已停止"
    fi
    return "${status}"
}

request_stop() {
    log "收到关闭请求，将按实验各自的安全状态停止服务..."
    exit 0
}

trap stop_all EXIT
trap request_stop INT TERM

for required in curl python3 setsid ss; do
    command -v "${required}" >/dev/null 2>&1 || fail "缺少必需命令：${required}"
done

[[ -x "${project_dir}/mavlink-gateway/dev.sh" ]] || fail "找不到 MAVLink 网关启动脚本"
[[ -x "${project_dir}/start_unified_frontend.sh" ]] || fail "找不到统一平台前端启动脚本"
swarm_python="${project_dir}/mavlink-gateway/.venv/bin/python"
swarm_pythonpath="${project_dir}/mavlink-gateway/.packages:${project_dir}/mavlink-gateway${PYTHONPATH:+:${PYTHONPATH}}"
if [[ ! -x "${swarm_python}" ]] || ! "${swarm_python}" -c 'import fastapi, pymavlink, uvicorn' >/dev/null 2>&1; then
    swarm_python=python3
    PYTHONPATH="${swarm_pythonpath}" "${swarm_python}" -c 'import fastapi, pymavlink, uvicorn' >/dev/null 2>&1 \
        || fail "Python 缺少实验二网关依赖；请安装 mavlink-gateway/requirements.txt"
fi
[[ -x "${project_dir}/ardupilot/build/sitl/bin/arducopter" ]] || fail "未找到 ArduCopter SITL；请先编译 ardupilot/build/sitl/bin/arducopter"
[[ -f "${project_dir}/ardupilot_gazebo/build/libArduPilotPlugin.so" && -f "${project_dir}/ardupilot_gazebo/worlds/experiment2_swarm.sdf" ]] \
    || fail "未找到实验二 Gazebo 插件或 world；请先构建 ardupilot_gazebo"
command -v gz >/dev/null 2>&1 || fail "未找到 Gazebo Sim 的 gz 命令"

for port in 8000 8002 5173; do
    port_in_use "${port}" && fail "TCP 端口 ${port} 已被占用，请先关闭占用它的程序"
done

printf '\nMUVA 仿真一键启动\n'
printf '项目目录：%s\n' "${project_dir}"
printf '日志目录：%s\n\n' "${log_dir}"

start_service "MAVLink 网关" "gateway.log" env MUVA_PROJECT_DIR="${project_dir}" MUVA_LOG_DIR="${log_dir}" "${project_dir}/mavlink-gateway/dev.sh"
log "等待 MAVLink 网关 HTTP 服务..."
wait_for_http http://127.0.0.1:8000/api/health 0 "实验一 MAVLink 网关" 100

start_service "实验二 Gazebo SITL 网关" "swarm-gateway.log" env \
    PYTHONPATH="${swarm_pythonpath}" \
    MUVA_SWARM_STATE_DIR="${state_dir}/experiment2" \
    MUVA_SWARM_CORS_ORIGINS="http://127.0.0.1:5173,http://localhost:5173" \
    "${swarm_python}" -m uvicorn muva_gateway.swarm_app:app --app-dir "${project_dir}/mavlink-gateway" --host 127.0.0.1 --port 8002
swarm_gateway_started=1
log "等待实验二网关 HTTP 服务..."
wait_for_http http://127.0.0.1:8002/api/swarm/health 1 "实验二网关" 100
check_swarm_health || fail "8002 上的服务不是预期的 Gazebo SITL 网关"

"${project_dir}/start_security_range.sh" start

start_service "MUVA 统一教学平台" "teaching-frontend.log" env \
    VITE_DATA_SOURCE=api VITE_SWARM_DATA_SOURCE=api VITE_ASSESSMENT_SOURCE=mock \
    VITE_SECURITY_API_BASE_URL="http://127.0.0.1:8004/api" \
    VITE_SWARM_API_BASE_URL="${swarm_api_url}" VITE_SWARM_WS_URL="${swarm_ws_url}" \
    "${project_dir}/start_unified_frontend.sh" --host 127.0.0.1 --port 5173
log "等待 MUVA 教学平台..."
wait_for_http "${browser_url}" 2 "MUVA 统一教学平台" 150

printf '\n'
log "教学平台和两个 API 网关已就绪；Gazebo/SITL 将在各实验初始化时启动"
notify-send "MUVA 仿真" "教学平台已就绪，实验一和实验二使用独立真实仿真服务" 2>/dev/null || true

xdg-open "${browser_url}" >/dev/null 2>&1 || true
printf '\n教学平台：%s\n' "${browser_url}"
printf '日志：%s\n' "${log_dir}"
printf '请保持此窗口开启；按 Ctrl+C 或关闭窗口即可停止全部服务。\n\n'

while true; do
    for index in "${!service_pids[@]}"; do
        if ! kill -0 "${service_pids[index]}" 2>/dev/null; then
            fail "${service_names[index]} 已意外退出"
        fi
    done
    sleep 2
done
