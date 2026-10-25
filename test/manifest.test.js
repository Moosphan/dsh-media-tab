import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

test('package declares a bundle patch and a web client half', () => {
  assert.equal(pkg.name, 'dsh-media-tab')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(typeof pkg.dsh.client.inject === 'object')
  assert.ok(pkg.engines.dsh.includes('0.2'))
})

test('every exported target exists', () => {
  for (const target of Object.values(pkg.exports)) {
    if (target.includes('*')) continue
    assert.ok(fs.existsSync(path.join(root, target)), `missing export target: ${target}`)
  }
})

test('bundle patch inserts this package under the same name', () => {
  const patch = fs.readFileSync(path.join(root, pkg.dsh.bundle.patch), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, /name: dsh-media-tab/)
  assert.match(patch, /id: dsh-media-tab/)
})

test('locale files carry the plugin-card metadata', () => {
  for (const language of ['zh', 'en']) {
    const value = JSON.parse(fs.readFileSync(path.join(root, 'locale', `${language}.json`), 'utf8'))
    assert.equal(typeof value.meta.title, 'string')
    assert.ok(value.meta.title.length > 0)
    assert.equal(typeof value.meta.description, 'string')
  }
})

test('client bundle parses as a module', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'lib', 'client.js')], { stdio: 'pipe' })
})

test('host modules parse and expose the plugin shape', async () => {
  const host = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)
  assert.equal(host.name, 'dsh-media-tab')
  assert.deepEqual(host.inject, ['tools', 'webServer'])
  assert.equal(typeof host.apply, 'function')
})
