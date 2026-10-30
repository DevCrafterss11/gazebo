#!/usr/bin/env bash
set -euo pipefail

command_script="$1"
sim_vehicle_pid="${MUVA_SITL_PARENT_PID:-}"

if [[ ! "${sim_vehicle_pid}" =~ ^[0-9]+$ ]] || [[ ! -r "/proc/${sim_vehicle_pid}/cmdline" ]]; then
    echo "Unable to identify sim_vehicle.py parent for the SITL console" >&2
    exit 1
fi

exec gnome-terminal --wait -- bash -c '
sim_vehicle_pid="$1"
command_script="$2"
setsid "${command_script}" &
sitl_pid=$!

while kill -0 "${sim_vehicle_pid}" 2>/dev/null && kill -0 "${sitl_pid}" 2>/dev/null; do
    sleep 0.25
done

kill -TERM -- "-${sitl_pid}" 2>/dev/null || true
sleep 0.5
kill -KILL -- "-${sitl_pid}" 2>/dev/null || true
wait "${sitl_pid}" 2>/dev/null || true
' muva-sitl-console "${sim_vehicle_pid}" "${command_script}"
