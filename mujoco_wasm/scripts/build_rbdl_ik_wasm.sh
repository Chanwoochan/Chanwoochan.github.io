#!/usr/bin/env bash
set -euo pipefail

EMSDK_DIR="${EMSDK_DIR:-/tmp/emsdk}"
RBDL_SRC_DIR="${RBDL_SRC_DIR:-/home/rclab/rok3_ws/RobotControl2022/src/RBDL}"
RBDL_BUILD_DIR="${RBDL_BUILD_DIR:-/tmp/rbdl-wasm-build}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

source "$EMSDK_DIR/emsdk_env.sh" >/dev/null

rm -rf "$RBDL_BUILD_DIR"
mkdir -p "$RBDL_BUILD_DIR"

emcmake cmake -S "$RBDL_SRC_DIR" -B "$RBDL_BUILD_DIR" \
  -DRBDL_BUILD_STATIC=ON \
  -DRBDL_BUILD_ADDON_URDFREADER=ON \
  -DRBDL_BUILD_TESTS=OFF \
  -DRBDL_BUILD_ADDON_LUAMODEL=OFF \
  -DRBDL_BUILD_ADDON_MUSCLE=OFF \
  -DRBDL_BUILD_ADDON_GEOMETRY=OFF \
  -DEIGEN3_INCLUDE_DIR=/usr/include/eigen3

emmake make -C "$RBDL_BUILD_DIR" -j"$(nproc)"

cd "$PROJECT_DIR"
em++ -O3 -std=c++17 \
  src/ik_rbdl/daru_v4_rbdl.cpp \
  src/ik_rbdl/daru_rbdl_wasm.cpp \
  "$RBDL_BUILD_DIR/librbdl.a" \
  "$RBDL_BUILD_DIR/addons/urdfreader/librbdl_urdfreader.a" \
  -I src/ik_rbdl \
  -I "$RBDL_SRC_DIR/include" \
  -I "$RBDL_BUILD_DIR/include" \
  -I "$RBDL_SRC_DIR/addons/urdfreader" \
  -I "$RBDL_SRC_DIR/addons/urdfreader/thirdparty" \
  -I /usr/include/eigen3 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web \
  -s FORCE_FILESYSTEM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_daru_ik_init","_daru_ik_init_from_xml","_daru_ik_reset_ref","_daru_cg_from_state","_daru_ik_step"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","FS"]' \
  -o src/ik_rbdl/daru_rbdl_ik.js

printf 'Built: %s\n' "$PROJECT_DIR/src/ik_rbdl/daru_rbdl_ik.js"
printf 'Built: %s\n' "$PROJECT_DIR/src/ik_rbdl/daru_rbdl_ik.wasm"
