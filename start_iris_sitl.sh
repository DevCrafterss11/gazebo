#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ardupilot_dir="${MUVA_ARDUPILOT_DIR:-${workspace}/ardupilot}"
defaults_dir="${ardupilot_dir}/Tools/autotest/default_params"
local_python_site="${workspace}/.tools/python-site"

# Use GNOME Terminal's supported argument form so ArduPilot SITL has a visible
# console and the terminal lifetime follows the managed simulator process.
export SITL_RITW_TERMINAL="${workspace}/start_sitl_terminal.sh"
# exec below preserves this PID as sim_vehicle.py, allowing the terminal helper
# to stop its detached SITL child when the managed runtime exits.
export MUVA_SITL_PARENT_PID="$$"

if [[ -d "${local_python_site}" ]]; then
    export PYTHONPATH="${local_python_site}${PYTHONPATH:+:${PYTHONPATH}}"
    export PATH="${local_python_site}/bin${PATH:+:${PATH}}"
fi

cd "${ardupilot_dir}"
exec Tools/autotest/sim_vehicle.py \
    -v ArduCopter \
    -f gazebo-iris \
    --model JSON \
    --add-param-file="${defaults_dir}/copter.parm" \
    --add-param-file="${defaults_dir}/gazebo-iris.parm" \
    --custom-location=34.125159,108.828965,412,0 \
    --out="127.0.0.1:${MUVA_SITL_MAVLINK_PORT:-14552}" \
    --out="127.0.0.1:${MUVA_SITL_MONITOR_PORT:-14553}" \
    -N \
    "$@"
