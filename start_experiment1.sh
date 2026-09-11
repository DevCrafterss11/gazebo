#!/usr/bin/env bash
set -Eeuo pipefail

# 实验一快捷启动器。
# 不修改或替代 start_all_muva.sh，只负责启动它并打开实验一页面。

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
launcher="${project_dir}/start_all_muva.sh"
experiment_url="http://127.0.0.1:5173/experiments/basic-flight"
startup_log="${XDG_STATE_HOME:-${HOME}/.local/state}/muva/experiment1-launcher.log"

[[ -x "${launcher}" ]] || { echo "错误：找不到 ${launcher}" >&2; exit 1; }

if curl -fsS --max-time 1 http://127.0.0.1:5173/ >/dev/null 2>&1 \
    && curl -fsS --max-time 1 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    echo "MUVA 仿真已经在运行，直接打开实验一。"
else
    mkdir -p "$(dirname "${startup_log}")"
    echo "正在启动 Gazebo、ArduPilot SITL、MAVLink 网关和教学前端..."
    nohup setsid "${launcher}" </dev/null >>"${startup_log}" 2>&1 &
    launcher_pid=$!
    echo "启动器 PID：${launcher_pid}"
fi

echo "等待教学平台网页就绪..."
for _ in $(seq 1 180); do
    if curl -fsS --max-time 1 http://127.0.0.1:5173/ >/dev/null 2>&1; then
        xdg-open "${experiment_url}" >/dev/null 2>&1 || true
        echo "实验一已就绪：${experiment_url}"
        echo "如需停止全部服务，请执行：${project_dir}/stop_all_muva.sh"
        exit 0
    fi
    sleep 1
done

echo "错误：教学平台未能在 180 秒内就绪。" >&2
echo "请查看启动日志：${startup_log}" >&2
exit 1
