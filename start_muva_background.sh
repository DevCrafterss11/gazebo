#!/usr/bin/env bash
set -Eeuo pipefail

# Desktop launcher: detach the long-running supervisor from the terminal.
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state_dir="${XDG_STATE_HOME:-${HOME}/.local/state}/muva"
log_dir="${state_dir}/logs"
mkdir -p "${log_dir}"

log_file="${log_dir}/desktop-launcher.log"

# start_all_muva.sh must remain alive because its EXIT trap owns the services
# it starts. Detach it from the desktop terminal instead of letting that
# terminal become its parent/session.
setsid "${project_dir}/start_all_muva.sh" \
    >>"${log_file}" 2>&1 < /dev/null &
launcher_pid=$!
disown "${launcher_pid}" 2>/dev/null || true

printf 'MUVA 已在后台启动（PID: %s）\n日志：%s\n' "${launcher_pid}" "${log_file}"
