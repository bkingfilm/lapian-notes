# 发布流程

每次发版按顺序走完，一条都别跳。下面命令以 Windows PowerShell 为准，`X.Y.Z` 换成实际版本号。

## 1. 版本号同步

`package.json` 和 `package-lock.json` 的版本字段必须一致，且与即将打的 Tag 一致。

```powershell
node -p "require('./package.json').version"
```

界面里的版本号由 Vite 从 `package.json` 注入（`__APP_VERSION__`），源码里不存在第二处版本号，改这一处就够。

注意 `package-lock.json` 里有三处 `"version": "0.4.0"` 形态的行，只有开头两处属于本项目，其余是第三方包，别顺手改。

## 2. 完整检查

```powershell
npm ci
npm run check
```

`check` 串了测试、翻译审计、Lint、生产构建，四项全过才继续。

## 3. Windows 启动验证

干净目录里解压待发布的 ZIP，双击 `run.bat`，确认自动装环境、浏览器自动打开、能导入一部影片抽帧。

## 4. macOS 启动验证

同样解压后双击 `run.command`。重点确认脚本行尾是 LF，CRLF 会让 macOS 直接报错启动不了。`.gitattributes` 已经钉死了 `run.command` 为 LF、`run.bat` 与 `setup.ps1` 为 CRLF，用第 6 步的打包方式就不会错。

## 5. 打 Tag

Tag 必须是 `vX.Y.Z` 格式。更新提示用 `/^v?(\d+)\.(\d+)\.(\d+)/` 解析 Tag，格式不对老用户收不到提示。

```powershell
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 6. 生成 ZIP

从 Tag 直接导出，不要手工拖拽打包。这样内容天然等于 Tag，行尾也按 `.gitattributes` 处理好。

```powershell
git archive --format=zip --prefix=lapian-notes/ vX.Y.Z -o lapian-notes-vX.Y.Z.zip
```

顶层目录固定叫 `lapian-notes/`，与历史版本保持一致，别带版本号。

## 7. 核对 ZIP 与 Tag

文件数必须相等。

```powershell
git ls-tree -r --name-only vX.Y.Z | Measure-Object -Line
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::OpenRead("$PWD\lapian-notes-vX.Y.Z.zip").Entries.Count
```

ZIP 会多出一条顶层目录记录，所以 ZIP 条目数比 Tag 文件数多 1 才算对。v0.4.0 是 81 个文件。

## 8. SHA256

```powershell
Get-FileHash lapian-notes-vX.Y.Z.zip -Algorithm SHA256
```

把结果写进 Release 正文，用户可自行校验。

## 9. 发布

在 Release 页面上传 `lapian-notes-vX.Y.Z.zip`，正文写清这一版改了什么。

README 只让用户下载这个附件，绿色 Code 按钮的源码快照不算发布产物，也不计入下载数。

## 10. 发布后检查更新提示

用上一个版本的安装包起一次，确认界面提示有新版。

结果缓存在 localStorage 的 `lapian.updateCheck.v1`，24 小时 TTL，验证前先清掉，否则看到的是旧数据。忽略过的版本记在 `lapian.updateCheck.dismissedTag`，一并清掉。

```javascript
localStorage.removeItem('lapian.updateCheck.v1')
localStorage.removeItem('lapian.updateCheck.dismissedTag')
```

## 11. 发布后回看下载数

隔几天看一次 Release 的附件下载数。下载数远低于 Star 数，说明入口又被绕开了，回头查 README 的下载指引。
