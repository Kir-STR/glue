# Glue срез 3 — `status` + SessionStart-хук + fallback R1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить наблюдаемость доставки (`status`) и условный SessionStart-хук (native↔fallback R1) к плагину `glue` — gate без версий, хук read-only, fallback инжектит тела правил из своего `content/`.

**Architecture:** Три модуля в `src/`: `gate.mjs` (`nativeDeliveryValid` — узкий Claude-gate, переиспользует `manifest.mjs` helpers), `status.mjs` (`deliveryStatus` — отчёт по всем движкам, drift через `buildTargets`-рехеш), `session-start.mjs` (`runSessionStart` — тестируемое ядро хука). Обвязка: `hooks/hooks.json` (SessionStart wiring) + две подкоманды в `bin/glue.mjs` + экспорт `engineTarget` из `plan.mjs`. Всё поверх движка среза 2 (на `main`).

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`. Без внешних зависимостей. Node v24 на Windows.

## Global Constraints

- **gate версию не проверяет** — валидность развязана от версии (collapse-design § «Манифест»). (slice3-design § gate)
- **gate переиспользует `isUsablePrevManifest`** (`manifest.mjs`, срез 2) — не дублировать критерий own/schema. (slice3-design § gate)
- **gate НЕ требует** `AGENTS.md`/`GEMINI.md`, даже если в `manifest.engines` — только обязательные Claude-targets (`CLAUDE.md` + `.claude/rules/*`). (slice3-design § gate)
- **хук read-only** — SessionStart НЕ пишет в проект (никакого `.glue/last-run.json`). (slice3-design § хук)
- **native валиден → stdout `{}`** — ноль `additionalContext`, ноль шума, stderr пусто, exit 0. (slice3-design § хук)
- **fallback R1 выбор модулей:** манифест читаем + `schemaVersion === '1'` + `resolveDependencies(manifest.modules)` успешно → эти modules (в т.ч. `[]` → пусто); иначе → resolved defaults; **никогда все**. (slice3-design § хук)
- **status не бросает** на отсутствующем/foreign/битом манифесте/bundle — деградирует через `reason`/`errors`. (slice3-design § status)
- **status `mode` = `nativeDeliveryValid`** всегда; `drift` через `buildTargets`-рехеш (try/catch → `errors`); per-engine `drift` только если drift вычислен (иначе ok/missing/changed по диску). (slice3-design § status)
- **exit 0** в хуке всегда (хук не валит сессию; fail-closed).
- **Имена** (slug'и, файлы, ключи) — ASCII; содержание — русский (`glossary.md`).
- **Бюджет PR** (`pr-policy`): target 400 / cap 800 строк · 15 файлов. Срез 3 = **1 PR**.
- **Окружение:** Windows, PowerShell. Полный прогон тестов — **glob-форма** `node --test "plugins/glue/test/*.test.mjs"` (directory-форма на Node 24 падает). Одиночный файл — `node --test plugins/glue/test/<name>.test.mjs`.
- **Код плагина — только worktree + PR** (`worktree-workflow`). Ветка `feat-glue-slice3-status-hook` от `main`.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `plugins/glue/src/gate.mjs` | `nativeDeliveryValid(projectDir) → boolean` |
| `plugins/glue/src/status.mjs` | `deliveryStatus(projectDir) → отчёт` |
| `plugins/glue/src/session-start.mjs` | `runSessionStart(projectDir) → {stdout, stderr, exitCode}` |
| `plugins/glue/src/plan.mjs` (modify) | + экспорт `engineTarget(engine) → string\|null` |
| `plugins/glue/hooks/hooks.json` | SessionStart → `bin/glue.mjs session-start` |
| `plugins/glue/bin/glue.mjs` (modify) | + подкоманды `status`, `session-start` |
| `plugins/glue/test/gate.test.mjs` | тесты gate |
| `plugins/glue/test/status.test.mjs` | тесты status |
| `plugins/glue/test/session-start.test.mjs` | тесты хука |

**PR:** один PR (`feat-glue-slice3-status-hook`), ~9 файлов / ~400 reviewable строк.

---

### Task 1: `gate.mjs` — `nativeDeliveryValid`

**Files:**
- Create: `plugins/glue/src/gate.mjs`
- Test: `plugins/glue/test/gate.test.mjs`

**Interfaces:**
- Consumes: `readManifest`/`isUsablePrevManifest` (`manifest.mjs`, срез 2); `hashContent` (`hash.mjs`); `safeTargetPath` (`paths.mjs`); `runInit` (`init.mjs`) — только в тесте для материализации реальной доставки.
- Produces: `nativeDeliveryValid(projectDir) → boolean`. Используется `status.mjs` (Task 2) и `session-start.mjs` (Task 3).

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/gate.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nativeDeliveryValid } from '../src/gate.mjs'
import { runInit } from '../src/init.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-gate-')) }
// Материализуем реальную нативную доставку (claude) через движок среза 2.
function seed(d) { runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T' }) }

test('валидная нативная доставка → true', () => {
  const d = tmp()
  try { seed(d); assert.equal(nativeDeliveryValid(d), true) } finally { rmSync(d, { recursive: true, force: true }) }
})

test('нет манифеста → false', () => {
  const d = tmp()
  try { assert.equal(nativeDeliveryValid(d), false) } finally { rmSync(d, { recursive: true, force: true }) }
})

test('правленый Claude-target (hash mismatch) → false', () => {
  const d = tmp()
  try {
    seed(d)
    writeFileSync(join(d, '.claude/rules/operator-gate.md'), 'РУЧНАЯ ПРАВКА', 'utf8')
    assert.equal(nativeDeliveryValid(d), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('удалённый Claude-target → false', () => {
  const d = tmp()
  try {
    seed(d)
    rmSync(join(d, 'CLAUDE.md'))
    assert.equal(nativeDeliveryValid(d), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('foreign producerPack в манифесте → false', () => {
  const d = tmp()
  try {
    seed(d)
    const p = join(d, '.glue/manifest.json')
    const m = JSON.parse(readFileSync(p, 'utf8'))
    m.files[0].producerPack = 'glue-rules'
    writeFileSync(p, JSON.stringify(m), 'utf8')
    assert.equal(nativeDeliveryValid(d), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('AGENTS.md отсутствует, но Claude валиден → true (gate не требует движков)', () => {
  const d = tmp()
  try {
    seed(d) // engines=['claude'] → AGENTS.md и не создавался
    assert.equal(existsSync(join(d, 'AGENTS.md')), false)
    assert.equal(nativeDeliveryValid(d), true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/gate.test.mjs`
Expected: FAIL — `Cannot find module '../src/gate.mjs'`.

- [ ] **Step 3: Реализовать**

`plugins/glue/src/gate.mjs`:

```js
import { existsSync, readFileSync } from 'node:fs'
import { readManifest, isUsablePrevManifest } from './manifest.mjs'
import { hashContent } from './hash.mjs'
import { safeTargetPath } from './paths.mjs'

// Обязательный Claude-target: корневой CLAUDE.md либо файл под .claude/rules/.
function isMandatoryClaudeTarget(targetPath) {
  return targetPath === 'CLAUDE.md' || targetPath.startsWith('.claude/rules/')
}

// Узкий Claude-gate native↔fallback. Версию не проверяет. Любой throw → false.
export function nativeDeliveryValid(projectDir) {
  try {
    const m = readManifest(projectDir)
    if (!isUsablePrevManifest(m)) return false      // нет манифеста / schemaVersion ≠ '1' / foreign producerPack
    if (m.status !== 'complete') return false

    const files = Array.isArray(m.files) ? m.files : []
    let sawClaudeMd = false

    for (const f of files) {
      if (!f || typeof f.targetPath !== 'string') return false
      if (f.targetPath === 'CLAUDE.md') sawClaudeMd = true
      if (isMandatoryClaudeTarget(f.targetPath)) {
        const abs = safeTargetPath(projectDir, f.targetPath)
        if (!existsSync(abs)) return false
        if (hashContent(readFileSync(abs, 'utf8')) !== f.writtenHash) return false
      }
    }

    if (!sawClaudeMd) return false  // Claude-доставка неполна без CLAUDE.md
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/gate.test.mjs`
Expected: PASS (6 тестов).

- [ ] **Step 5: Commit**

```powershell
git add plugins/glue/src/gate.mjs plugins/glue/test/gate.test.mjs
git commit -m "feat(glue): nativeDeliveryValid (version-independent Claude-gate)"
```

---

### Task 2: `engineTarget` экспорт + `status.mjs`

**Files:**
- Modify: `plugins/glue/src/plan.mjs` (добавить экспорт `engineTarget`)
- Create: `plugins/glue/src/status.mjs`
- Test: `plugins/glue/test/status.test.mjs`

**Interfaces:**
- Consumes: `nativeDeliveryValid` (Task 1); `readManifest`/`isUsablePrevManifest` (`manifest.mjs`); `hashContent` (`hash.mjs`); `safeTargetPath` (`paths.mjs`); `buildTargets` (`plan.mjs`, срез 2); `loadContract`/`loadBundle`/`PLUGIN_ROOT` (`bundle.mjs`); `runInit` (тест).
- Produces:
  - `engineTarget(engine) → string|null` (из `plan.mjs`) — instruction targetPath движка (`claude`→`CLAUDE.md` и т.д.), `null` для неизвестного;
  - `deliveryStatus(projectDir) → {mode, reason, missing, changed, drift, engines, errors, summary}`.

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/status.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deliveryStatus } from '../src/status.mjs'
import { runInit } from '../src/init.mjs'
import { hashContent } from '../src/hash.mjs'
import { buildManifest, writeManifest } from '../src/manifest.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-status-')) }

test('чистая нативная доставка → mode native, пустые наборы', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    const s = deliveryStatus(d)
    assert.equal(s.mode, 'native')
    assert.deepEqual(s.missing, [])
    assert.deepEqual(s.changed, [])
    assert.deepEqual(s.drift, [])
    assert.equal(s.engines.claude.status, 'ok')
    assert.equal(s.engines.claude.targetPath, 'CLAUDE.md')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('нет манифеста → fallback, reason missing-or-unreadable-manifest, не бросает', () => {
  const d = tmp()
  try {
    const s = deliveryStatus(d)
    assert.equal(s.mode, 'fallback')
    assert.equal(s.reason, 'missing-or-unreadable-manifest')
    assert.deepEqual(s.engines, {})
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('foreign манифест → fallback, reason unusable-manifest', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.glue'), { recursive: true })
    writeFileSync(join(d, '.glue/manifest.json'), JSON.stringify({ schemaVersion: '1', status: 'complete', engines: ['claude'], modules: [], files: [{ producerPack: 'glue-rules', targetPath: 'CLAUDE.md', writtenHash: 'x' }] }), 'utf8')
    const s = deliveryStatus(d)
    assert.equal(s.reason, 'unusable-manifest')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('правленый файл → changed', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    writeFileSync(join(d, '.claude/rules/operator-gate.md'), 'ПРАВКА', 'utf8')
    const s = deliveryStatus(d)
    assert.ok(s.changed.includes('.claude/rules/operator-gate.md'))
    assert.equal(s.engines.claude.status, 'ok') // CLAUDE.md не тронут
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('drift: writtenHash старого контента, диск == written, текущий plannedHash ≠ → drift', () => {
  const d = tmp()
  try {
    // Готовим состояние «контент обновился после init»: на диске старый контент,
    // writtenHash = его хеш (значит НЕ changed), но текущий bundle даёт другой plannedHash.
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    const ruleOld = 'СТАРЫЙ КОНТЕНТ ПРАВИЛА'
    const claudeOld = 'СТАРЫЙ CLAUDE'
    writeFileSync(join(d, '.claude/rules/operator-gate.md'), ruleOld, 'utf8')
    writeFileSync(join(d, 'CLAUDE.md'), claudeOld, 'utf8')
    const m = buildManifest({
      deliveryId: 'T', completedAt: 'T', engines: ['claude'], modules: ['operator-gate'],
      files: [
        { producerPack: 'glue', packVersion: '0.1.0', sourceTemplate: 'operator-gate.md', targetPath: '.claude/rules/operator-gate.md', writtenHash: hashContent(ruleOld) },
        { producerPack: 'glue', packVersion: '0.1.0', sourceTemplate: 'CLAUDE.md.tmpl', targetPath: 'CLAUDE.md', writtenHash: hashContent(claudeOld) },
      ],
    })
    writeManifest(d, m)
    const s = deliveryStatus(d)
    assert.ok(s.drift.includes('.claude/rules/operator-gate.md')) // текущий bundle plannedHash ≠ hashContent(ruleOld)
    assert.deepEqual(s.changed, []) // диск == writtenHash → не changed
    assert.equal(s.engines.claude.status, 'drift')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('битый bundle (unknown module в манифесте) → errors непуст, не бросает', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, 'CLAUDE.md'), 'C', 'utf8')
    const m = buildManifest({
      deliveryId: 'T', completedAt: 'T', engines: ['claude'], modules: ['nonexistent-module'],
      files: [{ producerPack: 'glue', packVersion: '0.1.0', sourceTemplate: 'CLAUDE.md.tmpl', targetPath: 'CLAUDE.md', writtenHash: hashContent('C') }],
    })
    writeManifest(d, m)
    const s = deliveryStatus(d)
    assert.ok(s.errors.length > 0)        // buildTargets бросил на unknown module
    assert.deepEqual(s.drift, [])         // drift не вычислен
    assert.equal(s.engines.claude.status, 'ok') // CLAUDE.md на диске == written; drift не вычислен → ok
  } finally { rmSync(d, { recursive: true, force: true }) }
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/status.test.mjs`
Expected: FAIL — `Cannot find module '../src/status.mjs'`.

- [ ] **Step 3: Добавить экспорт `engineTarget` в `plan.mjs`**

В `plugins/glue/src/plan.mjs` дописать после объявления `KNOWN_ENGINES` (рядом с `ENGINE_INSTRUCTIONS`):

```js
// Instruction-targetPath движка (claude→CLAUDE.md, codex→AGENTS.md, gemini→GEMINI.md); null для неизвестного.
export function engineTarget(engine) {
  return ENGINE_INSTRUCTIONS[engine]?.[1] ?? null
}
```

- [ ] **Step 4: Реализовать `status.mjs`**

`plugins/glue/src/status.mjs`:

```js
import { existsSync, readFileSync } from 'node:fs'
import { readManifest, isUsablePrevManifest } from './manifest.mjs'
import { hashContent } from './hash.mjs'
import { safeTargetPath } from './paths.mjs'
import { nativeDeliveryValid } from './gate.mjs'
import { buildTargets, engineTarget } from './plan.mjs'
import { loadContract, loadBundle, PLUGIN_ROOT } from './bundle.mjs'

// Хеш файла на диске под безопасным targetPath, либо null (нет/ошибка пути).
function diskHash(projectDir, rel) {
  let abs
  try { abs = safeTargetPath(projectDir, rel) } catch { return null }
  if (!existsSync(abs)) return null
  return hashContent(readFileSync(abs, 'utf8'))
}

// Read-only отчёт о состоянии доставки. Не бросает: деградирует через reason/errors.
export function deliveryStatus(projectDir) {
  const mode = nativeDeliveryValid(projectDir) ? 'native' : 'fallback'
  const base = { mode, missing: [], changed: [], drift: [], engines: {}, errors: [] }

  const m = readManifest(projectDir)
  if (m === null) {
    return { ...base, reason: 'missing-or-unreadable-manifest', summary: 'fallback: манифест отсутствует или нечитаем' }
  }
  if (!isUsablePrevManifest(m)) {
    return { ...base, reason: 'unusable-manifest', summary: 'fallback: манифест не от glue либо неподдерживаемая версия' }
  }

  const files = Array.isArray(m.files) ? m.files : []
  const errors = []
  const missing = []
  const changed = []
  const writtenByPath = new Map(files.map((f) => [f.targetPath, f.writtenHash]))

  // disk-vs-manifest (без buildTargets)
  for (const f of files) {
    const cur = diskHash(projectDir, f.targetPath)
    if (cur === null) missing.push(f.targetPath)
    else if (cur !== f.writtenHash) changed.push(f.targetPath)
  }

  // drift через текущий plannedHash (buildTargets); ошибка → errors, drift пуст
  const drift = []
  let plannedByPath = null
  try {
    const contract = loadContract(PLUGIN_ROOT)
    const registry = loadBundle(PLUGIN_ROOT, contract)
    const { targets } = buildTargets({ registry, modules: m.modules ?? [], engines: m.engines ?? [], contract, pluginRoot: PLUGIN_ROOT })
    plannedByPath = new Map(targets.map((t) => [t.targetPath, t.plannedHash]))
    for (const f of files) {
      const planned = plannedByPath.get(f.targetPath)
      if (planned !== undefined && planned !== f.writtenHash) drift.push(f.targetPath)
    }
  } catch (e) {
    errors.push(`drift не вычислен: ${e.message}`)
  }

  // покрытие по ВСЕМ manifest.engines (вкл. codex/gemini)
  const engines = {}
  for (const e of m.engines ?? []) {
    const targetPath = engineTarget(e)
    if (!targetPath) { errors.push(`неизвестный движок в манифесте: ${e}`); continue }
    const written = writtenByPath.get(targetPath)
    const cur = diskHash(projectDir, targetPath)
    let status
    if (cur === null) status = 'missing'
    else if (written !== undefined && cur !== written) status = 'changed'
    else if (plannedByPath && plannedByPath.get(targetPath) !== undefined && plannedByPath.get(targetPath) !== written) status = 'drift'
    else status = 'ok'
    engines[e] = { status, targetPath }
  }

  const reason = mode === 'native' ? 'native-valid'
    : missing.length ? 'targets-missing'
    : changed.length ? 'targets-changed'
    : 'incomplete'
  const summary = mode === 'native'
    ? `native delivery active: ${files.length} files${drift.length ? `; ${drift.length} drifted` : ''}`
    : `fallback (${reason})`

  return { mode, reason, missing, changed, drift, engines, errors, summary }
}
```

- [ ] **Step 5: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/status.test.mjs`
Expected: PASS (6 тестов).

- [ ] **Step 6: Commit**

```powershell
git add plugins/glue/src/plan.mjs plugins/glue/src/status.mjs plugins/glue/test/status.test.mjs
git commit -m "feat(glue): deliveryStatus (per-engine coverage, hash-drift) + engineTarget"
```

---

### Task 3: `session-start.mjs` — хук-ядро (fallback R1)

**Files:**
- Create: `plugins/glue/src/session-start.mjs`
- Test: `plugins/glue/test/session-start.test.mjs`

**Interfaces:**
- Consumes: `nativeDeliveryValid` (Task 1); `readManifest`/`SCHEMA_VERSION` (`manifest.mjs`); `resolveDependencies` (`resolve.mjs`); `buildTargets` (`plan.mjs`); `loadContract`/`loadBundle`/`PLUGIN_ROOT` (`bundle.mjs`); `runInit` (тест).
- Produces: `runSessionStart(projectDir) → {stdout: string, stderr: string, exitCode: number}`. Используется `bin/glue.mjs session-start` (Task 4).

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/session-start.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runSessionStart } from '../src/session-start.mjs'
import { runInit } from '../src/init.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-ss-')) }

test('native валиден → stdout {} , stderr пусто, exit 0, диск не тронут', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    const before = JSON.stringify(snapshot(d))
    const r = runSessionStart(d)
    assert.equal(r.stdout, '{}')
    assert.equal(r.stderr, '')
    assert.equal(r.exitCode, 0)
    assert.equal(JSON.stringify(snapshot(d)), before) // read-only: ничего не записано
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('нет манифеста → fallback инжектит defaults (тела правил)', () => {
  const d = tmp()
  try {
    const r = runSessionStart(d)
    assert.equal(r.exitCode, 0)
    const payload = JSON.parse(r.stdout)
    const ctx = payload.hookSpecificOutput.additionalContext
    assert.match(ctx, /<glue>/)
    assert.match(ctx, /operator-gate|Operator gate/i) // дефолтный модуль operator-gate в инъекции
    assert.match(r.stderr, /native delivery inactive|init/i)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('fallback с usable-манифестом инжектит его modules', () => {
  const d = tmp()
  try {
    // материализуем доставку, затем ломаем native (правим CLAUDE.md) → fallback
    runInit({ selected: ['secret-hygiene'], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    writeFileSync(join(d, 'CLAUDE.md'), 'РУЧНАЯ ПРАВКА', 'utf8') // native invalid, манифест usable
    const r = runSessionStart(d)
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /secret|hygiene/i) // инжектит выбранный модуль из манифеста
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('usable-манифест с modules:[] → инжект пусто (не defaults)', () => {
  const d = tmp()
  try {
    // init без выбора модулей: материализует только инструкц-файл (CLAUDE.md), modules:[]
    runInit({ selected: [], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    writeFileSync(join(d, 'CLAUDE.md'), 'ПРАВКА', 'utf8') // native invalid, манифест usable, modules:[]
    const r = runSessionStart(d)
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /не выбрано|не применяется/i) // честная заметка, без defaults
    assert.doesNotMatch(ctx, /Operator gate/i)       // дефолты НЕ инжектированы
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// Снимок дерева проекта (относительные пути файлов) для проверки read-only.
function snapshot(dir, prefix = '') {
  const out = []
  for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? prefix + '/' + name.name : name.name
    if (name.isDirectory()) out.push(...snapshot(join(dir, name.name), rel))
    else out.push(rel)
  }
  return out
}
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/session-start.test.mjs`
Expected: FAIL — `Cannot find module '../src/session-start.mjs'`.

- [ ] **Step 3: Реализовать**

`plugins/glue/src/session-start.mjs`:

```js
import { readManifest, SCHEMA_VERSION } from './manifest.mjs'
import { nativeDeliveryValid } from './gate.mjs'
import { resolveDependencies } from './resolve.mjs'
import { buildTargets } from './plan.mjs'
import { loadContract, loadBundle, PLUGIN_ROOT } from './bundle.mjs'

// Resolved defaults: модули с default:true + их dependsOn.
function resolvedDefaults(registry) {
  const defaults = Object.keys(registry).filter((id) => registry[id].default)
  return resolveDependencies(registry, defaults)
}

// Выбор модулей для fallback-инъекции (R1):
//  - манифест читаем + schemaVersion '1' + resolve успешно → его modules (в т.ч. [] → пусто);
//  - иначе → resolved defaults. Никогда «все» неявно.
function selectFallbackModules(projectDir, registry) {
  const m = readManifest(projectDir)
  if (m && m.schemaVersion === SCHEMA_VERSION) {
    try { return resolveDependencies(registry, m.modules ?? []) } catch { return resolvedDefaults(registry) }
  }
  return resolvedDefaults(registry)
}

function payload(additionalContext) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } })
}

// Тестируемое ядро SessionStart-хука. Read-only (ничего не пишет в проект). exit 0 всегда.
export function runSessionStart(projectDir) {
  try {
    if (nativeDeliveryValid(projectDir)) {
      // Правила лежат нативно — ноль инъекции, ноль шума.
      return { stdout: '{}', stderr: '', exitCode: 0 }
    }
    const contract = loadContract(PLUGIN_ROOT)
    const registry = loadBundle(PLUGIN_ROOT, contract)
    const modules = selectFallbackModules(projectDir, registry)
    const { targets } = buildTargets({ registry, modules, engines: [], contract, pluginRoot: PLUGIN_ROOT })
    const bodies = targets.filter((t) => t.kind === 'rule').map((t) => t.content)
    const ctx = bodies.length
      ? '<glue>\nАктивные правила проекта (Glue, fallback-инъекция — native-доставка не активна). Соблюдай их:\n\n' + bodies.join('\n\n') + '\n</glue>'
      : '<glue>\nGlue: модули правил не выбраны — контроль не применяется. Сообщаю честно, иллюзии покрытия нет.\n</glue>'
    return { stdout: payload(ctx), stderr: '[glue] native delivery inactive — запусти /glue:init\n', exitCode: 0 }
  } catch (e) {
    // fail-closed: деградированный, но валидный ответ; сессию не валим.
    return { stdout: payload('<glue>\nGlue: ошибка fallback-инъекции — правила не применены.\n</glue>'), stderr: `[glue] fallback error: ${e.message}\n`, exitCode: 0 }
  }
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/session-start.test.mjs`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```powershell
git add plugins/glue/src/session-start.mjs plugins/glue/test/session-start.test.mjs
git commit -m "feat(glue): runSessionStart (read-only hook, R1 fallback injection)"
```

---

### Task 4: `hooks.json` + диспетчер `status`/`session-start`

**Files:**
- Create: `plugins/glue/hooks/hooks.json`
- Modify: `plugins/glue/bin/glue.mjs` (подкоманды `status`, `session-start`)

**Interfaces:**
- Consumes: `deliveryStatus` (Task 2); `runSessionStart` (Task 3); `loadBundle`/`listModules` (срез 1, уже импортированы).
- Produces: активный SessionStart-хук + CLI-подкоманды `status` (JSON) и `session-start` (хук-обёртка). SKILL.md `/glue:status` — срез 4.

- [ ] **Step 1: Сверить matcher legacy-хука (источник, не память)**

Run: `node -e "console.log(require('fs').readFileSync('plugins/glue-core/hooks/hooks.json','utf8'))"`
Expected: видно `"matcher": "startup|clear|compact"` и команда `node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" session-start`. Использовать этот matcher verbatim. Если значение иное — взять фактическое из вывода.

- [ ] **Step 2: Создать `hooks.json`**

`plugins/glue/hooks/hooks.json` (matcher из Step 1; команда указывает на `bin/glue.mjs` нового плагина):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs\" session-start",
            "async": false
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Расширить диспетчер `bin/glue.mjs`**

Заменить весь файл `plugins/glue/bin/glue.mjs` на (добавлены `status` и `session-start`; `list` сохранён):

```js
#!/usr/bin/env node
// glue — единый плагин. Тонкий диспетчер подкоманд над src/.
// Реализованы: list (срез 1), status + session-start (срез 3). init — срез 4.

import { loadBundle, listModules } from '../src/bundle.mjs'
import { deliveryStatus } from '../src/status.mjs'
import { runSessionStart } from '../src/session-start.mjs'

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const [cmd] = process.argv.slice(2)

if (cmd === 'list') {
  // glue list → плоский список модулей встроенного bundle (JSON)
  const registry = loadBundle()
  process.stdout.write(JSON.stringify(listModules(registry), null, 2) + '\n')
} else if (cmd === 'status') {
  // glue status → отчёт о состоянии доставки (JSON)
  process.stdout.write(JSON.stringify(deliveryStatus(PROJECT_DIR), null, 2) + '\n')
} else if (cmd === 'session-start') {
  // SessionStart-хук: native → {}; иначе fallback-инъекция тел правил
  const r = runSessionStart(PROJECT_DIR)
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  process.exit(r.exitCode)
} else {
  process.stderr.write(`[glue] неизвестная команда: ${cmd ?? '(нет)'}\n`)
  process.exit(1)
}
```

- [ ] **Step 4: Проверить `status` end-to-end (нет манифеста → fallback JSON)**

Run (PowerShell): `node plugins/glue/bin/glue.mjs status`
Expected: JSON с `"mode": "fallback"` и `"reason": "missing-or-unreadable-manifest"` (в этом dev-репо `.glue/manifest.json` нет), exit 0.

- [ ] **Step 5: Проверить `session-start` end-to-end**

Run (PowerShell): `node plugins/glue/bin/glue.mjs session-start`
Expected: на stdout — JSON `hookSpecificOutput` с `additionalContext` (fallback defaults, т.к. манифеста нет), на stderr — `[glue] native delivery inactive…`, exit 0.

- [ ] **Step 6: Проверить валидность `hooks.json`**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/glue/hooks/hooks.json','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 7: Прогнать весь набор плагина (glob-форма)**

Run: `node --test "plugins/glue/test/*.test.mjs"`
Expected: PASS — все тесты срезов 1-3 (`bundle`/`list`/`hash`/`paths`/`resolve`/`blocks`/`manifest`/`decide`/`plan`/`apply`/`init`/`gate`/`status`/`session-start`), `fail 0`.

- [ ] **Step 8: Commit**

```powershell
git add plugins/glue/hooks/hooks.json plugins/glue/bin/glue.mjs
git commit -m "feat(glue): SessionStart hook + status/session-start dispatch"
```

---

## Self-Review

**Spec coverage (slice3-design):**
- § gate (`nativeDeliveryValid`, переиспользует `isUsablePrevManifest`, без версий, не требует AGENTS/GEMINI, throw→false) — Task 1 ✓.
- § status (`mode`/`reason`/`missing`/`changed`/`drift`/`engines`/`errors`/`summary`; drift через `buildTargets`; не бросает; per-engine drift только если вычислен) — Task 2 ✓.
- § хук (`runSessionStart`; native→`{}`; read-only; R1 выбор модулей вкл. empty→пусто; fail-closed exit 0) — Task 3 ✓.
- § обвязка (`hooks.json` matcher из legacy-файла; `bin` подкоманды `status`/`session-start`; `engineTarget`) — Task 4 + Task 2 ✓.
- § Acceptance 3 (status по всем движкам + сигнал новее-контент) — Task 2 (`engines` по `m.engines`, `drift`) ✓.
- § Acceptance 4 (SessionStart fallback семантика, узкий Claude-gate) — Task 1 + Task 3 ✓.
- § Тесты (все перечисленные классы) — Task 1-4 ✓.
- **Вне плана** (срез 4/5): SKILL.md, 10-сценарный прогон, cutover.

**Placeholder scan:** плейсхолдеров нет; весь код приведён полностью; команды и ожидаемый вывод явны.

**Type consistency:**
- `nativeDeliveryValid(projectDir) → boolean` — сигнатура совпадает в Task 1 (декл.), Task 2 (`status` consume), Task 3 (`session-start` consume).
- `deliveryStatus(projectDir) → {mode, reason, missing, changed, drift, engines, errors, summary}` — форма совпадает в Task 2 (реализация + тест) и Task 4 (`bin`).
- `runSessionStart(projectDir) → {stdout, stderr, exitCode}` — совпадает в Task 3 (реализация + тест) и Task 4 (`bin`).
- `engineTarget(engine) → string|null` — декл. Task 2 (в `plan.mjs`), consume `status.mjs` Task 2.
- `buildTargets({registry, modules, engines, contract, pluginRoot}) → {targets, deliveredEngines}` — потребляется в `status.mjs` и `session-start.mjs` ровно как объявлено в срезе 2 (`plan.mjs`).
- `isUsablePrevManifest`/`readManifest`/`SCHEMA_VERSION`/`buildManifest`/`writeManifest` — из `manifest.mjs` (срез 2), сигнатуры неизменны.

**File-cap check:** 9 файлов (3 src + 1 plan-mod + 1 bin-mod + 1 hooks.json + 3 теста; ≤15) ✓.

**Shell check:** file-команды — PowerShell/`node`; полный прогон — glob-форма (directory-форма на Node 24 падает, проверено).

**Read-only хук:** `session-start.test` сверяет снимок дерева до/после (Task 3) — инвариант «хук не пишет в проект» проверяется механически ✓.
