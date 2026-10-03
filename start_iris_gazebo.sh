#!/usr/bin/env bash
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_dir="${MUVA_ARDUPILOT_GAZEBO_DIR:-${workspace}/ardupilot_gazebo}"

# Some systems retain the Gazebo 11 command wrapper but lose the Gazebo Sim 8
# runtime libraries required by ArduPilotPlugin.so. Keep a project-local
# runtime fallback so MUVA can start without modifying system packages.
local_gz_lib="${workspace}/.tools/gz-sim8/usr/lib/x86_64-linux-gnu"
local_gz_root="${workspace}/.tools/gz-sim8/usr"
local_gz_plugins="${local_gz_lib}/gz-sim-8/plugins"
local_physics_plugins="${local_gz_lib}/gz-physics-7/engine-plugins"
if [[ -d "${local_gz_lib}" ]]; then
    export LD_LIBRARY_PATH="${local_gz_lib}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
fi
if [[ -d "${local_gz_plugins}" ]]; then
    export GZ_SIM_SYSTEM_PLUGIN_PATH="${local_gz_plugins}${GZ_SIM_SYSTEM_PLUGIN_PATH:+:${GZ_SIM_SYSTEM_PLUGIN_PATH}}"
    export GZ_GUI_PLUGIN_PATH="${local_gz_plugins}/gui${GZ_GUI_PLUGIN_PATH:+:${GZ_GUI_PLUGIN_PATH}}"
    # Gazebo Sim GUI plugins import the bundled GzSim QML module.
    export QML2_IMPORT_PATH="${local_gz_plugins}/gui${QML2_IMPORT_PATH:+:${QML2_IMPORT_PATH}}"
    export QML_IMPORT_PATH="${local_gz_plugins}/gui${QML_IMPORT_PATH:+:${QML_IMPORT_PATH}}"
fi
if [[ -d "${local_physics_plugins}" ]]; then
    export GZ_SIM_PHYSICS_ENGINE_PATH="${local_physics_plugins}${GZ_SIM_PHYSICS_ENGINE_PATH:+:${GZ_SIM_PHYSICS_ENGINE_PATH}}"
fi

# Prefer the matching Gazebo Sim 8 command wrapper and point it at the
# project-local Ruby command module/configuration restored by setup scripts.
if [[ -x "${local_gz_root}/bin/gz" ]]; then
    export PATH="${local_gz_root}/bin${PATH:+:${PATH}}"
    export GZ_CONFIG_PATH="${local_gz_root}/share/gz${GZ_CONFIG_PATH:+:${GZ_CONFIG_PATH}}"
    export RUBYLIB="${local_gz_root}/lib/ruby${RUBYLIB:+:${RUBYLIB}}"
fi

export GZ_SIM_SYSTEM_PLUGIN_PATH="${plugin_dir}/build${GZ_SIM_SYSTEM_PLUGIN_PATH:+:${GZ_SIM_SYSTEM_PLUGIN_PATH}}"
export GZ_SIM_RESOURCE_PATH="${plugin_dir}/models:${plugin_dir}/worlds${GZ_SIM_RESOURCE_PATH:+:${GZ_SIM_RESOURCE_PATH}}"
# VMware SVGA flickers with Gazebo's accelerated Ogre2 rendering.
export LIBGL_ALWAYS_SOFTWARE=1

cd "${plugin_dir}"
exec gz sim -v4 -r --render-engine-gui ogre iris_runway.sdf "$@"
