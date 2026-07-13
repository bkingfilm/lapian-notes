#!/bin/bash
# 拉片笔记 macOS 一键启动:双击本文件即可。
# 第一次运行会自动准备运行环境和程序组件,之后每次秒开。
cd "$(dirname "$0")"

say_line() { printf '%s\n' "$1"; }

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
  fi
fi

if [ -z "$NODE_EXE" ]; then
  NODE_DIR="$PWD/.node"
  NODE_EXE="$NODE_DIR/bin/node"
  if [ ! -x "$NODE_EXE" ]; then
    say_line "================================================"
    say_line " 第一次运行:正在下载运行环境(约 40MB)"
    say_line " 只需要一次,请保持网络畅通,耐心等几分钟..."
    say_line "================================================"
    V="v22.20.0"
    case "$(uname -m)" in
      arm64) ARCH="darwin-arm64" ;;
      *) ARCH="darwin-x64" ;;
    esac
    N="node-$V-$ARCH"
    TARBALL="$TMPDIR/lapian-node.tar.gz"
    ok=""
    for BASE in "https://registry.npmmirror.com/-/binary/node" "https://nodejs.org/dist"; do
      if curl -fsSL --connect-timeout 15 "$BASE/$V/$N.tar.gz" -o "$TARBALL"; then ok=1; break; fi
    done
    if [ -z "$ok" ]; then
      say_line ""
      say_line "运行环境下载失败。请检查网络后重新双击本文件。"
      say_line "也可以手动安装 Node.js 后再试:https://nodejs.org/zh-cn"
      read -r -p "按回车键关闭..."
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

# 2. 安装依赖(国内镜像,日志落盘)
if [ ! -d node_modules ]; then
  say_line "================================================"
  say_line " 第一次运行:正在安装程序组件"
  say_line " 只需要一次,大约一两分钟..."
  say_line "================================================"
  NPM_CLI="$NODE_HOME/../lib/node_modules/npm/bin/npm-cli.js"
  [ -f "$NPM_CLI" ] || NPM_CLI="$NODE_HOME/node_modules/npm/bin/npm-cli.js"
  if [ -f "$NPM_CLI" ]; then
    "$NODE_EXE" "$NPM_CLI" install --no-audit --no-fund --registry=https://registry.npmmirror.com > install.log 2>&1
  else
    npm install --no-audit --no-fund --registry=https://registry.npmmirror.com > install.log 2>&1
  fi
  if [ ! -d node_modules ]; then
    say_line ""
    say_line "组件安装失败,最近日志:"
    tail -n 8 install.log 2>/dev/null
    say_line "请检查网络后重新双击本文件。"
    read -r -p "按回车键关闭..."
    exit 1
  fi
fi

# 3. 启动服务(node 直启 vite),日志落盘
say_line "正在启动拉片笔记..."
"$NODE_EXE" node_modules/vite/bin/vite.js --port 5173 > server.log 2> server-err.log &
SERVER_PID=$!

# 4. 等服务就绪后开浏览器
ready=""
for _ in $(seq 1 90); do
  if curl -fsS --max-time 2 "http://localhost:5173/" >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
  sleep 1
done
if [ -z "$ready" ]; then
  say_line "启动失败或超时。最近的服务日志:"
  tail -n 6 server-err.log 2>/dev/null
  say_line "请重新双击本文件;若反复失败,把这个窗口截图反馈。"
  read -r -p "按回车键关闭..."
  exit 1
fi
[ "$1" != "--test" ] && open "http://localhost:5173/"
say_line ""
say_line "================================================"
say_line " 拉片笔记已在浏览器打开:http://localhost:5173"
say_line " 请保持本窗口开着;用完后按 Ctrl+C 或直接关掉本窗口即可退出。"
say_line "================================================"
wait "$SERVER_PID"
