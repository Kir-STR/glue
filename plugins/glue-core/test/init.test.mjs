import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInit } from '../lib/init.mjs'

const FIX_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const PACK_A_DIR = join(FIX_DIR, 'pack-a')

// Build installed_plugins.json fixture in a temp dir, pointing installPath at pack-a.
// discoverPacks needs: glue-* key (not glue-core), existsSync(join(installPath, 'glue.contract.json'))
const tmpReg = mkdtempSync(join(tmpdir(), 'glue-reg-'))
const FIXTURE_INSTALLED_JSON = join(tmpReg, 'installed_plugins.json')
writeFileSync(
  FIXTURE_INSTALLED_JSON,
  JSON.stringify({
    version: 2,
    plugins: {
      'glue-rules@glue': [
        {
          installPath: PACK_A_DIR,
          version: '0.2.0',
          lastUpdated: '2026-06-25T00:00:00Z',
        },
      ],
    },
  }),
)

test('init lays out rules + instruction + manifest from fixture pack', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  const { manifest, conflicts } = runInit({
    selected: ['alpha'],
    engines: ['claude'],
    projectDir: proj,
    force: false,
    now: '2026-06-25T00:00:00Z',
    registryPath: FIXTURE_INSTALLED_JSON,
  })
  assert.equal(conflicts.length, 0)
  assert.ok(existsSync(join(proj, '.claude/rules/alpha.md')))
  assert.ok(existsSync(join(proj, 'CLAUDE.md')))
  assert.equal(manifest.status, 'complete')
})

test('init with conflicts and !force returns manifest null without writing', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  // Pre-create CLAUDE.md with different content to cause a conflict
  writeFileSync(join(proj, 'CLAUDE.md'), '# Existing file — hand edited\n')
  // Pre-create alpha.md with different content
  mkdirSync(join(proj, '.claude', 'rules'), { recursive: true })
  writeFileSync(join(proj, '.claude/rules/alpha.md'), '# Different content\n')
  const { manifest, conflicts } = runInit({
    selected: ['alpha'],
    engines: ['claude'],
    projectDir: proj,
    force: false,
    now: '2026-06-25T00:00:00Z',
    registryPath: FIXTURE_INSTALLED_JSON,
  })
  assert.equal(manifest, null)
  assert.ok(conflicts.length > 0)
})

test('init with force overwrites conflicts', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  writeFileSync(join(proj, 'CLAUDE.md'), '# Existing file\n')
  mkdirSync(join(proj, '.claude', 'rules'), { recursive: true })
  writeFileSync(join(proj, '.claude/rules/alpha.md'), '# Different content\n')
  const { manifest, conflicts } = runInit({
    selected: ['alpha'],
    engines: ['claude'],
    projectDir: proj,
    force: true,
    now: '2026-06-25T00:00:00Z',
    registryPath: FIXTURE_INSTALLED_JSON,
  })
  assert.equal(conflicts.length, 0)
  assert.ok(existsSync(join(proj, '.claude/rules/alpha.md')))
  assert.ok(existsSync(join(proj, 'CLAUDE.md')))
  assert.equal(manifest.status, 'complete')
})
