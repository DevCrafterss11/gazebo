#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tool_dir="${project_dir}/.tools/node"
node_version="22.19.0"

if command -v node >/dev/null 2>&1; then
    node_bin_dir="$(dirname "$(command -v node)")"
else
    node_bin_dir="${tool_dir}/bin"
    if [[ ! -x "${node_bin_dir}/node" ]]; then
        archive="${project_dir}/.tools/node.tar.xz"
        mkdir -p "${tool_dir}"
        curl -fsSL "https://nodejs.org/dist/v${node_version}/node-v${node_version}-linux-x64.tar.xz" -o "${archive}"
        tar -xJf "${archive}" -C "${tool_dir}" --strip-components=1
        rm -f "${archive}"
    fi
fi

export PATH="${node_bin_dir}:${PATH}"
cd "${project_dir}"

if [[ ! -d node_modules ]]; then
    npm install
fi

exec npm run dev -- "$@"
