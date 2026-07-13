param([switch]$test, [switch]$portable)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot
[Environment]::CurrentDirectory = $PSScriptRoot

function Say($msg) { Write-Host $msg }

# 1. 找 node:优先系统安装,否则用/下载便携版
$nodeExe = $null
if (-not $portable) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    # 工具需要 Node 20.19+ 或 22.12+;版本太旧会启动即崩,改用内置便携版
    $verText = (& $cmd.Source --version) 2>$null
    if ($verText -match 'v(\d+)\.(\d+)') {
      $maj = [int]$Matches[1]; $min = [int]$Matches[2]
      $ok = ($maj -eq 20 -and $min -ge 19) -or ($maj -eq 22 -and $min -ge 12) -or ($maj -ge 23)
      if ($ok) {
        $nodeExe = $cmd.Source
      } else {
        Say "检测到电脑上的 Node.js 版本较旧($verText),将自动使用内置运行环境,不影响你原有的 Node。"
      }
    }
  }
}
if (-not $nodeExe) {
  $nodeDir = Join-Path $PSScriptRoot '.node'
  $nodeExe = Join-Path $nodeDir 'node.exe'
  if (-not (Test-Path $nodeExe)) {
    Say '================================================'
    Say ' 第一次运行:正在下载运行环境(约 30MB)'
    Say ' 只需要一次,请保持网络畅通,耐心等几分钟...'
    Say '================================================'
    $v = 'v22.20.0'; $n = "node-$v-win-x64"
    $zip = Join-Path $env:TEMP 'lapian-node.zip'
    $ok = $false
    foreach ($base in @('https://registry.npmmirror.com/-/binary/node', 'https://nodejs.org/dist')) {
      try { Invoke-WebRequest "$base/$v/$n.zip" -OutFile $zip -UseBasicParsing -ErrorAction Stop; $ok = $true; break } catch {}
    }
    if (-not $ok) {
      Say ''
      Say '运行环境下载失败。请检查网络后重新双击 run.bat。'
      Say '也可以手动安装 Node.js 后再试:https://nodejs.org/zh-cn'
      exit 1
    }
    $tmp = Join-Path $PSScriptRoot '.node-tmp'
    Expand-Archive $zip -DestinationPath $tmp -Force
    Move-Item (Join-Path $tmp $n) $nodeDir
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
  }
}
$nodeHome = Split-Path $nodeExe

# 2. 安装依赖(用已验证可靠的 cmd 形态,并把 node 目录前置进 PATH)
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
  Say '================================================'
  Say ' 第一次运行:正在安装程序组件'
  Say ' 只需要一次,大约一两分钟...'
  Say '================================================'
  $env:PATH = "$nodeHome;$env:PATH"
  # npm 的进度日志走 stderr,在 cmd 层直接收进文件,避免上层管道把它当错误
  cmd /c "npm install --no-audit --no-fund --registry=https://registry.npmmirror.com > install.log 2>&1"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
    Get-Content install.log -Tail 8 -ErrorAction SilentlyContinue | ForEach-Object { Say $_ }
    Say ''
    Say '组件安装失败。请检查网络后重新双击 run.bat。'
    exit 1
  }
}

# 3. 启动服务(直接 node 跑 vite,不经任何 shim)
Say '正在启动拉片笔记...'
$vite = Join-Path $PSScriptRoot 'node_modules/vite/bin/vite.js'
$serverLog = Join-Path $PSScriptRoot 'server.log'
$serverErrLog = Join-Path $PSScriptRoot 'server-err.log'
$proc = Start-Process $nodeExe -ArgumentList "`"$vite`" --port 5173" -WorkingDirectory $PSScriptRoot -WindowStyle Minimized -PassThru -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrLog

# 4. 等服务就绪后开浏览器
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
  try { Invoke-WebRequest 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null; $ready = $true; break } catch { Start-Sleep 1 }
  if ($proc.HasExited) { break }
}
if (-not $ready) {
  Say '启动失败或超时。服务日志开头:'
  Get-Content $serverErrLog -TotalCount 12 -ErrorAction SilentlyContinue | ForEach-Object { Say $_ }
  Say '请重新双击 run.bat;若反复失败,把这个窗口截图反馈。'
  exit 1
}
if (-not $test) { Start-Process 'http://localhost:5173/' }
Say ''
Say '================================================'
Say ' 拉片笔记已在浏览器打开:http://localhost:5173'
Say ' 有一个最小化的"node"服务窗口,'
Say ' 使用期间请不要关闭它;用完后关掉它即可退出。'
Say '================================================'
if (-not $test) { Read-Host '按回车键关闭本窗口(服务会继续运行)' }
exit 0
