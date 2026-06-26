# Glue срез 2 — движок `plan`/`apply`/`manifest` + `runInit` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести «движок» Glue (resolve → plan → conflict-gate → apply → manifest) в greenfield-форму одного плагина с чистым швом `buildTargets`/`decidePlan` и программным `runInit`.

**Architecture:** Восемь сфокусированных модулей в `plugins/glue/src/`. Конфликт-алгоритм (`decidePlan`) — чистая функция над `targets` + `prevManifest` + `diskHashFn`; чтение контента (`buildTargets`) развязано от решения. `runInit` композирует всё поверх `loadBundle` (срез 1). Никакого `discovery`/скана реестра/меж-пакового merge — один встроенный bundle.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`. Без внешних зависимостей. Node v24 на Windows.

## Global Constraints

- **Один плагин `glue`**: контент встроен; **нет** скана `installed_plugins.json`, `discovery`, `mergePackRegistries`, qualified IDs, меж-пакового merge. (collapse-design § «Снятые инварианты»)
- **`safeSourcePath` выброшен** — источник из своего доверенного bundle; `safeTargetPath` сохранён. (slice2-design § Скоуп)
- **Провенанс — константа:** `producerPack: "glue"`, `packVersion` = `version` из `plugin.json`. В gate валидности (срез 3) `packVersion` не входит. (collapse-design § «Манифест»)
- **`SCHEMA_VERSION = '1'`** (порт verbatim; legacy тоже '1' → дискриминатор legacy ≠ schemaVersion, а `producerPack`). (slice2-design § Провенанс)
- **Движки `runInit`:** пуст/не передан → `['claude']`; передан явно → валидировать как есть, **не** авто-добавлять `claude`. (slice2-design § API)
- **fail-fast на неизвестный движок** до любого чтения/записи (`Unknown engine: x`); известный запрошенный движок без `.tmpl` → `throw` (битый bundle-инвариант, не silent skip). (slice2-design § API)
- **blocks-фильтрация** идёт по **module-id** (`resolvedIds`), не по `instructionBlock`. (legacy `planner` поведение)
- **Имена** (slug'и, файлы, ключи) — ASCII; содержание правил — русский. (`glossary.md`)
- **Бюджет PR** (`pr-policy`): target 400, hard-cap 800 reviewable строк / **15 файлов**. Срез 2 = **2 PR** (A: примитивы+манифест; B: plan/apply/runInit).
- **Окружение:** Windows, primary shell — PowerShell. Полный прогон тестов — **glob-форма** `node --test "plugins/glue/test/*.test.mjs"` (directory-форма на Node 24 падает). Одиночный файл — `node --test plugins/glue/test/<name>.test.mjs`.
- **Код плагина — только worktree + PR** (`worktree-workflow`). Этот план исполняется в worktree ветки `feat-glue-slice2` (или двух ветках под PR A/PR B — см. § PR Boundaries).

---

## File Structure

| Файл | Ответственность | PR |
|---|---|---|
| `plugins/glue/src/hash.mjs` | `hashContent` (sha256 hex) | A |
| `plugins/glue/src/paths.mjs` | `safeTargetPath` + `TARGET_ZONES` | A |
| `plugins/glue/src/resolve.mjs` | `resolveDependencies` (топосорт) | A |
| `plugins/glue/src/blocks.mjs` | `filterModuleBlocks` | A |
| `plugins/glue/src/manifest.mjs` | `buildManifest`/`readManifest`/`writeManifest`/`isUsablePrevManifest`/`SCHEMA_VERSION`/`PRODUCER` | A |
| `plugins/glue/src/plan.mjs` | `buildTargets`/`decidePlan`/`plan`/`KNOWN_ENGINES` | B |
| `plugins/glue/src/apply.mjs` | `applyPlan` (preflight TOCTOU/symlink + запись + манифест) | B |
| `plugins/glue/src/init.mjs` | `runInit` (оркестратор) | B |
| `plugins/glue/src/bundle.mjs` | **modify:** экспорт `PLUGIN_ROOT` + `readPluginVersion` | B |
| `plugins/glue/test/hash.test.mjs` | тест hash | A |
| `plugins/glue/test/paths.test.mjs` | тест target-zones | A |
| `plugins/glue/test/resolve.test.mjs` | тест топосорта | A |
| `plugins/glue/test/blocks.test.mjs` | тест фильтрации блоков | A |
| `plugins/glue/test/manifest.test.mjs` | тест манифеста + usability-гейт | A |
| `plugins/glue/test/decide.test.mjs` | тест чистого конфликт-алгоритма | B |
| `plugins/glue/test/plan.test.mjs` | тест `buildTargets`/`plan` на реальном bundle | B |
| `plugins/glue/test/apply.test.mjs` | тест TOCTOU/symlink/атомарность | B |
| `plugins/glue/test/init.test.mjs` | интеграция `runInit` на temp projectDir | B |

### PR Boundaries

- **PR A** (ветка `feat-glue-slice2-prims`) = Task 1-5 — примитивы + манифест (~10 файлов, ~310 reviewable строк). Зелёный HEAD: 5 тест-файлов проходят.
- **PR B** (ветка `feat-glue-slice2-engine`, от смерженного PR A) = Task 6-9 — plan/apply/runInit (8 файлов, ~510 reviewable строк; в target не влезает, в hard-cap 800 — да; одна цель — движок). Зелёный HEAD: весь набор тестов проходит.

Каждый PR: simplify pass перед push (`pr-policy`); merge через `gh --rebase` по operator-gate.

---

# PR A — примитивы + манифест

### Task 1: `hash.mjs` — контентный хеш

**Files:**
- Create: `plugins/glue/src/hash.mjs`
- Test: `plugins/glue/test/hash.test.mjs`

**Interfaces:**
- Consumes: ничего.
- Produces: `hashContent(data: string) → string` — sha256 hex. Используется `manifest`/`plan`/`apply`.

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/hash.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashContent } from '../src/hash.mjs'

test('hashContent детерминирован и hex', () => {
  const h = hashContent('abc')
  assert.equal(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(hashContent('abc'), h)
})

test('hashContent различает входы', () => {
  assert.notEqual(hashContent('a'), hashContent('b'))
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/hash.test.mjs`
Expected: FAIL — `Cannot find module '../src/hash.mjs'`.

- [ ] **Step 3: Реализовать**

`plugins/glue/src/hash.mjs`:

```js
import { createHash } from 'node:crypto'

export function hashContent(data) {
  return createHash('sha256').update(data).digest('hex')
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/hash.test.mjs`
Expected: PASS (2 теста).

- [ ] **Step 5: Commit**

```powershell
git add plugins/glue/src/hash.mjs plugins/glue/test/hash.test.mjs
git commit -m "feat(glue): hashContent (sha256)"
```

---

### Task 2: `paths.mjs` — target path-safety

