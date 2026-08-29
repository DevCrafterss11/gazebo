#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_dir="${MUVA_ARDUPILOT_GAZEBO_DIR:-${workspace}/ardupilot_gazebo}"

export GZ_SIM_SYSTEM_PLUGIN_PATH="${plugin_dir}/build${GZ_SIM_SYSTEM_PLUGIN_PATH:+:${GZ_SIM_SYSTEM_PLUGIN_PATH}}"
export GZ_SIM_RESOURCE_PATH="${plugin_dir}/models:${plugin_dir}/worlds${GZ_SIM_RESOURCE_PATH:+:${GZ_SIM_RESOURCE_PATH}}"
# VMware SVGA flickers with Gazebo's accelerated Ogre2 rendering.
export LIBGL_ALWAYS_SOFTWARE=1

cd "${plugin_dir}"
exec gz sim -v4 -r --render-engine-gui ogre iris_runway.sdf "$@"
