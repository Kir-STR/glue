import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInit, nativeDeliveryValid } from '../lib/init.mjs'

const FIX_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const PACK_A_DIR = join(FIX_DIR, 'pack-a')

// Build installed_plugins.json fixture pointing installPath at pack-a (same approach as init.test.mjs).
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

// packs arg for nativeDeliveryValid — must match what the manifest records (name + version).
const PACKS = [{ name: 'glue-rules', version: '0.2.0' }]

test('fallback → glue init → native → drift → fallback', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-integ-'))

  // ── Phase 1: before init → nativeDeliveryValid is false (no manifest yet) ──
  assert.equal(nativeDeliveryValid(proj, PACKS), false, 'phase 1: no manifest → fallback')

  // ── Phase 2: runInit → rules + CLAUDE.md laid out, manifest complete ────────
  const { manifest, conflicts } = runInit({
    selected: ['alpha'],
    engines: ['claude'],
    projectDir: proj,
    force: false,
    now: '2026-06-25T00:00:00Z',
    registryPath: FIXTURE_INSTALLED_JSON,
  })
  assert.equal(conflicts.length, 0, 'phase 2: no conflicts')
  assert.equal(manifest.status, 'complete', 'phase 2: manifest complete')
  assert.ok(existsSync(join(proj, '.claude/rules/alpha.md')), 'phase 2: alpha.md written')
  assert.ok(existsSync(join(proj, 'CLAUDE.md')), 'phase 2: CLAUDE.md written')

  // ── Phase 3: after init → nativeDeliveryValid is true ───────────────────────
  assert.equal(nativeDeliveryValid(proj, PACKS), true, 'phase 3: manifest complete + hash-match → native')

  // ── Phase 4: drift → nativeDeliveryValid is false again ─────────────────────
  writeFileSync(join(proj, '.claude/rules/alpha.md'), '# tampered content\n', 'utf8')
  assert.equal(nativeDeliveryValid(proj, PACKS), false, 'phase 4: drifted file → fallback (recovery)')
})
