import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'glue.mjs')

// Гоняет настоящий бинарь как пользовательский путь. projectDir — через
// CLAUDE_PROJECT_DIR (механизм, который реально использует CLI).
function runCli(args, projectDir) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
  })
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status }
}

function tmpProject(t) {
  const dir = mkdtempSync(join(tmpdir(), 'glue-acc-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const rulePath = (dir, file) => join(dir, '.claude', 'rules', file)

test('1: list — JSON-массив модулей с ожидаемой формой', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['list'], dir)
  assert.equal(r.exitCode, 0)
  const mods = JSON.parse(r.stdout)
  assert.ok(Array.isArray(mods))
  const og = mods.find((m) => m.id === 'operator-gate')
  assert.ok(og, 'operator-gate присутствует')
  assert.equal(og.default, true)
  assert.deepEqual(Object.keys(og).sort(), ['default', 'dependsOn', 'group', 'id', 'note', 'title'])
})

test('2: init — материализует rule + инструкц-файл + манифест', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['init', '--modules', 'operator-gate'], dir)
  assert.equal(r.exitCode, 0)
  const out = JSON.parse(r.stdout)
  assert.equal(out.ok, true)
  assert.deepEqual(out.conflicts, [])
  assert.ok(existsSync(rulePath(dir, 'operator-gate.md')))
  assert.ok(existsSync(join(dir, 'CLAUDE.md')))
  assert.ok(existsSync(join(dir, '.glue', 'manifest.json')))
  assert.equal(out.manifest.status, 'complete')
})

test('3: status — после init mode native, движки покрыты', (t) => {
  const dir = tmpProject(t)
  runCli(['init', '--modules', 'operator-gate'], dir)
  const r = runCli(['status'], dir)
  assert.equal(r.exitCode, 0)
  const st = JSON.parse(r.stdout)
  assert.equal(st.mode, 'native')
  assert.equal(st.engines.claude.status, 'ok')
})

test('4: session-start — native {}; после сноса target — fallback-инъекция', (t) => {
  const dir = tmpProject(t)
  runCli(['init', '--modules', 'operator-gate'], dir)

  const native = runCli(['session-start'], dir)
  assert.equal(native.exitCode, 0)
  assert.equal(native.stdout.trim(), '{}')

  unlinkSync(join(dir, 'CLAUDE.md')) // обязательный Claude-target → native невалиден
  const fb = runCli(['session-start'], dir)
  assert.equal(fb.exitCode, 0)
  assert.ok(fb.stdout.includes('hookSpecificOutput'))
  assert.ok(fb.stdout.includes('<glue>'))
  assert.ok(fb.stderr.includes('native delivery inactive'))
})

test('5: повторный init — идемпотентен, не конфликт', (t) => {
  const dir = tmpProject(t)
  runCli(['init', '--modules', 'operator-gate'], dir)
  const r = runCli(['init', '--modules', 'operator-gate'], dir)
  assert.equal(r.exitCode, 0)
  const out = JSON.parse(r.stdout)
  assert.equal(out.ok, true)
  assert.deepEqual(out.conflicts, [])
})

test('6: правленный файл — конфликт без force; --force перезаписывает', (t) => {
  const dir = tmpProject(t)
  runCli(['init', '--modules', 'operator-gate'], dir)
  const target = rulePath(dir, 'operator-gate.md')
  const planned = readFileSync(target, 'utf8')
  writeFileSync(target, 'tampered by hand\n', 'utf8')

  const conflict = runCli(['init', '--modules', 'operator-gate'], dir)
  assert.equal(conflict.exitCode, 0)
  const co = JSON.parse(conflict.stdout)
  assert.equal(co.ok, false)
  assert.equal(co.manifest, null)
  assert.ok(co.conflicts.some((c) => c.targetPath === '.claude/rules/operator-gate.md'))

  const forced = runCli(['init', '--force', '--modules', 'operator-gate'], dir)
  assert.equal(forced.exitCode, 0)
  assert.equal(JSON.parse(forced.stdout).ok, true)
  assert.equal(readFileSync(target, 'utf8'), planned)
})

test('7: снятый модуль — неизменённый удалён; правленный — конфликт', (t) => {
  const dir = tmpProject(t)
  runCli(['init', '--modules', 'operator-gate,secret-hygiene'], dir)
  assert.ok(existsSync(rulePath(dir, 'secret-hygiene.md')))

  // снятие неизменённого модуля → безопасное удаление его файла
  const drop = runCli(['init', '--modules', 'operator-gate'], dir)
  assert.equal(JSON.parse(drop.stdout).ok, true)
  assert.ok(!existsSync(rulePath(dir, 'secret-hygiene.md')))
  assert.ok(existsSync(rulePath(dir, 'operator-gate.md')))

  // правленный снятый файл → конфликт, не молчаливое удаление
  runCli(['init', '--modules', 'operator-gate,secret-hygiene'], dir)
  writeFileSync(rulePath(dir, 'secret-hygiene.md'), 'hand-edited\n', 'utf8')
  const conflict = runCli(['init', '--modules', 'operator-gate'], dir)
  const co = JSON.parse(conflict.stdout)
  assert.equal(co.ok, false)
  assert.ok(co.conflicts.some((c) => c.targetPath === '.claude/rules/secret-hygiene.md'))
})

test('8: codex в движках — создаётся AGENTS.md', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['init', '--modules', 'operator-gate', '--engines', 'claude,codex'], dir)
  assert.equal(JSON.parse(r.stdout).ok, true)
  assert.ok(existsSync(join(dir, 'AGENTS.md')))
})

test('9: неизвестный движок — ok:false, error, exit 1', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['init', '--modules', 'operator-gate', '--engines', 'borg'], dir)
  assert.equal(r.exitCode, 1)
  const out = JSON.parse(r.stdout)
  assert.equal(out.ok, false)
  assert.match(out.error, /Unknown engine/)
})

test('9b: неизвестный модуль — ok:false, error, exit 1', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['init', '--modules', 'no-such-module'], dir)
  assert.equal(r.exitCode, 1)
  assert.match(JSON.parse(r.stdout).error, /Unknown module/)
})

test('10: честный манифест — engines только реально доставленные', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['init', '--modules', 'operator-gate', '--engines', 'claude'], dir)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(out.manifest.engines, ['claude'])
})

test('regression: --help/no-command — JSON error exit 1, не session-start', (t) => {
  const dir = tmpProject(t)
  for (const args of [['--help'], []]) {
    const r = runCli(args, dir)
    assert.equal(r.exitCode, 1)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, false)
    assert.match(out.error, /unknown command/)
    assert.ok(!r.stdout.includes('hookSpecificOutput'), 'не дефолтит в session-start')
  }
})
