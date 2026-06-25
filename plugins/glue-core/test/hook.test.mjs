import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeDeliveryValid } from '../lib/init.mjs'
import { hashContent } from '../lib/hash.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', 'bin', 'glue.mjs')

test('no manifest → fallback (native invalid)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  assert.equal(nativeDeliveryValid(dir, []), false)
})

test('complete manifest with matching hashes → native valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(dir, '.claude', 'rules'), { recursive: true })
  mkdirSync(join(dir, '.glue'), { recursive: true })
  const rule = '# r\n'
  const instr = '# CLAUDE.md\n'
  writeFileSync(join(dir, '.claude/rules/alpha.md'), rule)
  writeFileSync(join(dir, 'CLAUDE.md'), instr)
  const man = {
    schemaVersion: '1', status: 'complete', engines: ['claude'], modules: ['alpha'],
    files: [
      { targetPath: '.claude/rules/alpha.md', writtenHash: hashContent(rule), packVersion: '0.2.0', producerPack: 'glue-rules', sourceTemplate: 'alpha.md' },
      { targetPath: 'CLAUDE.md', writtenHash: hashContent(instr), packVersion: '0.2.0', producerPack: 'glue-rules', sourceTemplate: 'CLAUDE.md.tmpl' },
    ],
  }
  writeFileSync(join(dir, '.glue/manifest.json'), JSON.stringify(man))
  assert.equal(nativeDeliveryValid(dir, [{ name: 'glue-rules', version: '0.2.0' }]), true)
})

test('manifest present but file hash drifted → fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(dir, '.claude', 'rules'), { recursive: true })
  mkdirSync(join(dir, '.glue'), { recursive: true })
  const rule = '# r\n'
  const instr = '# CLAUDE.md\n'
  writeFileSync(join(dir, '.claude/rules/alpha.md'), '# DRIFTED\n')
  writeFileSync(join(dir, 'CLAUDE.md'), instr)
  const man = {
    schemaVersion: '1', status: 'complete', engines: ['claude'], modules: ['alpha'],
    files: [
      { targetPath: '.claude/rules/alpha.md', writtenHash: hashContent(rule), packVersion: '0.2.0', producerPack: 'glue-rules', sourceTemplate: 'alpha.md' },
      { targetPath: 'CLAUDE.md', writtenHash: hashContent(instr), packVersion: '0.2.0', producerPack: 'glue-rules', sourceTemplate: 'CLAUDE.md.tmpl' },
    ],
  }
  writeFileSync(join(dir, '.glue/manifest.json'), JSON.stringify(man))
  assert.equal(nativeDeliveryValid(dir, [{ name: 'glue-rules', version: '0.2.0' }]), false)
})

test('manifest packVersion stale vs installed → fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(dir, '.claude', 'rules'), { recursive: true })
  mkdirSync(join(dir, '.glue'), { recursive: true })
  const rule = '# r\n'
  const instr = '# CLAUDE.md\n'
  writeFileSync(join(dir, '.claude/rules/alpha.md'), rule)
  writeFileSync(join(dir, 'CLAUDE.md'), instr)
  const man = {
    schemaVersion: '1', status: 'complete', engines: ['claude'], modules: ['alpha'],
    files: [
      { targetPath: '.claude/rules/alpha.md', writtenHash: hashContent(rule), packVersion: '0.1.0', producerPack: 'glue-rules', sourceTemplate: 'alpha.md' },
      { targetPath: 'CLAUDE.md', writtenHash: hashContent(instr), packVersion: '0.1.0', producerPack: 'glue-rules', sourceTemplate: 'CLAUDE.md.tmpl' },
    ],
  }
  writeFileSync(join(dir, '.glue/manifest.json'), JSON.stringify(man))
  // installed glue-rules is 0.2.0 but manifest claims 0.1.0 → stale → fallback
  assert.equal(nativeDeliveryValid(dir, [{ name: 'glue-rules', version: '0.2.0' }]), false)
})

test('manifest complete and rules present but CLAUDE.md missing → fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(dir, '.claude', 'rules'), { recursive: true })
  mkdirSync(join(dir, '.glue'), { recursive: true })
  const rule = '# r\n'
  writeFileSync(join(dir, '.claude/rules/alpha.md'), rule)
  // манифест complete, но среди обязательных targets — CLAUDE.md, которого на диске нет
  const man = { schemaVersion: '1', status: 'complete', engines: ['claude'], modules: ['alpha'],
    files: [
      { targetPath: '.claude/rules/alpha.md', writtenHash: hashContent(rule), packVersion: '0.2.0', producerPack: 'glue-rules', sourceTemplate: 'alpha.md' },
      { targetPath: 'CLAUDE.md', writtenHash: 'whatever', packVersion: '0.2.0', producerPack: 'glue-rules', sourceTemplate: 'CLAUDE.md.tmpl' },
    ] }
  writeFileSync(join(dir, '.glue/manifest.json'), JSON.stringify(man))
  assert.equal(nativeDeliveryValid(dir, [{ name: 'glue-rules', version: '0.2.0' }]), false,
    'missing CLAUDE.md must force fallback')
})

test('invariant: native invalid implies fallback path taken (never both off)', () => {
  // Build a temp content pack with rules/*.md (the hook reads bodies from there),
  // a registry pointing at it, and a manifest-less project. nativeDeliveryValid → false,
  // so the hook MUST inject the rule bodies (non-empty additionalContext).
  const home = mkdtempSync(join(tmpdir(), 'glue-home-'))
  const packDir = mkdtempSync(join(tmpdir(), 'glue-pack-'))
  mkdirSync(join(packDir, 'rules'), { recursive: true })
  const ruleBody = 'UNIQUE-FALLBACK-BODY-MARKER'
  writeFileSync(join(packDir, 'rules', 'gamma.md'), `# Gamma\n\n${ruleBody}\n`)

  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
  writeFileSync(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'glue-rules@glue': [{ installPath: packDir, version: '0.2.0', lastUpdated: '2026-06-25T00:00:00Z' }],
      },
    }),
  )

  const proj = mkdtempSync(join(tmpdir(), 'glue-proj-')) // no manifest → native invalid

  const stdout = execFileSync(process.execPath, [BIN], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_PROJECT_DIR: proj,
    },
    encoding: 'utf8',
  })

  const payload = JSON.parse(stdout)
  const ctx = payload.hookSpecificOutput.additionalContext
  assert.equal(payload.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.ok(ctx && ctx.length > 0, 'additionalContext must be non-empty on fallback')
  assert.ok(ctx.includes(ruleBody), 'fallback must inject rule bodies, not an empty/meta-only payload')
})
