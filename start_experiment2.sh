#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state_dir="${MUVA_SWARM_STATE_DIR:-${XDG_STATE_HOME:-${HOME}/.local/state}/muva/experiment2}"
gateway_port="${MUVA_SWARM_GATEWAY_PORT:-8002}"
frontend_port="${MUVA_SWARM_FRONTEND_PORT:-5174}"
mkdir -p "${state_dir}"
export PATH="${project_dir}/.tools/node/bin:${PATH}"
export PYTHONPATH="${project_dir}/mavlink-gateway/.packages:${project_dir}/mavlink-gateway${PYTHONPATH:+:${PYTHONPATH}}"
export MUVA_SWARM_STATE_DIR="${state_dir}"
export MUVA_SWARM_CORS_ORIGINS="http://127.0.0.1:${frontend_port},http://localhost:${frontend_port}"

if [[ ! -x "${MUVA_SWARM_SITL_BINARY:-${project_dir}/ardupilot/build/sitl/bin/arducopter}" ]]; then
    echo "未找到 ArduCopter SITL；先执行：cd ${project_dir}/ardupilot && ./waf configure --board sitl && ./waf copter" >&2
    exit 1
fi
if [[ ! -f "${MUVA_ARDUPILOT_GAZEBO_DIR:-${project_dir}/ardupilot_gazebo}/build/libArduPilotPlugin.so" \
    || ! -f "${MUVA_ARDUPILOT_GAZEBO_DIR:-${project_dir}/ardupilot_gazebo}/worlds/experiment2_swarm.sdf" ]] \
    || ! command -v gz >/dev/null 2>&1; then
    echo "未找到实验二 Gazebo world、ArduPilot 插件或 gz 命令；请先构建 ardupilot_gazebo" >&2
    exit 1
fi
python3 -c 'import fastapi, pymavlink, uvicorn' || { echo "请先安装 mavlink-gateway/requirements.txt（或运行 mavlink-gateway/dev.sh 完成依赖安装）" >&2; exit 1; }
health="$(curl -fsS --max-time 2 "http://127.0.0.1:${gateway_port}/api/swarm/health" 2>/dev/null || true)"
if [[ -n "${health}" ]]; then
    if ! printf '%s' "${health}" | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get("experiment") == 2 and data.get("mode") == "sitl-gazebo" and data.get("gazeboWorldAvailable") is True and data.get("ekfPreflight") is True' >/dev/null 2>&1; then
        echo "端口 ${gateway_port} 上不是当前版本的实验二 SITL 服务；确认机群落地后停止旧服务，再启动实验二（不会接管现有后端）" >&2
        exit 1
    fi
else
    if ss -ltnH "sport = :${gateway_port}" | read -r _; then echo "端口 ${gateway_port} 已被其他服务占用，未终止它" >&2; exit 1; fi
    nohup setsid python3 -m uvicorn muva_gateway.swarm_app:app --host 127.0.0.1 --port "${gateway_port}" </dev/null >>"${state_dir}/gateway.log" 2>&1 &
    echo "$!" >"${state_dir}/gateway.pid"
fi
for attempt in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${gateway_port}/api/swarm/health" >/dev/null 2>&1; then break; fi
    if [[ "${attempt}" == 30 ]]; then echo "后端启动失败：${state_dir}/gateway.log" >&2; exit 1; fi
    sleep 1
done
if [[ -f "${state_dir}/frontend.pid" ]] && kill -0 "$(cat "${state_dir}/frontend.pid")" 2>/dev/null; then
    echo "实验二前端已运行"
else
    if ss -ltnH "sport = :${frontend_port}" | read -r _; then echo "端口 ${frontend_port} 已占用，请更换 MUVA_SWARM_FRONTEND_PORT；未改动现有前端" >&2; exit 1; fi
    cd "${project_dir}/MUVA_unified_full_student_v2_integrated"
    nohup setsid env VITE_DATA_SOURCE=mock VITE_ASSESSMENT_SOURCE=mock VITE_SWARM_DATA_SOURCE=api \
        VITE_SWARM_API_BASE_URL="http://127.0.0.1:${gateway_port}/api/swarm" VITE_SWARM_WS_URL="ws://127.0.0.1:${gateway_port}/ws/swarm" \
        node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "${frontend_port}" --strictPort </dev/null >>"${state_dir}/frontend.log" 2>&1 &
    echo "$!" >"${state_dir}/frontend.pid"
fi
for attempt in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${frontend_port}/" >/dev/null 2>&1; then break; fi
    if [[ "${attempt}" == 30 ]]; then echo "前端启动失败：${state_dir}/frontend.log" >&2; exit 1; fi
    sleep 1
done
experiment_url="http://127.0.0.1:${frontend_port}/experiments/swarm"
echo "实验二就绪：${experiment_url}"
echo "点击初始化机群后将启动实验二独立 Gazebo world 与2–6架 Gazebo-backed ArduCopter SITL。建议先使用2架。"
echo "实验一端口、飞控和进度不变；停止实验二：${project_dir}/stop_experiment2.sh"
if [[ "${MUVA_OPEN_BROWSER:-1}" == 1 ]]; then xdg-open "${experiment_url}" >/dev/null 2>&1 || true; fi