**Files:**
- Create: `plugins/glue/src/paths.mjs`
- Test: `plugins/glue/test/paths.test.mjs`

**Interfaces:**
- Consumes: ничего.
- Produces: `safeTargetPath(projectDir: string, rel: string) → string` (абсолютный путь) — бросает, если `rel` абсолютный, выходит за `projectDir`, или вне разрешённых зон (`.claude/`, `.glue/`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`). `TARGET_ZONES` экспортируется. Используется `plan`/`apply`.

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/paths.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { safeTargetPath } from '../src/paths.mjs'

const DIR = resolve('/tmp/proj')

test('safeTargetPath разрешает файлы в зонах', () => {
  assert.equal(safeTargetPath(DIR, '.claude/rules/x.md'), resolve(DIR, '.claude/rules/x.md'))
  assert.equal(safeTargetPath(DIR, 'CLAUDE.md'), resolve(DIR, 'CLAUDE.md'))
  assert.equal(safeTargetPath(DIR, '.glue/manifest.json'), resolve(DIR, '.glue/manifest.json'))
})

test('safeTargetPath бросает на абсолютный rel', () => {
  assert.throws(() => safeTargetPath(DIR, resolve('/etc/passwd')), /must be relative/)
})

test('safeTargetPath бросает на escape из проекта', () => {
  assert.throws(() => safeTargetPath(DIR, '../outside.md'), /escapes project/)
})

test('safeTargetPath бросает на путь вне зон', () => {
  assert.throws(() => safeTargetPath(DIR, 'src/code.js'), /outside allowed zone/)
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/paths.test.mjs`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`plugins/glue/src/paths.mjs`:

```js
import { resolve, relative, isAbsolute, sep } from 'node:path'

// Разрешённые целевые зоны проекта (префиксы относительного пути).
export const TARGET_ZONES = ['.claude' + sep, '.glue' + sep, 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md']

// target должен остаться внутри проекта и в разрешённой зоне после нормализации.
export function safeTargetPath(projectDir, rel) {
  if (isAbsolute(rel)) throw new Error(`target must be relative: ${rel}`)
  const abs = resolve(projectDir, rel)
  const r = relative(projectDir, abs)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error(`target escapes project: ${rel}`)
  const norm = r.split('/').join(sep)
  if (!TARGET_ZONES.some((z) => norm === z || norm.startsWith(z))) {
    throw new Error(`target outside allowed zone: ${rel}`)
  }
  return abs
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/paths.test.mjs`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```powershell
git add plugins/glue/src/paths.mjs plugins/glue/test/paths.test.mjs
git commit -m "feat(glue): safeTargetPath + target zones"
```

---

### Task 3: `resolve.mjs` — топосорт зависимостей

**Files:**
- Create: `plugins/glue/src/resolve.mjs`
- Test: `plugins/glue/test/resolve.test.mjs`

**Interfaces:**
- Consumes: ничего (работает с любым `registry`-объектом `{id: {dependsOn: []}}`).
- Produces: `resolveDependencies(registry, selected: string[]) → string[]` — `selected` + дотянутые `dependsOn` в топологическом порядке (зависимость раньше зависящего); бросает на цикл и на неизвестный модуль. Используется `runInit`.

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/resolve.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDependencies } from '../src/resolve.mjs'

const REG = {
  a: { dependsOn: [] },
  b: { dependsOn: ['a'] },
  c: { dependsOn: ['b'] },
}

test('resolveDependencies дотягивает зависимости в топопорядке', () => {
  assert.deepEqual(resolveDependencies(REG, ['c']), ['a', 'b', 'c'])
})

test('resolveDependencies без дублей при пересечении', () => {
  assert.deepEqual(resolveDependencies(REG, ['b', 'c']), ['a', 'b', 'c'])
})

test('resolveDependencies бросает на неизвестный модуль', () => {
  assert.throws(() => resolveDependencies(REG, ['nope']), /Unknown module: nope/)
})

