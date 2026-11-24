import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))

test('npm package contains valid runtime files but no development or local data', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'screen-trail-package-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fixture = path.join(directory, 'source')
  await cp(root, fixture, { recursive: true, filter: (source) => {
    const top = path.relative(root, source).split(path.sep)[0]
    return !['.git', 'node_modules', 'dist'].includes(top)
  } })

  // 注入假数据验证打包边界，不能因干净仓库恰好没有敏感文件就让检查通过。
  for (const file of ['.DS_Store', 'state.json', 'shots/private.jpg', 'diagnostics/request.json',
    'native/capture-test-cache', 'native/module-cache/cached.swiftmodule']) {
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
  for (const file of ['package.json', 'index.js', 'client.js', 'trail.js', 'frames.js',
    'capture.js', 'analysis-response.js', 'event-tools.js', 'native/capture.swift', 'cordis.patch.yml',
    'locale/en.json', 'locale/zh.json', 'icon.svg', 'docs/DETAIL.md', 'docs/DETAIL.zh.md', 'docs/preview.svg']) {
    assert.ok(files.includes(file), `required runtime file missing from package: ${file}`)
  }
  for (const target of Object.values(manifest.exports)) {
    assert.equal(typeof target, 'string', 'update package validation for non-string exports')
    if (target.includes('*')) continue
    assert.ok(files.includes(target.replace(/^\.\//, '')), `export target missing from package: ${target}`)
  }
  assert.ok(files.includes(manifest.dsh.bundle.patch.replace(/^\.\//, '')), 'host patch missing from package')

  for (const file of files) {
    assert.doesNotMatch(file, /(^|\/)(\.DS_Store|\.git|\.github|node_modules|tests|dist|shots|diagnostics)(\/|$)/,
      `development or local data included in package: ${file}`)
    assert.doesNotMatch(file, /^native\/(capture-[^/]+|module-cache)(\/|$)/,
      `compiled capture cache included in package: ${file}`)
    assert.notEqual(file, 'state.json', 'local state included in package')
    if (file.endsWith('.js')) await exec(process.execPath, ['--check', path.join(fixture, file)])
    if (file.endsWith('.json')) JSON.parse(await readFile(path.join(fixture, file), 'utf8'))
  }
})
