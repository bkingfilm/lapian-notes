import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'
import process from 'node:process'

function discover(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...discover(path))
    else if (/\.test\.(?:ts|mjs)$/.test(entry.name)) files.push(path)
  }
  return files
}

const root = process.cwd()
const files = discover(join(root, 'tests'))
  .map((path) => relative(root, path).replaceAll('\\', '/'))
  .sort()

if (!files.length) {
  console.error('No test files were discovered.')
  process.exit(1)
}

// tests 目录里的 TypeScript 测试直接交给 node --test，靠 Node 自带的类型剥离运行。
// 该能力从 Node 22.18 起默认开启，更早的版本会把每个 .ts 文件整体判为解析失败，
// 只丢下一串 ERR_UNKNOWN_FILE_EXTENSION。这里先探一次能力再跑，省得让人去猜。
// 用 process.features.typescript 而不是比对版本号：手动加了 --experimental-strip-types
// 的老版本同样会被放行，版本号比不出这种情况。
if (!process.features.typescript && files.some((path) => path.endsWith('.ts'))) {
  console.error(
    [
      `The test suite is written in TypeScript and needs Node 22.18+ (this is v${process.versions.node}).`,
      'Node runs .ts files through built-in type stripping, which older versions do not enable.',
      'Only the tests need the newer Node: running the app and "npm run build" still work on 20.19+.',
    ].join('\n'),
  )
  process.exit(1)
}

console.log(`Running ${files.length} test files.`)
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
