#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state_dir="${XDG_STATE_HOME:-${HOME}/.local/state}/muva"
log_dir="${state_dir}/logs"
mkdir -p "${log_dir}"
log_file="${log_dir}/desktop-cleanup-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "${log_file}") 2>&1

echo "MUVA 环境清理"
echo "项目：${project_dir}"
echo "日志：${log_file}"
echo
echo "此操作将停止本项目的网关、前端、Gazebo 和 ArduPilot SITL 进程。"
echo "若实验二安全关闭检查失败，清理会中止，不会强制结束飞行中的机群。"
read -r -p "确认无飞行任务，并输入 CLEAN 继续：" confirmation
if [[ "${confirmation}" != "CLEAN" ]]; then
    echo "已取消。"
    exit 0
fi

for state in "${state_dir}/experiment2" "${state_dir}/experiment2-real"; do
    if [[ -d "${state}" ]]; then
        echo "检查并停止实验二服务：${state}"
        if ! MUVA_SWARM_STATE_DIR="${state}" "${project_dir}/stop_experiment2.sh"; then
            echo "安全停止实验二失败，已中止清理。请确认机群返航并落地后重试。" >&2
            exit 1
        fi
    fi
done

echo "停止一键启动器管理的服务..."
if ! "${project_dir}/stop_all_muva.sh"; then
    echo "一键启动器未能安全停止，已中止残留进程清理。" >&2
    exit 1
fi

echo "扫描并清理残留的项目进程..."
python3 "${project_dir}/clean_muva_processes.py"
echo "完成。下次启动前可确认 8000、8002、5173、5174 端口已释放。"
