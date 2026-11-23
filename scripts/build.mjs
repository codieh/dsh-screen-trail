import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 只清理项目生成目录，避免删除源码后仍把旧 JS 混入安装包。
const root = new URL('../', import.meta.url)
rmSync(new URL('dist/', root), { recursive: true, force: true })
const result = spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root))], {
  cwd: fileURLToPath(root), stdio: 'inherit',
})
if (result.error) throw result.error
if (result.signal) throw new Error(`TypeScript build terminated by ${result.signal}`)
process.exit(result.status ?? 1)
