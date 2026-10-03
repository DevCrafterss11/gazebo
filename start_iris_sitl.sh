#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ardupilot_dir="${MUVA_ARDUPILOT_DIR:-${workspace}/ardupilot}"
defaults_dir="${ardupilot_dir}/Tools/autotest/default_params"

cd "${ardupilot_dir}"
exec Tools/autotest/sim_vehicle.py \
    -v ArduCopter \
    -f gazebo-iris \
    --model JSON \
    --add-param-file="${defaults_dir}/copter.parm" \
    --add-param-file="${defaults_dir}/gazebo-iris.parm" \
    --custom-location=34.125159,108.828965,412,0 \
    --out=127.0.0.1:14552 \
    --out=127.0.0.1:14553 \
    -N \
    "$@"
