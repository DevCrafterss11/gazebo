#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runtime_dir="${XDG_RUNTIME_DIR:-/tmp}/muva-${UID}"
pid_file="${runtime_dir}/all-in-one.pid"
launcher_pattern="${project_dir}/start_all_muva.sh"

find_launcher_pid() {
    local candidate
    if [[ -r "${pid_file}" ]]; then
        candidate="$(tr -dc '0-9' <"${pid_file}")"
        if [[ -n "${candidate}" ]] && kill -0 "${candidate}" 2>/dev/null \
            && [[ -r "/proc/${candidate}/cmdline" ]] \
            && tr '\0' ' ' <"/proc/${candidate}/cmdline" | grep -Fq -- "${launcher_pattern}"; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    fi

    while read -r candidate; do
        [[ "${candidate}" == "$$" ]] && continue
        [[ -r "/proc/${candidate}/cmdline" ]] || continue
        if tr '\0' ' ' <"/proc/${candidate}/cmdline" | grep -Fq -- "${launcher_pattern}"; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done < <(pgrep -f -- "${launcher_pattern}" 2>/dev/null || true)
    return 1
}

if [[ "${1:-}" == "--status" ]]; then
    if launcher_pid="$(find_launcher_pid)"; then
        echo "MUVA 仿真正在运行（启动器 PID：${launcher_pid}）"
    else
        echo "MUVA 仿真当前未运行"
    fi
    exit 0
fi

if ! launcher_pid="$(find_launcher_pid)"; then
    rm -f "${pid_file}"
    if [[ -x "${project_dir}/start_security_range.sh" ]] && ! "${project_dir}/start_security_range.sh" stop; then
        echo "实验四靶场未能通过安全停止检查；独立 Gateway 保持运行。" >&2
        exit 1
    fi
    echo "MUVA 一键启动器当前未运行。"
    exit 0
fi

echo "正在关闭 MUVA 仿真（启动器 PID：${launcher_pid}）..."
kill -TERM "${launcher_pid}" 2>/dev/null || true

for _ in $(seq 1 60); do
    if ! kill -0 "${launcher_pid}" 2>/dev/null; then
        rm -f "${pid_file}"
        echo "MUVA 仿真已全部关闭。"
        exit 0
    fi
    sleep 0.2
done

echo "启动器仍在运行。" >&2
echo "拒绝强制终止启动器；请确认实验二机群安全落地后重试。" >&2
exit 1
