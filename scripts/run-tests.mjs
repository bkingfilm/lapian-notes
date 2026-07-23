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

console.log(`Running ${files.length} test files.`)
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
