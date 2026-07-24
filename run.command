#!/bin/bash
# 拉片笔记 macOS 一键启动:双击本文件即可。
# 第一次运行会自动准备运行环境和程序组件,之后每次秒开。
cd "$(dirname "$0")"

say_line() { printf '%s\n' "$1"; }

# 系统语言是中文时优先国内镜像,其它语言优先官方源(海外用户走 npmmirror 会绕远路)
PREFERS_CHINA=""
case "${LANG:-}${LC_ALL:-}" in zh*) PREFERS_CHINA=1 ;; esac

# 1. 找 node:优先系统安装,否则用/下载便携版
NODE_EXE=""
if [ "$1" != "--portable" ] && command -v node >/dev/null 2>&1; then
  # 工具需要 Node 20.19+ 或 22.12+;版本太旧会启动即崩,改用内置便携版
  SYS_NODE="$(command -v node)"
  NODE_VER="$("$SYS_NODE" --version 2>/dev/null | sed 's/^v//')"
  MAJ="${NODE_VER%%.*}"
  REST="${NODE_VER#*.}"
  MIN="${REST%%.*}"
  if { [ "$MAJ" = "20" ] && [ "${MIN:-0}" -ge 19 ]; } || { [ "$MAJ" = "22" ] && [ "${MIN:-0}" -ge 12 ]; } || [ "${MAJ:-0}" -ge 23 ]; then
    NODE_EXE="$SYS_NODE"
  else
    say_line "检测到电脑上的 Node.js 版本较旧(v$NODE_VER),将自动使用内置运行环境,不影响你原有的 Node。"
    say_line "Your installed Node.js is too old (v$NODE_VER); a bundled runtime will be used instead. Your own Node stays untouched."
  fi
fi

if [ -z "$NODE_EXE" ]; then
  NODE_DIR="$PWD/.node"
  NODE_EXE="$NODE_DIR/bin/node"
  if [ ! -x "$NODE_EXE" ]; then
    say_line "================================================"
    say_line " 第一次运行:正在下载运行环境(约 40MB)"
    say_line " First run: downloading the runtime (about 40MB)"
    say_line " 只需要一次,请保持网络畅通,耐心等几分钟... / One-time step, please wait a few minutes..."
    say_line "================================================"
    V="v22.20.0"
    case "$(uname -m)" in
      arm64) ARCH="darwin-arm64" ;;
      *) ARCH="darwin-x64" ;;
    esac
    N="node-$V-$ARCH"
    TARBALL="$TMPDIR/lapian-node.tar.gz"
    ok=""
    if [ -n "$PREFERS_CHINA" ]; then
      NODE_MIRRORS="https://registry.npmmirror.com/-/binary/node https://nodejs.org/dist"
    else
      NODE_MIRRORS="https://nodejs.org/dist https://registry.npmmirror.com/-/binary/node"
    fi
    for BASE in $NODE_MIRRORS; do
      if curl -fsSL --connect-timeout 15 "$BASE/$V/$N.tar.gz" -o "$TARBALL"; then ok=1; break; fi
    done
    if [ -z "$ok" ]; then
      say_line ""
      say_line "运行环境下载失败。请检查网络后重新双击本文件。"
      say_line "Runtime download failed. Check your network and double-click this file again."
      say_line "也可以手动安装 Node.js 后再试 / Or install Node.js manually and retry: https://nodejs.org"
      read -r -p "按回车键关闭... / Press Enter to close..."
      exit 1
    fi
    mkdir -p .node-tmp
    tar -xzf "$TARBALL" -C .node-tmp
    mv ".node-tmp/$N" "$NODE_DIR"
    rm -rf .node-tmp "$TARBALL"
  fi
fi
NODE_HOME="$(dirname "$NODE_EXE")"
export PATH="$NODE_HOME:$PATH"

# 2. 安装依赖(镜像按系统语言排序,日志落盘)
if [ ! -d node_modules ]; then
  say_line "================================================"
  say_line " 第一次运行:正在安装程序组件"
  say_line " First run: installing components"
  say_line " 只需要一次,大约一两分钟... / One-time step, takes a minute or two..."
  say_line "================================================"
  NPM_CLI="$NODE_HOME/../lib/node_modules/npm/bin/npm-cli.js"
  [ -f "$NPM_CLI" ] || NPM_CLI="$NODE_HOME/node_modules/npm/bin/npm-cli.js"
  if [ -n "$PREFERS_CHINA" ]; then
    REGISTRIES="https://registry.npmmirror.com https://registry.npmjs.org"
  else
    REGISTRIES="https://registry.npmjs.org https://registry.npmmirror.com"
  fi
  for REGISTRY in $REGISTRIES; do
    if [ -f "$NPM_CLI" ]; then
      "$NODE_EXE" "$NPM_CLI" install --no-audit --no-fund --registry="$REGISTRY" > install.log 2>&1
    else
      npm install --no-audit --no-fund --registry="$REGISTRY" > install.log 2>&1
    fi
    [ -d node_modules ] && break
  done
  if [ ! -d node_modules ]; then
    say_line ""
    say_line "组件安装失败,最近日志: / Component install failed, recent log:"
    tail -n 8 install.log 2>/dev/null
    say_line "请检查网络后重新双击本文件。"
    say_line "Check your network and double-click this file again."
    read -r -p "按回车键关闭... / Press Enter to close..."
    exit 1
  fi
fi

# 3. 启动服务(node 直启 vite),日志落盘
say_line "正在启动拉片笔记... / Starting Lapian Notes..."
"$NODE_EXE" node_modules/vite/bin/vite.js --port 5173 > server.log 2> server-err.log &
SERVER_PID=$!

# 4. 等服务就绪后开浏览器。5173 被占用时 vite 会自动换端口,就绪地址以服务日志里打出的为准,
#    不能写死 5173(否则服务明明活着,这里却会误报启动失败)。
ready=""
APP_URL=""
for _ in $(seq 1 90); do
  if [ -z "$APP_URL" ]; then
    APP_URL="$(grep -o 'http://localhost:[0-9]*/' server.log 2>/dev/null | head -n 1)"
  fi
  if [ -n "$APP_URL" ] && curl -fsS --max-time 2 "$APP_URL" >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
  sleep 1
done
if [ -z "$ready" ]; then
  say_line "启动失败或超时。最近的服务日志: / Startup failed or timed out. Recent server logs:"
  tail -n 6 server-err.log 2>/dev/null
  tail -n 6 server.log 2>/dev/null
  say_line "请重新双击本文件;若反复失败,把这个窗口截图反馈。"
  say_line "Double-click this file to retry; if it keeps failing, screenshot this window and report it."
  read -r -p "按回车键关闭... / Press Enter to close..."
  exit 1
fi
[ "$1" != "--test" ] && open "$APP_URL"
say_line ""
say_line "================================================"
say_line " 拉片笔记已在浏览器打开:$APP_URL"
say_line " Lapian Notes is open in your browser: $APP_URL"
say_line " 请保持本窗口开着;用完后按 Ctrl+C 或直接关掉本窗口即可退出。"
say_line " Keep this window open while you work; press Ctrl+C or close it to quit."
say_line "================================================"
wait "$SERVER_PID"