test('resolveDependencies бросает на цикл', () => {
  const cyc = { x: { dependsOn: ['y'] }, y: { dependsOn: ['x'] } }
  assert.throws(() => resolveDependencies(cyc, ['x']), /Dependency cycle/)
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/resolve.test.mjs`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`plugins/glue/src/resolve.mjs`:

```js
// Возвращает selected + дотянутые зависимости в топологическом порядке
// (каждая зависимость стоит раньше зависящего от неё модуля).
export function resolveDependencies(registry, selected) {
  const resolved = []
  const visiting = new Set()
  const done = new Set()

  function visit(id, chain) {
    if (done.has(id)) return
    if (visiting.has(id)) {
      throw new Error(`Dependency cycle: ${[...chain, id].join(' → ')}`)
    }
    if (!registry[id]) {
      throw new Error(`Unknown module: ${id}`)
    }
    visiting.add(id)
    for (const dep of registry[id].dependsOn ?? []) {
      visit(dep, [...chain, id])
    }
    visiting.delete(id)
    done.add(id)
    resolved.push(id)
  }

  for (const id of selected) visit(id, [])
  return resolved
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/resolve.test.mjs`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```powershell
git add plugins/glue/src/resolve.mjs plugins/glue/test/resolve.test.mjs
git commit -m "feat(glue): resolveDependencies (toposort)"
```

---

### Task 4: `blocks.mjs` — фильтрация module-блоков

**Files:**
- Create: `plugins/glue/src/blocks.mjs`
- Test: `plugins/glue/test/blocks.test.mjs`

**Interfaces:**
- Consumes: ничего.
- Produces: `filterModuleBlocks(text: string, keepIds: string[]) → string` — оставляет содержимое блоков `<!-- module:id -->…<!-- /module -->` для `id ∈ keepIds` (снимая маркеры), вырезает прочие блоки целиком; бросает на вложенные/непарные маркеры. Используется `buildTargets`. (`listModuleBlockIds` — отложен в срез 3.)

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/blocks.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterModuleBlocks } from '../src/blocks.mjs'

const TXT = [
  'head',
  '<!-- module:a -->',
  'A-body',
  '<!-- /module -->',
  '<!-- module:b -->',
  'B-body',
  '<!-- /module -->',
  'tail',
].join('\n')

test('filterModuleBlocks оставляет keep, вырезает прочие, снимает маркеры', () => {
  assert.equal(filterModuleBlocks(TXT, ['a']), ['head', 'A-body', 'tail'].join('\n'))
})

test('filterModuleBlocks с пустым keep вырезает все блоки', () => {
  assert.equal(filterModuleBlocks(TXT, []), ['head', 'tail'].join('\n'))
})

test('filterModuleBlocks бросает на вложенный блок', () => {
  const nested = '<!-- module:a -->\n<!-- module:b -->\nx\n<!-- /module -->\n<!-- /module -->'
  assert.throws(() => filterModuleBlocks(nested, ['a', 'b']), /nested module block/)
})

test('filterModuleBlocks бросает на непарный close', () => {
  assert.throws(() => filterModuleBlocks('x\n<!-- /module -->', []), /stray/)
})

test('filterModuleBlocks бросает на незакрытый блок', () => {
  assert.throws(() => filterModuleBlocks('<!-- module:a -->\nx', ['a']), /unclosed module block/)
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/blocks.test.mjs`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`plugins/glue/src/blocks.mjs`:

```js
const OPEN = /^\s*<!--\s*module:([\w-]+)\s*-->\s*$/
const CLOSE = /^\s*<!--\s*\/module\s*-->\s*$/

// Оставляет содержимое блоков из keepIds (снимая маркеры),
// удаляет блоки модулей не из keepIds целиком. Маркеры в выводе не остаются.
export function filterModuleBlocks(text, keepIds) {
  const keep = new Set(keepIds)
  const out = []
  let openId = null   // id текущего открытого блока, либо null
  let skipping = false

  for (const line of text.split('\n')) {
    const open = line.match(OPEN)
    if (open) {
      if (openId !== null) {
        throw new Error(`nested module block: ${open[1]} inside ${openId}`)
      }
      openId = open[1]
      skipping = !keep.has(openId)
      continue // маркер не пишем
    }
    if (CLOSE.test(line)) {
      if (openId === null) throw new Error('stray <!-- /module --> with no open block')
      openId = null
      skipping = false
      continue // маркер не пишем
    }
    if (skipping) continue
    out.push(line)
  }

  if (openId !== null) throw new Error(`unclosed module block: ${openId}`)
  return out.join('\n')
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/blocks.test.mjs`
Expected: PASS (5 тестов).

- [ ] **Step 5: Commit**

```powershell
git add plugins/glue/src/blocks.mjs plugins/glue/test/blocks.test.mjs
git commit -m "feat(glue): filterModuleBlocks (engine block filtering)"
```

---

### Task 5: `manifest.mjs` — формат + усабилити-гейт

**Files:**
- Create: `plugins/glue/src/manifest.mjs`
- Test: `plugins/glue/test/manifest.test.mjs`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `SCHEMA_VERSION = '1'`, `PRODUCER = 'glue'`;
  - `buildManifest({deliveryId, completedAt, engines, modules, files}) → object` — `{schemaVersion, deliveryId, completedAt, engines, modules, status:'complete', files}`;
  - `readManifest(projectDir) → object|null` — `.glue/manifest.json`; отсутствует → null; **corrupt JSON → null (не throw)**;
  - `writeManifest(projectDir, manifest)` — атомарно (tmp + `renameSync`);
  - `isUsablePrevManifest(m) → boolean` — `true`, если `m.schemaVersion === '1'` И все `m.files` имеют `producerPack === 'glue'`.
  - Используется `plan` (read+usability), `apply` (build+write), `runInit`.

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/manifest.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildManifest, readManifest, writeManifest, isUsablePrevManifest, SCHEMA_VERSION, PRODUCER,
} from '../src/manifest.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-mf-')) }

test('buildManifest задаёт schemaVersion/status', () => {
  const m = buildManifest({ deliveryId: 'd', completedAt: 'c', engines: ['claude'], modules: ['a'], files: [] })
  assert.equal(m.schemaVersion, SCHEMA_VERSION)
  assert.equal(m.status, 'complete')
  assert.deepEqual(m.modules, ['a'])
})

test('readManifest отсутствующего → null', () => {
  const d = tmp()
  try { assert.equal(readManifest(d), null) } finally { rmSync(d, { recursive: true, force: true }) }
})

