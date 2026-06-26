import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { buildTargets, plan, KNOWN_ENGINES } from '../src/plan.mjs'
import { loadBundle, loadContract } from '../src/bundle.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const contract = loadContract(PLUGIN_ROOT)
const registry = loadBundle(PLUGIN_ROOT, contract)
function tmp() { return mkdtempSync(join(tmpdir(), 'glue-plan-')) }

test('KNOWN_ENGINES = claude/codex/gemini', () => {
  assert.deepEqual(KNOWN_ENGINES, ['claude', 'codex', 'gemini'])
})

test('buildTargets: rule-target на модуль + instruction-target на движок', () => {
  const { targets, deliveredEngines } = buildTargets({
    registry, modules: ['operator-gate'], engines: ['claude'], contract, pluginRoot: PLUGIN_ROOT,
  })
  const rule = targets.find((t) => t.targetPath === '.claude/rules/operator-gate.md')
  const instr = targets.find((t) => t.targetPath === 'CLAUDE.md')
  assert.ok(rule && rule.kind === 'rule')
  assert.ok(instr && instr.kind === 'instruction')
  assert.deepEqual(deliveredEngines, ['claude'])
})

test('buildTargets: codex → AGENTS.md', () => {
  const { targets, deliveredEngines } = buildTargets({
    registry, modules: ['operator-gate'], engines: ['codex'], contract, pluginRoot: PLUGIN_ROOT,
  })
  assert.ok(targets.find((t) => t.targetPath === 'AGENTS.md'))
  assert.deepEqual(deliveredEngines, ['codex'])
})

test('buildTargets бросает на неизвестный движок', () => {
  assert.throws(() => buildTargets({
    registry, modules: ['operator-gate'], engines: ['borg'], contract, pluginRoot: PLUGIN_ROOT,
  }), /Unknown engine: borg/)
})

test('buildTargets бросает на отсутствующий .tmpl (битый bundle)', () => {
  const d = tmp()
  try {
    // временный pluginRoot: есть modules/x.md, нет instructions/CLAUDE.md.tmpl
    mkdirSync(join(d, 'content', 'modules'), { recursive: true })
    mkdirSync(join(d, 'content', 'instructions'), { recursive: true })
    writeFileSync(join(d, 'content', 'modules', 'x.md'), 'X', 'utf8')
    const reg = { x: { title: 'X', templates: ['x.md'], instructionBlock: 'x', dependsOn: [] } }
    assert.throws(() => buildTargets({
      registry: reg, modules: ['x'], engines: ['claude'], contract, pluginRoot: d,
    }), /missing instruction template/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('plan на чистом проекте → все writes, deliveredEngines проброшен', () => {
  const d = tmp()
  try {
    const r = plan({
      registry, modules: ['operator-gate'], engines: ['claude'], contract, pluginRoot: PLUGIN_ROOT, projectDir: d, force: false,
    })
    assert.ok(r.writes.length >= 2) // rule + CLAUDE.md
    assert.equal(r.conflicts.length, 0)
    assert.deepEqual(r.deliveredEngines, ['claude'])
  } finally { rmSync(d, { recursive: true, force: true }) }
})
