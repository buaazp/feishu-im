/** Check the shipping artifact, public metadata, and local documentation links. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config } from '../dist/config.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
assert.equal(manifest.license, 'MIT')
for (const version of Object.values({ ...manifest.dependencies, ...manifest.peerDependencies })) {
  assert(!/^(workspace:|link:|file:)/.test(version), `Unpublished dependency: ${version}`)
}
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' }))
const files = new Set(packed.files.map(file => file.path))
for (const required of ['dist/index.js', 'dist/index.d.ts', 'bin/feishu-im.mjs', 'cordis.patch.yml', 'LICENSE', 'NOTICE', 'README.md', 'README.zh-CN.md', 'docs/configuration.md', 'docs/configuration.zh-CN.md']) {
  assert(files.has(required), `Missing shipping file: ${required}`)
}
for (const path of files) assert(!/^(node_modules|tests|tasks|coverage|artifacts|\.env|\.git)(\/|\.|$)/.test(path), `Unexpected shipping file: ${path}`)
for (const path of ['docs/configuration.md', 'docs/configuration.zh-CN.md']) {
  const source = await readFile(join(root, path), 'utf8')
  for (const key of Object.keys(Config({}))) assert(source.includes('`' + key + '`'), `Undocumented setting ${key} in ${path}`)
}
const markdown = (await readdir(root, { recursive: true })).filter(path => path.endsWith('.md') && !/^(node_modules|\.git|coverage|dist|artifacts)\//.test(path))
for (const path of markdown) {
  const source = await readFile(join(root, path), 'utf8')
  assert(source.endsWith('\n') && !source.endsWith('\n\n'), `Expected one trailing newline: ${path}`)
  for (const match of source.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^[a-z]+:/.test(target)) continue
    const absolute = resolve(root, dirname(path), decodeURIComponent(target))
    await access(absolute).catch(() => { throw new Error(`Broken link: ${path} -> ${target}`) })
    if (files.has(path)) assert(files.has(absolute.slice(root.length)), `Shipping link target missing: ${path} -> ${target}`)
  }
}
console.log(`Package checks passed: ${files.size} shipping files; ${markdown.length} Markdown documents.`)
