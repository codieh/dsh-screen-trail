import { rmSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
// 编译前清理生成目录，不把删除源码后遗留的入口打进安装包。
rmSync(new URL('dist/', root), { recursive: true, force: true })
const compiler = new URL('node_modules/typescript/bin/tsc', root)
if (!existsSync(compiler)) throw new Error('Build dependencies missing; run npm ci first')
const result = spawnSync(process.execPath, [fileURLToPath(compiler)], { cwd: fileURLToPath(root), stdio: 'inherit' })
if (result.error) throw result.error
if (result.signal) throw new Error(`TypeScript build terminated by ${result.signal}`)
process.exit(result.status ?? 1)
