#!/usr/bin/env bash
set -Eeuo pipefail

# MUVA one-click launcher. It owns every process it starts, keeps their logs,
# and shuts the complete stack down when this launcher exits.

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state_dir="${XDG_STATE_HOME:-${HOME}/.local/state}/muva"
runtime_dir="${XDG_RUNTIME_DIR:-/tmp}/muva-${UID}"
session_id="$(date +%Y%m%d-%H%M%S)"
log_dir="${state_dir}/logs/${session_id}"
lock_file="${runtime_dir}/all-in-one.lock"
pid_file="${runtime_dir}/all-in-one.pid"
browser_url="http://127.0.0.1:5173"

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

trap stop_all EXIT
trap 'exit 130' INT TERM

for required in gz curl python3 setsid ss; do
    command -v "${required}" >/dev/null 2>&1 || fail "缺少必需命令：${required}"
done

[[ -x "${project_dir}/start_iris_gazebo.sh" ]] || fail "找不到 Gazebo 启动脚本"
[[ -x "${project_dir}/start_iris_sitl.sh" ]] || fail "找不到 SITL 启动脚本"
[[ -x "${project_dir}/mavlink-gateway/dev.sh" ]] || fail "找不到 MAVLink 网关启动脚本"
[[ -x "${project_dir}/start_teaching_frontend.sh" ]] || fail "找不到教学前端启动脚本"

for port in 8000 5173; do
    port_in_use "${port}" && fail "TCP 端口 ${port} 已被占用，请先关闭占用它的程序"
done

printf '\nMUVA 仿真一键启动\n'
printf '项目目录：%s\n' "${project_dir}"
printf '日志目录：%s\n\n' "${log_dir}"

start_service "Gazebo 仿真" "gazebo.log" "${project_dir}/start_iris_gazebo.sh"

log "等待 Gazebo 初始化..."
# The Gazebo discovery CLI may block for a long time while its transport
# daemon starts. SITL can safely start in parallel and reconnects to the
# simulator, so only use a short process-stability check here.
for _ in $(seq 1 8); do
    kill -0 "${service_pids[0]}" 2>/dev/null || fail "Gazebo 已意外退出"
    sleep 0.5
done
log "Gazebo 进程运行正常"

# sim_vehicle normally opens an interactive MAVProxy shell. The one-click
# launcher has no dedicated stdin for that shell, so keep MAVProxy alive in
# non-interactive mode while retaining its UDP outputs.
start_service "ArduCopter SITL" "sitl.log" \
    "${project_dir}/start_iris_sitl.sh" --mavproxy-args=--non-interactive
start_service "MAVLink 网关" "gateway.log" "${project_dir}/mavlink-gateway/dev.sh"

log "等待 MAVLink 网关 HTTP 服务..."
gateway_ready=0
for _ in $(seq 1 100); do
    if curl -fsS --max-time 1 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
        gateway_ready=1
        break
    fi
    kill -0 "${service_pids[2]}" 2>/dev/null || fail "MAVLink 网关已意外退出"
    sleep 0.2
done
((gateway_ready == 1)) || fail "MAVLink 网关未能在 20 秒内就绪"

start_service "MUVA 教学平台" "teaching-frontend.log" "${project_dir}/start_teaching_frontend.sh" --host 127.0.0.1

log "等待 MUVA 教学平台..."
web_ready=0
for _ in $(seq 1 150); do
    if curl -fsS --max-time 1 "${browser_url}" >/dev/null 2>&1; then
        web_ready=1
        break
    fi
    kill -0 "${service_pids[3]}" 2>/dev/null || fail "Web 地面站已意外退出"
    sleep 0.2
done
((web_ready == 1)) || fail "MUVA 教学平台未能在 30 秒内就绪"

vehicle_ready=0
log "等待飞控心跳（Gazebo 首次加载可能需要一些时间）..."
for _ in $(seq 1 120); do
    if curl -fsS --max-time 1 http://127.0.0.1:8000/api/health 2>/dev/null | grep -q '"vehicleConnected":true'; then
        vehicle_ready=1
        break
    fi
    sleep 0.5
done

printf '\n'
if ((vehicle_ready == 1)); then
    log "全部组件和飞控链路均已就绪"
    notify-send "MUVA 仿真" "Gazebo、SITL 和教学平台已全部启动" 2>/dev/null || true
else
    log "界面已就绪，但暂未收到飞控心跳；请查看 Gazebo 和 sitl.log"
    notify-send "MUVA 仿真" "地面站已启动，当前仍在等待飞控心跳" 2>/dev/null || true
fi

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
