import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))

test('fresh source builds through the same prepack lifecycle used by Git installation', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'screen-trail-prepack-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source'); const artifacts = path.join(directory, 'artifacts')
  await cp(root, source, { recursive: true, filter: (entry) => !['.git', 'node_modules', 'dist'].includes(path.relative(root, entry).split(path.sep)[0]) })
  await mkdir(artifacts)
  // 复用已安装的构建工具，不在单元测试中联网安装依赖，也不预先复制 dist。
  await symlink(path.join(root, 'node_modules'), path.join(source, 'node_modules'), 'dir')
  const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'))
  assert.equal(manifest.scripts.prepack, 'npm run build')
  await exec('npm', ['pack', '--pack-destination', artifacts, '--cache', path.join(directory, 'npm-cache')], { cwd: source })
  assert.ok((await readFile(path.join(source, 'dist/index.js'), 'utf8')).includes('registerRoutes'))
  assert.ok((await readFile(path.join(source, 'dist/client.js'), 'utf8')).includes('__ModuleLoader__'))
  assert.equal((await readdir(artifacts)).filter((file) => file.endsWith('.tgz')).length, 1)
})

test('npm package contains valid runtime files but no development or local data', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'screen-trail-package-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fixture = path.join(directory, 'source')
  await cp(root, fixture, { recursive: true, filter: (source) => {
    const top = path.relative(root, source).split(path.sep)[0]
    return !['.git', 'node_modules', 'dist'].includes(top)
  } })
  // 安装包只携带已编译入口；测试复制本次构建产物，不依赖旧版本的 dist。
  await cp(path.join(root, 'dist'), path.join(fixture, 'dist'), { recursive: true })

  // 注入假数据验证打包边界，不能因干净仓库恰好没有敏感文件就让检查通过。
  for (const file of ['.DS_Store', 'state.json', 'journal.sqlite', 'journal.sqlite-wal', 'journal.sqlite-shm', 'shots/private.jpg', 'diagnostics/request.json',
    'dist/private.sqlite', 'dist/previous-package.tgz', 'native/capture-test-cache', 'native/module-cache/cached.swiftmodule']) {
    const target = path.join(fixture, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, 'package exclusion fixture\n')
  }

  const { stdout } = await exec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts',
    '--cache', path.join(directory, 'npm-cache')], { cwd: fixture })
  const [packed] = JSON.parse(stdout)
  const files = packed.files.map((item) => item.path)
  const manifest = JSON.parse(await readFile(path.join(fixture, 'package.json'), 'utf8'))
  assert.equal(packed.name, manifest.name)
  assert.equal(packed.version, manifest.version)

  // 除显式入口外，间接导入、宿主补丁和首次启动要编译的 Swift 源码也必须齐全。
  for (const file of ['package.json', 'dist/index.js', 'dist/index.d.ts', 'dist/client.js', 'dist/trail.js', 'dist/frames.js',
    'dist/capture.js', 'dist/analysis-response.js', 'dist/event-tools.js', 'dist/storage.js', 'native/capture.swift', 'cordis.patch.yml',
    'locale/en.json', 'locale/zh.json', 'icon.svg', 'docs/DETAIL.md', 'docs/DETAIL.zh.md', 'docs/preview.svg']) {
    assert.ok(files.includes(file), `required runtime file missing from package: ${file}`)
  }
  for (const target of Object.values(manifest.exports)) {
    assert.equal(typeof target, 'string', 'update package validation for non-string exports')
    if (target.includes('*')) continue
    assert.ok(files.includes(target.replace(/^\.\//, '')), `export target missing from package: ${target}`)
  }
  assert.ok(files.includes(manifest.dsh.bundle.patch.replace(/^\.\//, '')), 'host patch missing from package')
  assert.ok(files.includes(manifest.types.replace(/^\.\//, '')), 'public type declarations missing from package')
  assert.ok(files.includes('dist/index.js.map'), 'debug source map missing from package')

  // 检查公开声明可被严格模式消费者使用，而不是仅在项目宽松配置下通过。
  const consumer = path.join(fixture, 'consumer.ts')
  await writeFile(consumer, `import type { PluginConfig, EventEdits } from './dist/index.js'\nconst config: PluginConfig = { sampleIntervalSec: 5 }\n// @ts-expect-error public config rejects strings\nconfig.sampleIntervalSec = '5s'\n// @ts-expect-error updates require IDs\nconst edit: EventEdits = { changes: [{ action: 'update' }] }\nvoid [config, edit]\n`)
  await exec(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--ignoreConfig', '--noEmit', '--strict', '--module', 'NodeNext',
    '--target', 'ES2022', '--skipLibCheck', '--typeRoots', path.join(root, 'node_modules/@types'), consumer], { cwd: fixture })

  for (const file of files) {
    assert.doesNotMatch(file, /(^|\/)(\.DS_Store|\.git|\.github|node_modules|tests|src|scripts|type-tests|shots|diagnostics)(\/|$)/,
      `development or local data included in package: ${file}`)
    assert.doesNotMatch(file, /^native\/(capture-[^/]+|module-cache)(\/|$)/,
      `compiled capture cache included in package: ${file}`)
    assert.notEqual(file, 'state.json', 'local state included in package')
    assert.doesNotMatch(file, /\.sqlite(?:-wal|-shm)?$/, 'local database included in package')
    assert.doesNotMatch(file, /\.tgz$/, 'previous package recursively included')
    if (file.endsWith('.js')) await exec(process.execPath, ['--check', path.join(fixture, file)])
    if (file.endsWith('.json')) JSON.parse(await readFile(path.join(fixture, file), 'utf8'))
  }
})
