import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deliveryStatus, listModules } from '../lib/report.mjs'
import { runInit } from '../lib/init.mjs'

const FIX_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const PACK_A_DIR = join(FIX_DIR, 'pack-a')

// Build installed_plugins.json fixture in a temp dir, pointing installPath at pack-a.
const tmpReg = mkdtempSync(join(tmpdir(), 'glue-rep-reg-'))
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

// Inline pack fixture matching what discoverPacks returns for pack-a.
const PACK_A_ENTRY = {
  name: 'glue-rules',
  version: '0.2.0',
  root: PACK_A_DIR,
  contract: JSON.parse(readFileSync(join(PACK_A_DIR, 'glue.contract.json'), 'utf8')),
  registry: JSON.parse(readFileSync(join(PACK_A_DIR, 'rules/registry.json'), 'utf8')),
}
const FIXTURE_PACKS = [PACK_A_ENTRY]

// ── deliveryStatus tests ──────────────────────────────────────────────────────

test('deliveryStatus: no manifest → mode fallback, summary mentions fallback', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-rep-'))
  const result = deliveryStatus(proj, FIXTURE_PACKS)
  assert.equal(result.mode, 'fallback')
  assert.ok(result.summary.includes('fallback'), `summary: ${result.summary}`)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.changed, [])
  assert.deepEqual(result.stale, [])
  assert.ok(Array.isArray(result.packs))
})

test('deliveryStatus: after layout → mode native, missing/changed empty', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-rep-'))
  runInit({
    selected: ['alpha'],
    engines: ['claude'],
    projectDir: proj,
    force: false,
    now: '2026-06-25T00:00:00Z',
    registryPath: FIXTURE_INSTALLED_JSON,
  })
  const result = deliveryStatus(proj, FIXTURE_PACKS)
  assert.equal(result.mode, 'native')
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.changed, [])
  assert.ok(result.summary.includes('native'), `summary: ${result.summary}`)
})

test('deliveryStatus: corrupt rule file → changed non-empty, mode fallback', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-rep-'))
  runInit({
    selected: ['alpha'],
    engines: ['claude'],
    projectDir: proj,
    force: false,
    now: '2026-06-25T00:00:00Z',
    registryPath: FIXTURE_INSTALLED_JSON,
  })
  // Corrupt one of the managed files
  writeFileSync(join(proj, '.claude/rules/alpha.md'), '# corrupted\n')
  const result = deliveryStatus(proj, FIXTURE_PACKS)
  assert.ok(result.changed.length > 0, 'changed should be non-empty')
  assert.equal(result.mode, 'fallback')
})

// ── listModules tests ─────────────────────────────────────────────────────────

test('listModules: returns pack-a modules with required fields', () => {
  const modules = listModules(FIXTURE_PACKS)
  assert.ok(Array.isArray(modules))
  assert.ok(modules.length >= 2, 'at least alpha and beta')
  for (const m of modules) {
    assert.ok('id' in m, 'has id')
    assert.ok('title' in m, 'has title')
    assert.ok('group' in m, 'has group')
    assert.ok('default' in m, 'has default')
    assert.ok('dependsOn' in m, 'has dependsOn')
  }
  const alpha = modules.find((m) => m.id === 'alpha')
  assert.ok(alpha, 'alpha present')
  assert.equal(alpha.title, 'Alpha module')
  assert.deepEqual(alpha.dependsOn, [])
  const beta = modules.find((m) => m.id === 'beta')
  assert.ok(beta, 'beta present')
  assert.equal(beta.title, 'Beta module')
  assert.deepEqual(beta.dependsOn, ['alpha'])
})