test('write→read round-trip; tmp убран', () => {
  const d = tmp()
  try {
    const m = buildManifest({ deliveryId: 'd', completedAt: 'c', engines: ['claude'], modules: [], files: [] })
    writeManifest(d, m)
    assert.deepEqual(readManifest(d), m)
    assert.equal(existsSync(join(d, '.glue', 'manifest.json.tmp')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('readManifest corrupt JSON → null (не throw)', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.glue'), { recursive: true })
    writeFileSync(join(d, '.glue', 'manifest.json'), '{not json', 'utf8')
    assert.equal(readManifest(d), null)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('isUsablePrevManifest: glue → true, чужой producerPack → false', () => {
  assert.equal(isUsablePrevManifest({ schemaVersion: '1', files: [{ producerPack: PRODUCER }] }), true)
  assert.equal(isUsablePrevManifest({ schemaVersion: '1', files: [] }), true)
  assert.equal(isUsablePrevManifest({ schemaVersion: '1', files: [{ producerPack: 'glue-rules' }] }), false)
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', files: [] }), false)
  assert.equal(isUsablePrevManifest(null), false)
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/manifest.test.mjs`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

`plugins/glue/src/manifest.mjs`:

```js
import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SCHEMA_VERSION = '1'
const PRODUCER = 'glue'
const rel = (d) => join(d, '.glue', 'manifest.json')

export function buildManifest({ deliveryId, completedAt, engines, modules, files }) {
  return { schemaVersion: SCHEMA_VERSION, deliveryId, completedAt, engines, modules, status: 'complete', files }
}

// Сырой ридер: отсутствует → null; битый JSON → null (не crash).
export function readManifest(projectDir) {
  const p = rel(projectDir)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

// Можно ли доверять манифесту как prevManifest: наш формат и наш producer.
// Legacy/чужой манифест (producerPack ≠ 'glue') → не используется для миграции.
export function isUsablePrevManifest(m) {
  return !!m && m.schemaVersion === SCHEMA_VERSION && (m.files ?? []).every((f) => f.producerPack === PRODUCER)
}

// Атомарно: пишем во временный + rename (последним, после всех файлов).
export function writeManifest(projectDir, manifest) {
  mkdirSync(join(projectDir, '.glue'), { recursive: true })
  const p = rel(projectDir)
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  renameSync(tmp, p)
}

export { SCHEMA_VERSION, PRODUCER }
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/manifest.test.mjs`
Expected: PASS (5 тестов).

- [ ] **Step 5: Прогнать весь набор PR A (glob-форма)**

Run: `node --test "plugins/glue/test/*.test.mjs"`
Expected: PASS — `bundle`/`list` (срез 1) + `hash`/`paths`/`resolve`/`blocks`/`manifest` зелёные, `fail 0`.

- [ ] **Step 6: Commit**

```powershell
git add plugins/glue/src/manifest.mjs plugins/glue/test/manifest.test.mjs
git commit -m "feat(glue): manifest format + readManifest tolerance + usability gate"
```

> **Конец PR A.** Перед push — simplify pass (`pr-policy`). PR создаётся/мёржится по operator-gate. PR B стартует от смерженного PR A.

---

# PR B — plan/apply/runInit

### Task 6: `decidePlan` — чистый конфликт-алгоритм

**Files:**
- Create: `plugins/glue/src/plan.mjs` (только `decidePlan` на этом шаге)
- Test: `plugins/glue/test/decide.test.mjs`

**Interfaces:**
- Consumes: ничего (чистая функция).
- Produces: `decidePlan({targets, prevManifest, diskHashFn, force}) → {writes, materialized, deletes, conflicts}`.
  - `targets`: `[{targetPath, plannedHash, content, sourceTemplate, kind}]`;
  - `diskHashFn(targetPath) → string|null` — текущий хеш файла на диске или null;
  - `prevManifest`: `{files:[{targetPath, writtenHash}]}|null`;
  - `writes`: `[{targetPath, plannedHash, content, sourceTemplate, kind, expectedCurrentHash}]`;
  - `materialized`: `[{targetPath, plannedHash, sourceTemplate, kind}]`;
  - `deletes`: `[{targetPath, expectedCurrentHash}]`;
  - `conflicts`: `[{targetPath, reason}]`.
  - Используется `plan` (Task 7).

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/decide.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidePlan } from '../src/plan.mjs'

const T = (targetPath, plannedHash) => ({ targetPath, plannedHash, content: 'C', sourceTemplate: 's.md', kind: 'rule' })
const disk = (map) => (p) => (p in map ? map[p] : null)

test('absent на диске → write с expectedCurrentHash null', () => {
  const r = decidePlan({ targets: [T('.claude/rules/a.md', 'H')], prevManifest: null, diskHashFn: disk({}), force: false })
  assert.equal(r.writes.length, 1)
  assert.equal(r.writes[0].expectedCurrentHash, null)
  assert.equal(r.writes[0].plannedHash, 'H')
})

test('current == plannedHash → materialized (recovery)', () => {
  const r = decidePlan({ targets: [T('.claude/rules/a.md', 'H')], prevManifest: null, diskHashFn: disk({ '.claude/rules/a.md': 'H' }), force: false })
  assert.equal(r.writes.length, 0)
  assert.equal(r.materialized.length, 1)
  assert.equal(r.materialized[0].plannedHash, 'H')
})

test('managed и current == writtenHash → write (update)', () => {
  const prev = { files: [{ targetPath: '.claude/rules/a.md', writtenHash: 'OLD' }] }
  const r = decidePlan({ targets: [T('.claude/rules/a.md', 'NEW')], prevManifest: prev, diskHashFn: disk({ '.claude/rules/a.md': 'OLD' }), force: false })
  assert.equal(r.writes.length, 1)
  assert.equal(r.writes[0].expectedCurrentHash, 'OLD')
  assert.equal(r.conflicts.length, 0)
})

test('current != plannedHash и unmanaged → conflict', () => {
  const r = decidePlan({ targets: [T('.claude/rules/a.md', 'H')], prevManifest: null, diskHashFn: disk({ '.claude/rules/a.md': 'HAND' }), force: false })
  assert.equal(r.writes.length, 0)
  assert.equal(r.conflicts.length, 1)
  assert.equal(r.conflicts[0].reason, 'hash mismatch')
})

test('force перезаписывает конфликт (expectedCurrentHash = current)', () => {
  const r = decidePlan({ targets: [T('.claude/rules/a.md', 'H')], prevManifest: null, diskHashFn: disk({ '.claude/rules/a.md': 'HAND' }), force: true })
  assert.equal(r.conflicts.length, 0)
  assert.equal(r.writes[0].expectedCurrentHash, 'HAND')
})

test('снятый managed-файл без правок → delete', () => {
  const prev = { files: [{ targetPath: '.claude/rules/old.md', writtenHash: 'W' }] }
  const r = decidePlan({ targets: [], prevManifest: prev, diskHashFn: disk({ '.claude/rules/old.md': 'W' }), force: false })
  assert.deepEqual(r.deletes, [{ targetPath: '.claude/rules/old.md', expectedCurrentHash: 'W' }])
})

test('снятый правленный файл → conflict (без force)', () => {
  const prev = { files: [{ targetPath: '.claude/rules/old.md', writtenHash: 'W' }] }
  const r = decidePlan({ targets: [], prevManifest: prev, diskHashFn: disk({ '.claude/rules/old.md': 'HAND' }), force: false })
  assert.equal(r.deletes.length, 0)
  assert.equal(r.conflicts[0].reason, 'dropped file hand-edited')
})

test('снятый уже отсутствующий файл → ничего', () => {
  const prev = { files: [{ targetPath: '.claude/rules/old.md', writtenHash: 'W' }] }
  const r = decidePlan({ targets: [], prevManifest: prev, diskHashFn: disk({}), force: false })
  assert.equal(r.deletes.length, 0)
  assert.equal(r.conflicts.length, 0)
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/decide.test.mjs`
Expected: FAIL — модуль/экспорт не найден.

- [ ] **Step 3: Реализовать `decidePlan` в `plan.mjs`**

`plugins/glue/src/plan.mjs` (на этом шаге — только `decidePlan`; `buildTargets`/`plan`/`KNOWN_ENGINES` добавит Task 7):

```js
// Чистый конфликт-алгоритм: решает writes/materialized/deletes/conflicts по
// targets + prevManifest + diskHashFn. Не читает bundle, не знает про движки.
export function decidePlan({ targets, prevManifest, diskHashFn, force = false }) {
  const prevFiles = new Map((prevManifest?.files ?? []).map((f) => [f.targetPath, f]))
  const writes = []
  const materialized = []
  const deletes = []
  const conflicts = []
  const newTargetPaths = new Set(targets.map((t) => t.targetPath))

  for (const t of targets) {
    const current = diskHashFn(t.targetPath)
    const writtenHash = prevFiles.get(t.targetPath)?.writtenHash ?? null

    const writeEntry = (expectedCurrentHash) =>
      writes.push({
        targetPath: t.targetPath,
        plannedHash: t.plannedHash,
        content: t.content,
        sourceTemplate: t.sourceTemplate,
        kind: t.kind,
        expectedCurrentHash,
      })

    if (current === null) {
      writeEntry(null)
    } else if (current === t.plannedHash) {
      materialized.push({
        targetPath: t.targetPath,
        plannedHash: t.plannedHash,
        sourceTemplate: t.sourceTemplate,
        kind: t.kind,
      })
    } else if (writtenHash !== null && current === writtenHash) {
      writeEntry(writtenHash)
    } else if (force) {
      writeEntry(current)
    } else {
      conflicts.push({ targetPath: t.targetPath, reason: 'hash mismatch' })
    }
  }

  for (const [targetPath, f] of prevFiles) {
    if (newTargetPaths.has(targetPath)) continue
    const current = diskHashFn(targetPath)
    if (current === null) continue
    if (current === f.writtenHash) {
      deletes.push({ targetPath, expectedCurrentHash: f.writtenHash })
    } else if (force) {
      deletes.push({ targetPath, expectedCurrentHash: current })
    } else {
      conflicts.push({ targetPath, reason: 'dropped file hand-edited' })
    }
  }

  return { writes, materialized, deletes, conflicts }
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/decide.test.mjs`
Expected: PASS (8 тестов).

- [ ] **Step 5: Commit**

```powershell
git add plugins/glue/src/plan.mjs plugins/glue/test/decide.test.mjs
git commit -m "feat(glue): decidePlan (pure conflict algorithm)"
```

---

### Task 7: `buildTargets` + `plan` + `KNOWN_ENGINES`

**Files:**
- Modify: `plugins/glue/src/plan.mjs` (добавить `buildTargets`, `plan`, `KNOWN_ENGINES`, engine-map)
- Test: `plugins/glue/test/plan.test.mjs`

**Interfaces:**
- Consumes: `decidePlan` (Task 6); `hashContent` (Task 1); `filterModuleBlocks` (Task 4); `safeTargetPath` (Task 2); `readManifest`/`isUsablePrevManifest` (Task 5); `loadBundle`/`loadContract`/`PLUGIN_ROOT` (срез 1 + Task 8).
- Produces:
  - `KNOWN_ENGINES: string[]` (`['claude','codex','gemini']`);
  - `buildTargets({registry, modules, engines, contract, pluginRoot}) → {targets, deliveredEngines}` — rule-targets из `content/modules`, instruction-targets из `content/instructions` (через `filterModuleBlocks(text, modules)`); неизвестный движок → throw до чтения; известный движок без `.tmpl` → throw;
  - `plan({registry, modules, engines, contract, pluginRoot, projectDir, force}) → {writes, materialized, deletes, conflicts, deliveredEngines}`.
  - Используется `runInit` (Task 9).

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/plan.test.mjs` (использует реальный bundle плагина + temp projectDir):

```js
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
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/plan.test.mjs`
Expected: FAIL — `buildTargets`/`plan`/`KNOWN_ENGINES` не экспортированы.

> Примечание: тест импортирует `loadContract`/`loadBundle` из `bundle.mjs` (срез 1, уже есть). `PLUGIN_ROOT` в `plan.mjs` ниже импортируется из `bundle.mjs` — будет добавлен в Task 8; для прохождения Task 7 порядок задач B: сначала Task 8 (экспорт `PLUGIN_ROOT`), либо в `plan.mjs` вычислить корень локально. **Решение:** `buildTargets`/`plan` получают `pluginRoot` параметром (не импортируют) — модуль `plan.mjs` от `PLUGIN_ROOT` не зависит. `PLUGIN_ROOT` нужен только `runInit` (Task 9). Поэтому Task 7 самодостаточен.

- [ ] **Step 3: Дописать `plan.mjs`**

Добавить в начало `plugins/glue/src/plan.mjs` импорты и константы, и в конец — `buildTargets`/`plan`:

```js
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { hashContent } from './hash.mjs'
import { filterModuleBlocks } from './blocks.mjs'
import { safeTargetPath } from './paths.mjs'
import { readManifest, isUsablePrevManifest } from './manifest.mjs'

// engine → [instruction template filename, target relative path]
const ENGINE_INSTRUCTIONS = {
  claude: ['CLAUDE.md.tmpl', 'CLAUDE.md'],
  codex: ['AGENTS.md.tmpl', 'AGENTS.md'],
  gemini: ['GEMINI.md.tmpl', 'GEMINI.md'],
}
export const KNOWN_ENGINES = Object.keys(ENGINE_INSTRUCTIONS)
```

```js
// Строит планируемые targets из встроенного контента. Источник доверенный
// (свой bundle) — path-safety источника не применяется.
export function buildTargets({ registry, modules, engines, contract, pluginRoot }) {
  // fail-fast на неизвестный движок ДО любого чтения
  for (const engine of engines) {
    if (!ENGINE_INSTRUCTIONS[engine]) throw new Error(`Unknown engine: ${engine}`)
  }

  const targets = []
  const deliveredEngines = []

  // 1. Rule-файлы — по одному на имя из templates[] каждого модуля (в порядке modules).
  for (const id of modules) {
    const mod = registry[id]
    for (const file of mod.templates) {
      const content = readFileSync(join(pluginRoot, contract.modulesDir, file), 'utf8')
      targets.push({
        targetPath: '.claude/rules/' + file,
        plannedHash: hashContent(content),
        content,
        sourceTemplate: file,
        kind: 'rule',
      })
    }
  }

  // 2. Instruction-файлы — по одному на движок; .tmpl обязан существовать.
  for (const engine of engines) {
    const [tmpl, targetFile] = ENGINE_INSTRUCTIONS[engine]
    const src = join(pluginRoot, contract.instructionsDir, tmpl)
    if (!existsSync(src)) {
      throw new Error(`bundle missing instruction template for engine '${engine}': ${tmpl}`)
    }
    const filtered = filterModuleBlocks(readFileSync(src, 'utf8'), modules)
    targets.push({
      targetPath: targetFile,
      plannedHash: hashContent(filtered),
      content: filtered,
      sourceTemplate: tmpl,
      kind: 'instruction',
    })
    deliveredEngines.push(engine)
  }

  return { targets, deliveredEngines }
}

// Тонкая композиция: buildTargets + prevManifest-гейт + diskHashFn + decidePlan.
export function plan({ registry, modules, engines, contract, pluginRoot, projectDir, force = false }) {
  const { targets, deliveredEngines } = buildTargets({ registry, modules, engines, contract, pluginRoot })

  const raw = readManifest(projectDir)
  const prevManifest = isUsablePrevManifest(raw) ? raw : null

  const diskHashFn = (rel) => {
    const abs = safeTargetPath(projectDir, rel)
    if (!existsSync(abs)) return null
    return hashContent(readFileSync(abs, 'utf8'))
  }

  const { writes, materialized, deletes, conflicts } = decidePlan({ targets, prevManifest, diskHashFn, force })
  return { writes, materialized, deletes, conflicts, deliveredEngines }
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/plan.test.mjs`
Expected: PASS (6 тестов).

- [ ] **Step 5: Commit**

```powershell
git add plugins/glue/src/plan.mjs plugins/glue/test/plan.test.mjs
git commit -m "feat(glue): buildTargets + plan composition + KNOWN_ENGINES"
```

---

### Task 8: `bundle.mjs` экспорт корня/версии + `apply.mjs`

**Files:**
- Modify: `plugins/glue/src/bundle.mjs` (экспорт `PLUGIN_ROOT` + `readPluginVersion`)
- Create: `plugins/glue/src/apply.mjs`
- Test: `plugins/glue/test/apply.test.mjs`

**Interfaces:**
- Consumes: `hashContent` (Task 1); `safeTargetPath` (Task 2); `buildManifest`/`writeManifest`/`PRODUCER` (Task 5).
- Produces:
  - `bundle.mjs`: `PLUGIN_ROOT` (экспорт существующей константы), `readPluginVersion(root?) → string` (читает `.claude-plugin/plugin.json` `.version`);
  - `apply.mjs`: `applyPlan({plan, projectDir, engines, modules, packVersion, deliveryId, completedAt}) → manifest` — batch preflight (TOCTOU + symlink) до мутаций; запись writes; удаление deletes; манифест (`writes ∪ materialized`, `producerPack:'glue'`, `writtenHash=plannedHash`) публикуется последним.
  - Используется `runInit` (Task 9).

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/apply.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyPlan } from '../src/apply.mjs'
import { hashContent } from '../src/hash.mjs'
import { readManifest } from '../src/manifest.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-apply-')) }
const write = (path, content, expectedCurrentHash = null) => ({
  targetPath: path, plannedHash: hashContent(content), content, sourceTemplate: 's.md', kind: 'rule', expectedCurrentHash,
})

test('applyPlan пишет файлы и публикует манифест последним', () => {
  const d = tmp()
  try {
    const m = applyPlan({
      plan: { writes: [write('.claude/rules/a.md', 'A')], materialized: [], deletes: [] },
      projectDir: d, engines: ['claude'], modules: ['a'], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    })
    assert.equal(readFileSync(join(d, '.claude/rules/a.md'), 'utf8'), 'A')
    assert.equal(m.files[0].producerPack, 'glue')
    assert.equal(m.files[0].packVersion, '0.1.0')
    assert.equal(m.files[0].writtenHash, hashContent('A'))
    assert.deepEqual(readManifest(d), m)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('applyPlan включает materialized в манифест без перезаписи', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, '.claude/rules/m.md'), 'M', 'utf8')
    const m = applyPlan({
      plan: { writes: [], materialized: [{ targetPath: '.claude/rules/m.md', plannedHash: hashContent('M'), sourceTemplate: 'm.md', kind: 'rule' }], deletes: [] },
      projectDir: d, engines: ['claude'], modules: ['m'], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    })
    assert.equal(m.files[0].targetPath, '.claude/rules/m.md')
    assert.equal(m.files[0].writtenHash, hashContent('M'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('applyPlan abort на TOCTOU-рассинхрон до любой записи', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, '.claude/rules/a.md'), 'DISK', 'utf8') // на диске не то, что ждал планировщик
    assert.throws(() => applyPlan({
      plan: { writes: [write('.claude/rules/a.md', 'NEW', hashContent('EXPECTED'))], materialized: [], deletes: [] },
      projectDir: d, engines: ['claude'], modules: ['a'], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    }), /TOCTOU abort/)
    assert.equal(readFileSync(join(d, '.claude/rules/a.md'), 'utf8'), 'DISK') // не перезаписан
    assert.equal(existsSync(join(d, '.glue/manifest.json')), false) // манифест не опубликован
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('applyPlan abort если файл появился после планирования (expected null)', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, '.claude/rules/a.md'), 'RACE', 'utf8') // файл появился между plan и apply
    assert.throws(() => applyPlan({
      plan: { writes: [write('.claude/rules/a.md', 'NEW', null)], materialized: [], deletes: [] },
      projectDir: d, engines: ['claude'], modules: ['a'], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    }), /file appeared since planning/)
    assert.equal(readFileSync(join(d, '.claude/rules/a.md'), 'utf8'), 'RACE') // не перезаписан
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('applyPlan abort на symlink в target', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, 'real.txt'), 'R', 'utf8')
    try {
      symlinkSync(join(d, 'real.txt'), join(d, '.claude/rules/a.md'))
    } catch {
      return // среда без прав на symlink — пропускаем
    }
    assert.throws(() => applyPlan({
      plan: { writes: [write('.claude/rules/a.md', 'NEW')], materialized: [], deletes: [] },
      projectDir: d, engines: ['claude'], modules: ['a'], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    }), /symlink/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('applyPlan удаляет файлы из deletes', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, '.claude/rules/old.md'), 'OLD', 'utf8')
    applyPlan({
      plan: { writes: [], materialized: [], deletes: [{ targetPath: '.claude/rules/old.md', expectedCurrentHash: hashContent('OLD') }] },
      projectDir: d, engines: ['claude'], modules: [], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    })
    assert.equal(existsSync(join(d, '.claude/rules/old.md')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/apply.test.mjs`
Expected: FAIL — `Cannot find module '../src/apply.mjs'`.

- [ ] **Step 3: Расширить `bundle.mjs`**

В `plugins/glue/src/bundle.mjs` — экспортировать `PLUGIN_ROOT` и добавить `readPluginVersion`. Изменить строку объявления `PLUGIN_ROOT` на экспорт и дописать функцию в конец файла:

Заменить:
```js
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
```
на:
```js
export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
```

Дописать в конец файла:
```js
// Версия плагина из манифеста — провенанс манифеста доставки (packVersion).
export function readPluginVersion(root = PLUGIN_ROOT) {
  const pj = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
  return pj.version
}
```

- [ ] **Step 4: Реализовать `apply.mjs`**

`plugins/glue/src/apply.mjs`:

```js
import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { hashContent } from './hash.mjs'
import { buildManifest, writeManifest, PRODUCER } from './manifest.mjs'
import { safeTargetPath } from './paths.mjs'

// Проверяет один план-вход до любой мутации: symlink → abort; рассинхрон с тем,
// что видел планировщик, → abort. expectedCurrentHash:
//   null  → планировщик видел отсутствие файла (ожидаем absence);
//   hash  → ожидаем ровно этот контент;
//   undefined → нет ожидания (в плановых entries не используется).
function toctouCheck(projectDir, entry) {
  const target = safeTargetPath(projectDir, entry.targetPath)

  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink()) {
      throw new Error(`abort: symlink at target path: ${entry.targetPath}`)
    }
    // Планировщик видел отсутствие, а файл появился между plan и apply → abort
    // (без молчаливой перезаписи появившегося файла).
    if (entry.expectedCurrentHash === null) {
      throw new Error(`TOCTOU abort: file appeared since planning: ${entry.targetPath}`)
    }
    if (entry.expectedCurrentHash !== undefined) {
      const currentHash = hashContent(readFileSync(target, 'utf8'))
      if (currentHash !== entry.expectedCurrentHash) {
        throw new Error(
          `TOCTOU abort: file changed since planning: ${entry.targetPath} ` +
          `(expected ${entry.expectedCurrentHash}, got ${currentHash})`
        )
      }
    }
  } else {
    // Файл отсутствует. Планировщик ждал конкретный хеш → исчез между plan и apply → abort.
    if (entry.expectedCurrentHash !== null && entry.expectedCurrentHash !== undefined) {
      throw new Error(
        `TOCTOU abort: file absent but hash expected since planning: ${entry.targetPath} ` +
        `(expected ${entry.expectedCurrentHash}, got null)`
      )
    }
  }
}

const toManifestFileEntry = (packVersion) => (entry) => ({
  producerPack: PRODUCER,
  packVersion,
  sourceTemplate: entry.sourceTemplate,
  targetPath: entry.targetPath,
  writtenHash: entry.plannedHash,
})

// Применяет план: preflight (TOCTOU/symlink) → запись/удаление → манифест последним.
export function applyPlan({ plan, projectDir, engines, modules, packVersion, deliveryId, completedAt }) {
  const { writes = [], materialized = [], deletes = [] } = plan

  // Phase 1: batch preflight до любой мутации
  for (const entry of writes) toctouCheck(projectDir, entry)
  for (const entry of deletes) toctouCheck(projectDir, entry)

  // Phase 2: мутации
  for (const entry of writes) {
    const target = safeTargetPath(projectDir, entry.targetPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.content, 'utf8')
  }
  for (const entry of deletes) {
    const target = safeTargetPath(projectDir, entry.targetPath)
    if (existsSync(target)) unlinkSync(target)
  }

  // Phase 3: манифест (writes ∪ materialized)
  const files = [
    ...writes.map(toManifestFileEntry(packVersion)),
    ...materialized.map(toManifestFileEntry(packVersion)),
  ]
  const manifest = buildManifest({ deliveryId, completedAt, engines, modules, files })

  // Phase 4: публикация последней
  writeManifest(projectDir, manifest)
  return manifest
}
```

- [ ] **Step 5: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/apply.test.mjs`
Expected: PASS (6 тестов; symlink-тест может само-пропуститься без прав).

- [ ] **Step 6: Commit**

```powershell
git add plugins/glue/src/bundle.mjs plugins/glue/src/apply.mjs plugins/glue/test/apply.test.mjs
git commit -m "feat(glue): applyPlan (preflight TOCTOU/symlink, atomic manifest) + plugin version reader"
```

---

### Task 9: `init.mjs` — `runInit` оркестратор + интеграция

**Files:**
- Create: `plugins/glue/src/init.mjs`
- Test: `plugins/glue/test/init.test.mjs`

**Interfaces:**
- Consumes: `loadBundle`/`loadContract`/`readPluginVersion`/`PLUGIN_ROOT` (срез 1 + Task 8); `resolveDependencies` (Task 3); `plan`/`KNOWN_ENGINES` (Task 7); `applyPlan` (Task 8).
- Produces: `runInit({selected, engines, projectDir, force, now}) → {manifest|null, conflicts}`.
  - движки: пуст/нет → `['claude']`; иначе как есть, не авто-добавлять claude;
  - валидация `KNOWN_ENGINES` до диска;
  - conflict-gate: `conflicts.length && !force` → `{manifest:null, conflicts}` (диск не тронут);
  - иначе apply → `{manifest, conflicts:[]}`.

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/init.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { runInit } from '../src/init.mjs'
import { loadBundle, loadContract } from '../src/bundle.mjs'
import { hashContent } from '../src/hash.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const registry = loadBundle(PLUGIN_ROOT, loadContract(PLUGIN_ROOT))
function tmp() { return mkdtempSync(join(tmpdir(), 'glue-init-')) }

test('runInit чистый проект → файлы + манифест', () => {
  const d = tmp()
  try {
    const { manifest, conflicts } = runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    assert.equal(conflicts.length, 0)
    assert.ok(existsSync(join(d, '.claude/rules/operator-gate.md')))
    assert.ok(existsSync(join(d, 'CLAUDE.md')))
    assert.equal(manifest.producerPack, undefined) // producerPack на file-entry, не на манифесте
    assert.equal(manifest.engines.length, 1)
    assert.ok(manifest.files.every((f) => f.producerPack === 'glue'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit пустые engines → default claude', () => {
  const d = tmp()
  try {
    const { manifest } = runInit({ selected: ['operator-gate'], engines: [], projectDir: d, force: false, now: 'T' })
    assert.deepEqual(manifest.engines, ['claude'])
    assert.ok(existsSync(join(d, 'CLAUDE.md')))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit явный codex → НЕ добавляет claude', () => {
  const d = tmp()
  try {
    const { manifest } = runInit({ selected: ['operator-gate'], engines: ['codex'], projectDir: d, force: false, now: 'T' })
    assert.deepEqual(manifest.engines, ['codex'])
    assert.ok(existsSync(join(d, 'AGENTS.md')))
    assert.equal(existsSync(join(d, 'CLAUDE.md')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit разрешает зависимости (pr-policy → worktree-workflow)', () => {
  const d = tmp()
  try {
    const { manifest } = runInit({ selected: ['pr-policy'], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    assert.ok(manifest.modules.includes('worktree-workflow'))
    assert.ok(manifest.modules.indexOf('worktree-workflow') < manifest.modules.indexOf('pr-policy'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit неизвестный движок → throw до записи', () => {
  const d = tmp()
  try {
    assert.throws(() => runInit({ selected: ['operator-gate'], engines: ['borg'], projectDir: d, force: false, now: 'T' }), /Unknown engine/)
    assert.equal(existsSync(join(d, 'CLAUDE.md')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit повторный → идемпотентен (без конфликтов)', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T1' })
    const { manifest, conflicts } = runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T2' })
    assert.equal(conflicts.length, 0)
    assert.ok(manifest) // materialized, не конфликт
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit правленный файл → конфликт, без перезаписи и манифеста', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T1' })
    const rule = join(d, '.claude/rules/operator-gate.md')
    writeFileSync(rule, 'РУЧНАЯ ПРАВКА', 'utf8')
    rmSync(join(d, '.glue/manifest.json')) // имитируем потерю манифеста → unmanaged
    const { manifest, conflicts } = runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T2' })
    assert.equal(manifest, null)
    assert.ok(conflicts.some((c) => c.targetPath === '.claude/rules/operator-gate.md'))
    assert.equal(readFileSync(rule, 'utf8'), 'РУЧНАЯ ПРАВКА') // не перезаписан
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit поверх legacy-манифеста (producerPack glue-rules) → не падает, перезаписывает в новый формат', () => {
  const d = tmp()
  try {
    // чистый init создаёт файлы; затем подменяем манифест на legacy-форму (byte-identical файлы остаются)
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T1' })
    const legacy = {
      schemaVersion: '1', deliveryId: 'L', completedAt: 'L', engines: ['claude'], modules: ['operator-gate'], status: 'complete',
      files: [{ producerPack: 'glue-rules', packVersion: '0.2.1', sourceTemplate: 'operator-gate.md', targetPath: '.claude/rules/operator-gate.md', writtenHash: 'STALE' }],
    }
    mkdirSync(join(d, '.glue'), { recursive: true })
    writeFileSync(join(d, '.glue/manifest.json'), JSON.stringify(legacy), 'utf8')
    const { manifest, conflicts } = runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T2' })
    assert.equal(conflicts.length, 0) // byte-identical → materialized, legacy writtenHash проигнорирован
    assert.ok(manifest.files.every((f) => f.producerPack === 'glue'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test plugins/glue/test/init.test.mjs`
Expected: FAIL — `Cannot find module '../src/init.mjs'`.

- [ ] **Step 3: Реализовать `init.mjs`**

`plugins/glue/src/init.mjs`:

```js
import { loadBundle, loadContract, readPluginVersion, PLUGIN_ROOT } from './bundle.mjs'
import { resolveDependencies } from './resolve.mjs'
import { plan, KNOWN_ENGINES } from './plan.mjs'
import { applyPlan } from './apply.mjs'

// Программный оркестратор: resolve → plan → conflict-gate → apply. Не CLI.
export function runInit({ selected, engines, projectDir, force = false, now }) {
  // Движки: пуст/нет → claude; иначе как есть (не авто-добавлять claude).
  const effectiveEngines = engines && engines.length ? engines : ['claude']

  // Валидация движков до любого касания диска.
  for (const engine of effectiveEngines) {
    if (!KNOWN_ENGINES.includes(engine)) {
      throw new Error(`Unknown engine: ${engine}. Known: ${KNOWN_ENGINES.join(', ')}`)
    }
  }

  const contract = loadContract(PLUGIN_ROOT)
  const registry = loadBundle(PLUGIN_ROOT, contract)
  const resolvedIds = resolveDependencies(registry, selected)

  const planResult = plan({
    registry,
    modules: resolvedIds,
    engines: effectiveEngines,
    contract,
    pluginRoot: PLUGIN_ROOT,
    projectDir,
    force,
  })

  // Conflict-gate: при конфликтах без force диск не тронут (мутаций ещё не было).
  if (planResult.conflicts.length > 0 && !force) {
    return { manifest: null, conflicts: planResult.conflicts }
  }

  const manifest = applyPlan({
    plan: planResult,
    projectDir,
    engines: planResult.deliveredEngines,
    modules: resolvedIds,
    packVersion: readPluginVersion(PLUGIN_ROOT),
    deliveryId: now,
    completedAt: now,
  })

  return { manifest, conflicts: [] }
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node --test plugins/glue/test/init.test.mjs`
Expected: PASS (8 тестов).

- [ ] **Step 5: Прогнать весь набор плагина (glob-форма)**

Run: `node --test "plugins/glue/test/*.test.mjs"`
Expected: PASS — все тесты (срез 1 + срез 2: hash/paths/resolve/blocks/manifest/decide/plan/apply/init), `fail 0`.

- [ ] **Step 6: Commit**

```powershell
git add plugins/glue/src/init.mjs plugins/glue/test/init.test.mjs
git commit -m "feat(glue): runInit orchestrator (resolve → plan → gate → apply)"
```

> **Конец PR B.** Перед push — simplify pass (`pr-policy`). PR создаётся/мёржится по operator-gate.

---

## Self-Review

**Spec coverage (slice2-design):**
- § Скоуп (8 модулей) — Task 1-9 ✓ (`hash`/`paths`/`resolve`/`blocks`/`manifest`/`plan`/`apply`/`init` + `bundle` mod).
- § API `buildTargets`/`decidePlan`/`plan`/`runInit` — Task 6-9 ✓ (сигнатуры совпадают с § API).
- § Провенанс (константа `glue`, `packVersion` из plugin.json, `engines=deliveredEngines`, `modules=resolvedIds`) — Task 8 (`apply`) + Task 9 (`runInit`) ✓.
- § prevManifest-гейт (`readManifest` raw + `isUsablePrevManifest`) — Task 5 + Task 7 (`plan`) ✓; legacy-тест — Task 9 ✓.
- § Сохранённые инварианты (конфликт, TOCTOU, symlink, manifest-last, target path-safety, resolve, мультидвижок) — Task 6 (конфликт), Task 8 (TOCTOU/symlink/last), Task 2 (path-safety), Task 3 (resolve), Task 7 (blocks) ✓.
- § Снятые инварианты (нет discovery/merge/safeSourcePath/авто-claude/silent-skip) — `plan.mjs` без discovery; `paths.mjs` без `safeSourcePath`; `runInit` без авто-claude; `buildTargets` throw на missing `.tmpl` ✓.
- § Тесты (все перечисленные классы) — покрыты Task 1-9 ✓.
- § Разбивка PR A/B — § PR Boundaries ✓.

**Placeholder scan:** плейсхолдеров нет; весь код приведён полностью; команды и ожидаемый вывод явны.

**Type consistency:**
- `decidePlan` writes/materialized/deletes-формы (Task 6) совпадают с тем, что мапит `applyPlan` (Task 8: `sourceTemplate`/`plannedHash`/`targetPath`) и что строит `buildTargets` (Task 7: `targetPath/plannedHash/content/sourceTemplate/kind`).
- `plan` возвращает `{writes, materialized, deletes, conflicts, deliveredEngines}` (Task 7) — `runInit` (Task 9) читает `.conflicts`/`.deliveredEngines` и передаёт весь объект в `applyPlan`.
- `applyPlan` сигнатура (Task 8) совпадает с вызовом в `runInit` (Task 9): `{plan, projectDir, engines, modules, packVersion, deliveryId, completedAt}`.
- `KNOWN_ENGINES` экспортируется из `plan.mjs` (Task 7), импортируется `runInit` (Task 9).
- `PLUGIN_ROOT`/`readPluginVersion` экспортируются из `bundle.mjs` (Task 8), импортируются `init.mjs` (Task 9) и тестами `plan`/`init`.
- `PRODUCER`/`isUsablePrevManifest`/`readManifest` из `manifest.mjs` (Task 5) — потребляются `plan.mjs` (Task 7) и `apply.mjs` (Task 8).

**File-cap check:** PR A = 10 файлов (≤15) ✓; PR B = 8 файлов (`plan.mjs`, `apply.mjs`, `init.mjs`, `bundle.mjs` mod, `decide.test`, `plan.test`, `apply.test`, `init.test`; ≤15) ✓.

**TOCTOU контракт:** `expectedCurrentHash: null` ⇒ ожидаем отсутствие; файл, появившийся между `plan` и `apply`, → abort (Task 8, тест «файл появился после планирования»). `decidePlan` выдаёт `null` только для target'ов, увиденных отсутствующими, поэтому нормальный поток `runInit` (один процесс) не триггерит abort.

**Shell check:** все команды — PowerShell/`node --test`; полный прогон — glob-форма (directory-форма на Node 24 падает, проверено).
