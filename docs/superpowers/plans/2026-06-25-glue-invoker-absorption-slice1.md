# Glue ← invoker — срез 1 (раскладка правил) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Glue получает нативную раскладку правил (`glue init`): механизм invoker переносится в `glue-core`, контент (10 модулей) — в `glue-rules`; инъекция тела правил снимается через условный хук без окна потери доставки.

**Architecture:** `glue-core` владеет механизмом раскладки (`resolve`/`blocks` перенос + `registry`/`planner`/`writer` под Glue), читает контент-паки через декларативный контракт (данные, не код). `glue-rules` владеет контентом (реестр модулей + шаблоны правил + инструкц-шаблоны). Файлы — источник истины; манифест доставки фиксирует фактический результат записи. Два PR: `glue-rules` первым (контракт+контент, fallback-инъекция 0.1.1 жива), `glue-core` вторым (механизм + `glue init` + снятие инъекции).

**Tech Stack:** Node.js ESM (`.mjs`), без внешних зависимостей. Тесты — `node --test` (встроенный `node:test`). Платформа Windows (пути через `node:path`, нормализация). Claude Code плагины, маркетплейс `glue`, доставка через git-теги `{plugin}--v{version}`.

## Global Constraints

- **Node без внешних зависимостей** — только `node:*` встроенные модули.
- **Источник invoker для переноса:** `C:\Users\T590\.claude\plugins\cache\real-tools-skills\invoker\0.2.3\` (`skills/invoke/lib/*.mjs`, `modules.json`, `templates/`).
- **Файлы — источник истины**, манифест — производное; граф (срез 4) не строим.
- **10 модулей**, БЕЗ `retro-loop` (срез 3): operator-gate, secret-hygiene, worktree-workflow, pr-policy, review-loop, subagent-dispatch, safety, architectural-invariants, versioning, glossary.
- **Каждый промежуточный HEAD сохраняет доставку правил** (инвариант: никогда не выключены одновременно fallback и нативная доставка).
- **Плагины — только через git worktree + PR** (`.claude/rules/worktree-workflow.md`, `pr-policy.md`). Ветки `feat-<slug>` от `main`.
- **Версии:** `glue-rules` → `0.2.0` (новый контракт+контент), `glue-core` → `0.2.0` (механизм). Теги `{plugin}--v{version}` на пост-merge HEAD.
- **Манифест доставки** `.glue/manifest.json`: заголовок (`schemaVersion`, `deliveryId`, `completedAt`, `engines`, `modules`, `status`) + `files[]` (`producerPack`, `packVersion`, `sourceTemplate`, `targetPath`, `writtenHash`). Публикуется атомарно последним.

---

# PR1 — `glue-rules`: декларативный контракт пака + 10 модулей

**Ветка:** `feat-rules-content-pack`. Реализуется первым. `glue-core` ещё старый (0.1.1) → его SessionStart-хук продолжает инъекцию тела правил (fallback жив, доставка не прерывается).

## Контракт пака (декларативный)

Пак объявляет контракт в файле `glue.contract.json` в корне пака:

```json
{
  "contractVersion": "1",
  "registry": "rules/registry.json",
  "templatesDir": "rules/templates",
  "instructionsDir": "rules/instructions"
}
```

`glue-core` читает этот файл (данные), резолвит относительные пути от корня пака, читает реестр и шаблоны как **данные** — без импорта кода пака.

## Реестр модулей пака — Glue-схема

`rules/registry.json` — перенос invoker `modules.json` БЕЗ `retro-loop`, расширенный Glue-полями. Схема записи модуля:

```json
{
  "operator-gate": {
    "title": "Operator gate",
    "group": "base-discipline",
    "default": true,
    "templates": ["operator-gate.md"],
    "instructionBlock": "operator-gate",
    "dependsOn": [],
    "note": "..."
  }
}
```

Отличия от invoker: `files` → `templates` (имена шаблонов относительно `templatesDir`); добавлено `instructionBlock` (id блока `<!-- module:id -->` в инструкц-шаблонах); `depends_on` → `dependsOn` (camelCase Glue-конвенция).

---

### Task 1.1: Структура пака + контракт + реестр

**Files:**
- Create: `plugins/glue-rules/glue.contract.json`
- Create: `plugins/glue-rules/rules/registry.json`
- Modify: `plugins/glue-rules/.claude-plugin/plugin.json` (bump `0.1.0` → `0.2.0`)
- Test: `plugins/glue-rules/test/registry.test.mjs`

**Interfaces:**
- Produces: `glue.contract.json` (`contractVersion`, `registry`, `templatesDir`, `instructionsDir`); `rules/registry.json` (10 модулей, схема выше). PR2 `registry`-loader потребляет их.

- [ ] **Step 1: Написать падающий тест валидности реестра**

`plugins/glue-rules/test/registry.test.mjs`:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED = [
  'operator-gate', 'secret-hygiene', 'worktree-workflow', 'pr-policy',
  'review-loop', 'subagent-dispatch', 'safety', 'architectural-invariants',
  'versioning', 'glossary',
]

test('registry has exactly the 10 slice-1 modules, no retro-loop', () => {
  const reg = JSON.parse(readFileSync(join(PACK, 'rules', 'registry.json'), 'utf8'))
  assert.deepEqual(Object.keys(reg).sort(), [...EXPECTED].sort())
  assert.ok(!('retro-loop' in reg), 'retro-loop must be deferred to slice 3')
})

test('every module declares required fields and valid dependsOn', () => {
  const reg = JSON.parse(readFileSync(join(PACK, 'rules', 'registry.json'), 'utf8'))
  const ids = Object.keys(reg)
  for (const [id, m] of Object.entries(reg)) {
    assert.equal(typeof m.title, 'string')
    assert.ok(Array.isArray(m.templates) && m.templates.length > 0, `${id}.templates`)
    assert.equal(typeof m.instructionBlock, 'string')
    assert.ok(Array.isArray(m.dependsOn), `${id}.dependsOn`)
    for (const dep of m.dependsOn) assert.ok(ids.includes(dep), `${id} dep ${dep}`)
  }
})

test('contract points to existing registry/template dirs', () => {
  const c = JSON.parse(readFileSync(join(PACK, 'glue.contract.json'), 'utf8'))
  assert.equal(c.contractVersion, '1')
  assert.ok(readFileSync(join(PACK, c.registry))) // не бросает
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test plugins/glue-rules/test/registry.test.mjs`
Expected: FAIL (нет `glue.contract.json` / `rules/registry.json`).

- [ ] **Step 3: Создать `glue.contract.json`**

```json
{
  "contractVersion": "1",
  "registry": "rules/registry.json",
  "templatesDir": "rules/templates",
  "instructionsDir": "rules/instructions"
}
```

- [ ] **Step 4: Создать `rules/registry.json`**

Перенос invoker `modules.json` без `retro-loop`, поля по Glue-схеме. Для каждого из 10 модулей: `title`/`group`/`default`/`note` — дословно из invoker `modules.json`; `templates: ["<id>.md"]`; `instructionBlock: "<id>"`; `dependsOn` — из invoker `depends_on` (`pr-policy`→`["worktree-workflow"]`, `review-loop`→`["pr-policy"]`, остальные `[]`).

- [ ] **Step 5: Bump версии пака**

`plugins/glue-rules/.claude-plugin/plugin.json`: `"version": "0.2.0"`, описание — «П1 контент-пак: декларативный контракт + 10 модулей-правил (раскладка через glue init)».

- [ ] **Step 6: Запустить тест — PASS**

Run: `node --test plugins/glue-rules/test/registry.test.mjs`
Expected: PASS (3 теста).

- [ ] **Step 7: Commit**

```bash
git add plugins/glue-rules/glue.contract.json plugins/glue-rules/rules/registry.json plugins/glue-rules/.claude-plugin/plugin.json plugins/glue-rules/test/registry.test.mjs
git commit -m "feat(glue-rules): declarative pack contract + 10-module registry"
```

---

### Task 1.2: Перенос 10 шаблонов правил + аудит `.invoker/`

**Files:**
- Create: `plugins/glue-rules/rules/templates/<id>.md` (×10)
- Keep (НЕ удалять): `plugins/glue-rules/rules/commit-discipline.md`, `plugins/glue-rules/rules/secret-hygiene.md`
- Test: `plugins/glue-rules/test/templates.test.mjs`

**Fallback-совместимость (дефект-фикс):** старый `glue-core` 0.1.1 читает `rules/*.md` **нерекурсивно** (верхний уровень). Если PR1 удалит эти файлы, fallback-инъекция найдёт ноль правил до выхода PR2 — окно потери. Поэтому PR1 **оставляет** `rules/commit-discipline.md` и `rules/secret-hygiene.md` на верхнем уровне (старый core продолжает их инжектить), а новые 10 модулей кладёт в подкаталог `rules/templates/` (нерекурсивный fallback их не видит — дублирования в инъекции нет). Legacy-файлы удаляются **отдельной задачей в PR2** (Task 2.10), уже после переключения хука на нативную доставку.

**Interfaces:**
- Produces: 10 файлов-шаблонов правил в `rules/templates/`, имена совпадают с `registry[id].templates`.

**Аудит `.invoker/` (результат разведки):** из 10 модулей только `review-loop.md:31` ссылается на retro-инфру (`ideas_4_rules.md`, `retro-*.md` как примеры gitignored-файлов). Остальные 9 — чисты. `review-loop.md` переносится с переформулировкой этой строки (обобщить до «gitignored / local-only файлы (например, `.claude/settings.local.json`, `.env*`)» — без `ideas_4_rules.md`/`retro-*.md`, т.к. их инфра — срез 3).

- [ ] **Step 1: Написать падающий тест шаблонов**

`plugins/glue-rules/test/templates.test.mjs`:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..')

test('each registry module has its template file present', () => {
  const reg = JSON.parse(readFileSync(join(PACK, 'rules', 'registry.json'), 'utf8'))
  const tdir = JSON.parse(readFileSync(join(PACK, 'glue.contract.json'), 'utf8')).templatesDir
  for (const [id, m] of Object.entries(reg)) {
    for (const t of m.templates) {
      assert.ok(existsSync(join(PACK, tdir, t)), `missing template ${t} for ${id}`)
    }
  }
})

test('no .invoker/ or retro-infra references survive in slice-1 templates', () => {
  const tdir = join(PACK, 'rules', 'templates')
  const reg = JSON.parse(readFileSync(join(PACK, 'rules', 'registry.json'), 'utf8'))
  for (const m of Object.values(reg)) {
    for (const t of m.templates) {
      const text = readFileSync(join(tdir, t), 'utf8')
      assert.ok(!/\.invoker\//.test(text), `${t} references .invoker/`)
      assert.ok(!/ideas_4_rules|retro-\*/.test(text), `${t} references retro infra`)
    }
  }
})
```

- [ ] **Step 2: Запустить — FAIL**

Run: `node --test plugins/glue-rules/test/templates.test.mjs`
Expected: FAIL (шаблонов нет).

- [ ] **Step 3: Скопировать 9 чистых шаблонов дословно**

Из `<invoker>/templates/rules/` в `plugins/glue-rules/rules/templates/`: operator-gate, secret-hygiene, worktree-workflow, pr-policy, subagent-dispatch, safety, architectural-invariants, versioning, glossary (`.md`). Содержимое побайтово.

- [ ] **Step 4: Перенести `review-loop.md` с переформулировкой**

Скопировать `review-loop.md`; в строке про reader-accessibility заменить
`gitignored / local-only файлы (`ideas_4_rules.md`, `retro-*.md`, `.claude/settings.local.json`, `.env*`)`
на
`gitignored / local-only файлы (например, `.claude/settings.local.json`, `.env*`)`.

- [ ] **Step 5: Дописать дословный тест fallback-совместимости**

В `templates.test.mjs` добавить:
```javascript
import { existsSync as exists2 } from 'node:fs'
test('fallback layer preserved for old core 0.1.1 (top-level rules/*.md kept)', () => {
  // старый core читает rules/ нерекурсивно; эти файлы должны остаться до PR2 cutover
  assert.ok(exists2(join(PACK, 'rules', 'commit-discipline.md')), 'commit-discipline kept')
  assert.ok(exists2(join(PACK, 'rules', 'secret-hygiene.md')), 'secret-hygiene kept')
  // новые модули — в подкаталоге, нерекурсивный fallback их не подхватит (нет дубля)
  assert.ok(exists2(join(PACK, 'rules', 'templates', 'operator-gate.md')))
})
```
(Старые `rules/commit-discipline.md`/`secret-hygiene.md` НЕ удаляются — оставлены для fallback. Полноценный secret-hygiene-модуль живёт отдельно в `rules/templates/secret-hygiene.md`.)

- [ ] **Step 6: Запустить — PASS**

Run: `node --test plugins/glue-rules/test/templates.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/glue-rules/rules/templates plugins/glue-rules/test/templates.test.mjs
git commit -m "feat(glue-rules): port 10 rule templates (.invoker audit: review-loop reworded)"
```

---

### Task 1.3: Инструкц-шаблоны (CLAUDE/AGENTS/GEMINI) с module-блоками

**Files:**
- Create: `plugins/glue-rules/rules/instructions/CLAUDE.md.tmpl`, `AGENTS.md.tmpl`, `GEMINI.md.tmpl`
- Test: `plugins/glue-rules/test/instructions.test.mjs`

**Interfaces:**
- Produces: 3 инструкц-шаблона с блоками `<!-- module:<id> --> ... <!-- /module -->` для каждого из 10 модулей. PR2 `blocks`-фильтр их потребляет.

- [ ] **Step 1: Падающий тест — все 10 блоков присутствуют, retro-loop отсутствует**

`plugins/glue-rules/test/instructions.test.mjs`:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..')
const OPEN = /<!--\s*module:([\w-]+)\s*-->/g

test('each instruction template carries blocks for all 10 modules and no retro-loop', () => {
  const reg = JSON.parse(readFileSync(join(PACK, 'rules', 'registry.json'), 'utf8'))
  const want = new Set(Object.values(reg).map((m) => m.instructionBlock))
  for (const f of ['CLAUDE.md.tmpl', 'AGENTS.md.tmpl', 'GEMINI.md.tmpl']) {
    const text = readFileSync(join(PACK, 'rules', 'instructions', f), 'utf8')
    const ids = new Set([...text.matchAll(OPEN)].map((m) => m[1]))
    for (const id of want) assert.ok(ids.has(id), `${f} missing block ${id}`)
    assert.ok(!ids.has('retro-loop'), `${f} must not carry retro-loop`)
  }
})
```

- [ ] **Step 2: Запустить — FAIL**

Run: `node --test plugins/glue-rules/test/instructions.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Перенести 3 инструкц-шаблона из invoker, удалив retro-loop блок**

Скопировать `<invoker>/templates/instructions/{CLAUDE,AGENTS,GEMINI}.md.tmpl`. В каждом удалить блок `<!-- module:retro-loop --> ... <!-- /module -->` целиком (модуль отложен). Прочие 10 блоков — как есть.

- [ ] **Step 4: Запустить — PASS**

Run: `node --test plugins/glue-rules/test/instructions.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/glue-rules/rules/instructions plugins/glue-rules/test/instructions.test.mjs
git commit -m "feat(glue-rules): instruction templates (CLAUDE/AGENTS/GEMINI), retro-loop block dropped"
```

---

### Task 1.4: Marketplace-описание + PR1 finalize

**Files:**
- Modify: `.claude-plugin/marketplace.json` (описание `glue-rules`)

- [ ] **Step 1: Обновить описание `glue-rules` в marketplace.json**

Заменить описание на «П1 контент-пак: декларативный контракт + 10 модулей-правил для раскладки через `glue init`».

- [ ] **Step 2: Прогнать все тесты пака**

Run: `node --test plugins/glue-rules/test/`
Expected: PASS (registry, templates, instructions).

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "docs(glue-rules): marketplace description for 0.2.0 contract pack"
```

**После merge PR1:** тег `glue-rules--v0.2.0` на пост-merge HEAD + push. `glue-core` 0.1.1 не тронут — fallback-инъекция жива. **Доставка не прервана.**

---

# PR2 — `glue-core`: механизм раскладки + `glue init` + условный хук

**Ветка:** `feat-glue-init`. Реализуется ПОСЛЕ merge PR1 и тега `glue-rules--v0.2.0` (PR2 резолвит контракт пака; контент должен быть доступен в origin).

**Зависимость PR2 → PR1 (акцент 1):** PR2 читает `glue.contract.json` + реестр из установленного `glue-rules` пака. Для разработки/тестов PR2 использует **фикстуру-пак** (не зависит от установки). Для реального прогона — `glue-rules@glue` версии `>=0.2.0` должен быть установлен. Интеграционный тест PR2 ставит локальный маркетплейс из worktree (как golden-прогон) и проверяет на реальном `glue-rules`.

## Файловая структура `glue-core` (новая)

```
plugins/glue-core/lib/
  resolve.mjs      # перенос дословно
  blocks.mjs       # перенос дословно
  registry.mjs     # Glue-схема: чтение контракта пака + реестра
  paths.mjs        # path-safety: валидация source/target
  planner.mjs      # план раскладки + конфликты + удаление + module-identity
  writer.mjs       # TOCTOU re-verify + запись + атомарный манифест
  discovery.mjs    # найти glue-* паки из installed_plugins.json, прочитать контракты
  manifest.mjs     # схема/чтение/запись манифеста доставки
  hash.mjs         # хеш содержимого (sha256)
  init.mjs         # склейка: glue init
plugins/glue-core/bin/glue.mjs   # CLI dispatch (init + session-start hook)
plugins/glue-core/test/*.test.mjs
plugins/glue-core/test/fixtures/  # фикстура-пак для тестов
```

---

### Task 2.1: Перенос `resolve` + `blocks` дословно с тестами

**Files:**
- Create: `plugins/glue-core/lib/resolve.mjs`, `plugins/glue-core/lib/blocks.mjs`
- Test: `plugins/glue-core/test/resolve.test.mjs`, `plugins/glue-core/test/blocks.test.mjs`

**Interfaces:**
- Produces: `resolveDependencies(registry, selected) → string[]` (топопорядок); `filterModuleBlocks(text, keepIds) → string`; `listModuleBlockIds(text) → Set`.

- [ ] **Step 1: Тесты resolve (перенос invoker + Glue-кейсы)**

`plugins/glue-core/test/resolve.test.mjs`:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDependencies } from '../lib/resolve.mjs'

const reg = {
  'worktree-workflow': { dependsOn: [] },
  'pr-policy': { dependsOn: ['worktree-workflow'] },
  'review-loop': { dependsOn: ['pr-policy'] },
}

test('pulls deps in topological order', () => {
  assert.deepEqual(resolveDependencies(reg, ['review-loop']),
    ['worktree-workflow', 'pr-policy', 'review-loop'])
})
test('throws on unknown module', () => {
  assert.throws(() => resolveDependencies(reg, ['nope']), /Unknown module/)
})
test('throws on cycle', () => {
  const c = { a: { dependsOn: ['b'] }, b: { dependsOn: ['a'] } }
  assert.throws(() => resolveDependencies(c, ['a']), /cycle/)
})
```

- [ ] **Step 2: Запустить — FAIL** (`node --test plugins/glue-core/test/resolve.test.mjs`)

- [ ] **Step 3: Перенести `resolve.mjs`**

Скопировать invoker `lib/resolve.mjs` дословно, заменив `depends_on` → `dependsOn` (строки 17: `registry[id].dependsOn ?? []`).

- [ ] **Step 4: Запустить — PASS**

- [ ] **Step 5: Тесты blocks + перенос `blocks.mjs` дословно** (invoker `lib/blocks.mjs` без изменений). Тест:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterModuleBlocks } from '../lib/blocks.mjs'

test('keeps selected block, drops others, strips markers', () => {
  const t = 'A\n<!-- module:x -->\nX\n<!-- /module -->\n<!-- module:y -->\nY\n<!-- /module -->\nB'
  assert.equal(filterModuleBlocks(t, ['x']), 'A\nX\n\nB')
})
test('throws on nested block', () => {
  assert.throws(() => filterModuleBlocks('<!-- module:a -->\n<!-- module:b -->', ['a']), /nested/)
})
```

- [ ] **Step 6: Запустить оба — PASS**

Run: `node --test plugins/glue-core/test/resolve.test.mjs plugins/glue-core/test/blocks.test.mjs`

- [ ] **Step 7: Commit**

```bash
git add plugins/glue-core/lib/resolve.mjs plugins/glue-core/lib/blocks.mjs plugins/glue-core/test/resolve.test.mjs plugins/glue-core/test/blocks.test.mjs
git commit -m "feat(glue-core): port resolve + blocks from invoker with tests"
```

---

### Task 2.2: `hash` + `paths` (path-safety)

**Files:**
- Create: `plugins/glue-core/lib/hash.mjs`, `plugins/glue-core/lib/paths.mjs`
- Test: `plugins/glue-core/test/paths.test.mjs`

**Interfaces:**
- Produces: `hashContent(buf|string) → string` (sha256 hex); `safeSourcePath(packRoot, rel) → string` (throws при escape); `safeTargetPath(projectDir, rel) → string` (throws при escape за разрешённую зону).

- [ ] **Step 1: Тест path-safety (акцент 2)**

`plugins/glue-core/test/paths.test.mjs`:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeSourcePath, safeTargetPath } from '../lib/paths.mjs'

const PACK = '/packs/glue-rules'
const PROJ = '/proj'

test('source within pack ok', () => {
  assert.equal(safeSourcePath(PACK, 'rules/templates/x.md'),
    '/packs/glue-rules/rules/templates/x.md'.replaceAll('/', require('node:path').sep))
})
test('source .. escape rejected', () => {
  assert.throws(() => safeSourcePath(PACK, '../other/x.md'), /escape/)
})
test('source absolute rejected', () => {
  assert.throws(() => safeSourcePath(PACK, '/etc/passwd'), /absolute|escape/)
})
test('target within allowed zone ok', () => {
  assert.ok(safeTargetPath(PROJ, '.claude/rules/x.md'))
  assert.ok(safeTargetPath(PROJ, 'CLAUDE.md'))
  assert.ok(safeTargetPath(PROJ, '.glue/manifest.json'))
})
test('target outside zone rejected', () => {
  assert.throws(() => safeTargetPath(PROJ, 'src/evil.js'), /zone/)
})
test('target .. escape rejected', () => {
  assert.throws(() => safeTargetPath(PROJ, '../outside.md'), /escape|zone/)
})
```

- [ ] **Step 2: Запустить — FAIL**

- [ ] **Step 3: Реализовать `hash.mjs`**

```javascript
import { createHash } from 'node:crypto'
export function hashContent(data) {
  return createHash('sha256').update(data).digest('hex')
}
```

- [ ] **Step 4: Реализовать `paths.mjs`**

```javascript
import { resolve, relative, isAbsolute, sep } from 'node:path'

// source должен оставаться внутри корня пака после нормализации.
export function safeSourcePath(packRoot, rel) {
  if (isAbsolute(rel)) throw new Error(`source must be relative: ${rel}`)
  const abs = resolve(packRoot, rel)
  const r = relative(packRoot, abs)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error(`source escapes pack root: ${rel}`)
  return abs
}

// разрешённые целевые зоны проекта (префиксы относительного пути).
const TARGET_ZONES = ['.claude' + sep, '.glue' + sep, 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md']
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
(Symlink-escape: writer дополнительно проверяет `lstatSync(target).isSymbolicLink()` → отклоняет; см. Task 2.5.)

- [ ] **Step 5: Запустить — PASS** (поправить ожидания путей под `sep`, если Windows)

- [ ] **Step 6: Commit**

```bash
git add plugins/glue-core/lib/hash.mjs plugins/glue-core/lib/paths.mjs plugins/glue-core/test/paths.test.mjs
git commit -m "feat(glue-core): hash + path-safety (source/target zone validation)"
```

---

### Task 2.3: `registry` (Glue-схема) + `discovery` (паки из реестра)

**Files:**
- Create: `plugins/glue-core/lib/registry.mjs`, `plugins/glue-core/lib/discovery.mjs`
- Test: `plugins/glue-core/test/registry.test.mjs`, `plugins/glue-core/test/discovery.test.mjs`
- Create: `plugins/glue-core/test/fixtures/pack-a/` (фикстура-пак: `glue.contract.json` + `rules/registry.json` + 2 шаблона + 1 инструкц-шаблон)

**Interfaces:**
- Produces: `loadPackContract(packRoot) → {contractVersion, registry, templatesDir, instructionsDir}`; `loadPackRegistry(packRoot, contract) → registry`; `validatePackRegistry(registry) → registry` (throws); `discoverPacks(registryJsonPath) → [{name, version, root, contract, registry}]`; module-identity: коллизия ID между паками → throw (fail-fast, акцент 2).

- [ ] **Step 1: Тесты registry + module-identity**

`plugins/glue-core/test/registry.test.mjs`:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPackContract, loadPackRegistry, validatePackRegistry } from '../lib/registry.mjs'
import { mergePackRegistries } from '../lib/discovery.mjs'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pack-a')

test('loads contract and registry', () => {
  const c = loadPackContract(FIX)
  assert.equal(c.contractVersion, '1')
  const reg = loadPackRegistry(FIX, c)
  assert.ok(Object.keys(reg).length >= 1)
})
test('validate rejects missing title', () => {
  assert.throws(() => validatePackRegistry({ x: { dependsOn: [] } }), /title/)
})
test('cross-pack id collision fails fast', () => {
  const p1 = { name: 'p1', registry: { dup: { title: 'A', dependsOn: [] } } }
  const p2 = { name: 'p2', registry: { dup: { title: 'B', dependsOn: [] } } }
  assert.throws(() => mergePackRegistries([p1, p2]), /collision|dup/)
})
test('cross-pack dependsOn is rejected (within-pack only)', () => {
  const p1 = { name: 'p1', registry: { a: { title: 'A', dependsOn: ['b'] } } }
  const p2 = { name: 'p2', registry: { b: { title: 'B', dependsOn: [] } } }
  assert.throws(() => mergePackRegistries([p1, p2]), /cross-pack|within-pack|unknown/)
})
```

- [ ] **Step 2: Создать фикстуру `test/fixtures/pack-a/`**

`glue.contract.json` (как в PR1); `rules/registry.json` с 2 модулями (`alpha` без зависимостей, `beta` зависит от `alpha`); `rules/templates/alpha.md`, `beta.md` (с frontmatter); `rules/instructions/CLAUDE.md.tmpl` с блоками `alpha`/`beta`.

- [ ] **Step 3: Запустить — FAIL**

- [ ] **Step 4: Реализовать `registry.mjs`**

```javascript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadPackContract(packRoot) {
  return JSON.parse(readFileSync(join(packRoot, 'glue.contract.json'), 'utf8'))
}
export function loadPackRegistry(packRoot, contract) {
  return validatePackRegistry(JSON.parse(readFileSync(join(packRoot, contract.registry), 'utf8')))
}
export function validatePackRegistry(registry) {
  const ids = Object.keys(registry)
  const errors = []
  for (const [id, m] of Object.entries(registry)) {
    if (typeof m?.title !== 'string' || !m.title) errors.push(`${id}: title`)
    if (!Array.isArray(m?.templates) || m.templates.length === 0) errors.push(`${id}: templates`)
    if (typeof m?.instructionBlock !== 'string') errors.push(`${id}: instructionBlock`)
    if (!Array.isArray(m?.dependsOn)) errors.push(`${id}: dependsOn`)
    for (const dep of m?.dependsOn ?? []) {
      if (!ids.includes(dep)) errors.push(`${id}: dependsOn references unknown '${dep}' (within-pack only)`)
    }
  }
  if (errors.length) throw new Error('Invalid pack registry:\n' + errors.join('\n'))
  return registry
}
```
(Заметь: `dependsOn` валидируется в пределах одного пака — межпаковая зависимость даёт «unknown», что и есть запрет.)

- [ ] **Step 5: Реализовать `discovery.mjs`**

```javascript
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadPackContract, loadPackRegistry } from './registry.mjs'

const HOME = process.env.HOME || process.env.USERPROFILE || homedir()
const REGISTRY = join(HOME, '.claude', 'plugins', 'installed_plugins.json')

// Находит установленные glue-* контент-паки (кроме glue-core) с валидным контрактом.
export function discoverPacks(registryPath = REGISTRY) {
  if (!existsSync(registryPath)) return []
  const reg = JSON.parse(readFileSync(registryPath, 'utf8'))
  const out = []
  for (const [key, installs] of Object.entries(reg.plugins ?? {})) {
    const name = key.split('@')[0]
    if (!name.startsWith('glue-') || name === 'glue-core') continue
    const usable = (Array.isArray(installs) ? installs : [])
      .filter((i) => i?.installPath && existsSync(join(i.installPath, 'glue.contract.json')))
      .sort((a, b) => String(b.lastUpdated || '').localeCompare(String(a.lastUpdated || '')))
    if (!usable.length) continue
    const root = usable[0].installPath
    const contract = loadPackContract(root)
    out.push({ name, version: usable[0].version, root, contract, registry: loadPackRegistry(root, contract) })
  }
  return out
}

// Сливает реестры паков; коллизия module ID между паками → fail-fast.
export function mergePackRegistries(packs) {
  const merged = {}
  const owner = {}
  for (const p of packs) {
    for (const [id, m] of Object.entries(p.registry)) {
      if (id in merged) throw new Error(`module id collision: '${id}' in ${owner[id]} and ${p.name}`)
      merged[id] = m
      owner[id] = p.name
    }
  }
  return { merged, owner }
}
```

- [ ] **Step 6: Запустить оба — PASS**

- [ ] **Step 7: Commit**

```bash
git add plugins/glue-core/lib/registry.mjs plugins/glue-core/lib/discovery.mjs plugins/glue-core/test/registry.test.mjs plugins/glue-core/test/discovery.test.mjs plugins/glue-core/test/fixtures
git commit -m "feat(glue-core): pack contract/registry loader + discovery + module-identity fail-fast"
```

---

### Task 2.4: `manifest` (схема, чтение, запись)

**Files:**
- Create: `plugins/glue-core/lib/manifest.mjs`
- Test: `plugins/glue-core/test/manifest.test.mjs`

**Interfaces:**
- Produces: `readManifest(projectDir) → manifest|null`; `buildManifest({deliveryId, completedAt, engines, modules, files}) → manifest` (status `complete`); `writeManifest(projectDir, manifest)` (атомарная запись последним). Запись файла: `{producerPack, packVersion, sourceTemplate, targetPath, writtenHash}`.

- [ ] **Step 1: Тест манифеста**
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildManifest, writeManifest, readManifest } from '../lib/manifest.mjs'

test('build sets status complete and roundtrips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  const m = buildManifest({
    deliveryId: 'd1', completedAt: '2026-06-25T00:00:00Z', engines: ['claude'],
    modules: ['operator-gate'],
    files: [{ producerPack: 'glue-rules', packVersion: '0.2.0', sourceTemplate: 'operator-gate.md', targetPath: '.claude/rules/operator-gate.md', writtenHash: 'abc' }],
  })
  assert.equal(m.status, 'complete')
  writeManifest(dir, m)
  assert.deepEqual(readManifest(dir), m)
})
test('readManifest returns null when absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  assert.equal(readManifest(dir), null)
})
```

- [ ] **Step 2: Запустить — FAIL**

- [ ] **Step 3: Реализовать `manifest.mjs`**

```javascript
import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SCHEMA_VERSION = '1'
const rel = (d) => join(d, '.glue', 'manifest.json')

export function buildManifest({ deliveryId, completedAt, engines, modules, files }) {
  return { schemaVersion: SCHEMA_VERSION, deliveryId, completedAt, engines, modules, status: 'complete', files }
}
export function readManifest(projectDir) {
  const p = rel(projectDir)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}
// Атомарно: пишем во временный + rename (последним, после всех файлов).
export function writeManifest(projectDir, manifest) {
  mkdirSync(join(projectDir, '.glue'), { recursive: true })
  const p = rel(projectDir)
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  renameSync(tmp, p)
}
export { SCHEMA_VERSION }
```

- [ ] **Step 4: Запустить — PASS**

- [ ] **Step 5: Commit**

```bash
git add plugins/glue-core/lib/manifest.mjs plugins/glue-core/test/manifest.test.mjs
git commit -m "feat(glue-core): delivery manifest schema + atomic write"
```

---

### Task 2.5: `planner` — план + конфликты + recovery + удаление (тестовая матрица, акцент 2)

**Files:**
- Create: `plugins/glue-core/lib/planner.mjs`
- Test: `plugins/glue-core/test/planner.test.mjs`

**Interfaces:**
- Consumes: `resolveDependencies`, `mergePackRegistries`, `safeSourcePath`/`safeTargetPath`, `hashContent`, `filterModuleBlocks`, `readManifest`.
- Produces: `plan({packs, selected, engines, projectDir, prevManifest, force}) → { writes: [{targetPath, plannedHash, content, sourcePack, packVersion, sourceTemplate, expectedCurrentHash}], materialized: [{targetPath, plannedHash, sourcePack, packVersion, sourceTemplate}], deletes: [{targetPath, expectedCurrentHash}], conflicts: [{targetPath, reason}] }`. Чистая функция: читает диск для текущих хешей, **не пишет**.
  - `expectedCurrentHash` — хеш файла, который planner видел (или `null` если файла не было); writer сверяет его перед записью/удалением (TOCTOU).
  - `materialized` — файлы, **уже** несущие `plannedHash` (recovery: прерванный запуск их записал). Не пишутся повторно, **но входят в новый манифест** — иначе recovery-файл выпал бы из `files[]` (дефект-фикс).
  - `force === true` → `conflicts` переводятся в `writes`/`deletes` (принудительно).
  - `packVersion`/`sourceTemplate`/`sourcePack` — для записи манифеста.

**Конфликт-алгоритм (из спеки):** для каждого планируемого target — `plannedHash` (хеш нового содержимого) vs текущий хеш на диске vs `writtenHash` из `prevManifest`:
- отсутствует → **write**;
- текущий == plannedHash → **materialized** (recovery: уже записан; в манифест, без записи);
- управляется prevManifest и текущий == writtenHash → **write** (обновить);
- текущий != plannedHash и != writtenHash → **conflict** (или write при `force`);
- неизвестен prevManifest и текущий != plannedHash → **conflict** (или write при `force`).
**Удаление:** target из prevManifest, отсутствующий в новом наборе target'ов → **delete** (если текущий == writtenHash) или **conflict** (если правлен; → delete при `force`).
**Манифест итогового запуска = `writes ∪ materialized`** (writer; см. Task 2.6).

- [ ] **Step 1: Тестовая матрица planner** (полная — конфликты, recovery, удаление)

`plugins/glue-core/test/planner.test.mjs` — кейсы:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { plan } from '../lib/planner.mjs'
import { hashContent } from '../lib/hash.mjs'

// helper: фикстура-пак с модулем alpha → известное содержимое шаблона
function fixturePacks(content) {
  return [{ name: 'glue-rules', version: '0.2.0', root: FIXTURE_ROOT(content),
    contract: { templatesDir: 'rules/templates', instructionsDir: 'rules/instructions' },
    registry: { alpha: { title: 'A', templates: ['alpha.md'], instructionBlock: 'alpha', dependsOn: [] } } }]
}

// helper: один пак с модулем alpha; шаблон alpha.md несёт известное `content`.
// setup(projectDir, fileContent|null, prevManifest|null) готовит диск.
const TARGET = '.claude/rules/alpha.md'

// named-кейсы (тела по шаблону helper'а — раскрыть при реализации):
test('absent target → write', () => { /* нет файла → в writes, нет conflict */ })
test('managed & current == writtenHash → write (update)', () => { /* в writes */ })
test('current != planned and != writtenHash → conflict', () => { /* в conflicts */ })
test('unmanaged existing != planned → conflict', () => { /* в conflicts */ })
test('dropped managed module unchanged → delete', () => { /* в deletes */ })
test('dropped managed module hand-edited → conflict', () => { /* в conflicts */ })

// ДОСЛОВНЫЕ (дефект-фиксы):
test('current == plannedHash → materialized, not write (recovery into manifest)', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(proj, '.claude', 'rules'), { recursive: true })
  const content = readTemplateAlpha() // то, что planner собирается записать
  writeFileSync(join(proj, TARGET), content)           // файл уже == plannedHash
  const r = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: null, force: false })
  assert.ok(!r.writes.some((w) => w.targetPath === TARGET), 'not re-written')
  assert.ok(!r.conflicts.some((c) => c.targetPath === TARGET), 'not a conflict')
  assert.ok(r.materialized.some((m) => m.targetPath === TARGET && m.plannedHash === hashContent(content)),
    'recovery file present in materialized → reaches manifest')
})

test('force turns a conflict into a write', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(proj, '.claude', 'rules'), { recursive: true })
  writeFileSync(join(proj, TARGET), 'hand-edited unmanaged\n')   // != planned, unmanaged
  const noForce = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: null, force: false })
  assert.ok(noForce.conflicts.some((c) => c.targetPath === TARGET))
  const forced = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: null, force: true })
  assert.ok(forced.writes.some((w) => w.targetPath === TARGET), 'force → write')
  assert.equal(forced.conflicts.length, 0)
})

test('force turns a hand-edited dropped file into a delete', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(proj, '.claude', 'rules'), { recursive: true })
  const stale = '.claude/rules/old.md'
  writeFileSync(join(proj, stale), 'edited\n')
  const prev = { schemaVersion: '1', status: 'complete', files: [{ targetPath: stale, writtenHash: hashContent('orig\n'), producerPack: 'glue-rules', packVersion: '0.2.0', sourceTemplate: 'old.md' }] }
  const noForce = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: prev, force: false })
  assert.ok(noForce.conflicts.some((c) => c.targetPath === stale))
  const forced = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: prev, force: true })
  assert.ok(forced.deletes.some((d) => d.targetPath === stale), 'force → delete')
})
```
(named-кейсы выше раскрываются по тому же helper-шаблону при реализации; дословные — обязательны как есть.)

- [ ] **Step 2: Запустить — FAIL**

- [ ] **Step 3: Реализовать `planner.mjs`**

Алгоритм: резолв модулей → для каждого шаблона собрать целевое содержимое (`safeSourcePath`+read → `plannedHash`); собрать инструкц-файлы (`filterModuleBlocks` по resolved → `plannedHash`); для каждого target применить конфликт-таблицу против диска и `prevManifest.files`; вычислить deletes из `prevManifest.files`, отсутствующих в новом наборе target'ов; `--force` переводит conflict → write/delete. Все решения — до возврата; функция не пишет.

- [ ] **Step 4: Запустить — PASS (вся матрица)**

- [ ] **Step 5: Commit**

```bash
git add plugins/glue-core/lib/planner.mjs plugins/glue-core/test/planner.test.mjs
git commit -m "feat(glue-core): planner — conflict/recovery/deletion algorithm with full matrix"
```

---

### Task 2.6: `writer` — TOCTOU re-verify + запись + манифест

**Files:**
- Create: `plugins/glue-core/lib/writer.mjs`
- Test: `plugins/glue-core/test/writer.test.mjs`

**Interfaces:**
- Consumes: plan (Task 2.5 — `writes`, `materialized`, `deletes`), `hashContent`, `buildManifest`/`writeManifest`, `safeTargetPath`.
- Produces: `applyPlan({plan, projectDir, engines, modules, deliveryId, completedAt}) → manifest`. Пишет `writes`, удаляет `deletes`, публикует манифест **последним**.
  - **Манифест `files[]` = `writes ∪ materialized`** (дефект-фикс): recovery-файлы (`materialized`) не переписываются, но входят в манифест.
  - **TOCTOU-контракт (один, однозначный):** перед каждой записью/удалением writer перечитывает текущий хеш и сверяет с `expectedCurrentHash` из плана. При несовпадении — **abort всего применения** (throw): изменившийся файл не трогается, манифест **не публикуется**. Уже сделанные записи остаются смешанным состоянием — его поймает recovery при следующем `glue init` (по спеке). Никакого «throw или пропуск» — только abort.
  - **Symlink:** перед записью `lstatSync(target).isSymbolicLink()` → abort (path-safety).

- [ ] **Step 1: Тест TOCTOU (акцент 2)**

`plugins/glue-core/test/writer.test.mjs`:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPlan } from '../lib/writer.mjs'
import { hashContent } from '../lib/hash.mjs'

test('writes planned files and publishes manifest last', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  const content = '# rule\n'
  const p = { writes: [{ targetPath: '.claude/rules/alpha.md', plannedHash: hashContent(content), content, sourcePack: 'glue-rules', sourceTemplate: 'alpha.md', packVersion: '0.2.0', expectedCurrentHash: null }], materialized: [], deletes: [], conflicts: [] }
  const m = applyPlan({ plan: p, projectDir: dir, engines: ['claude'], modules: ['alpha'], deliveryId: 'd', completedAt: 't' })
  assert.equal(readFileSync(join(dir, '.claude/rules/alpha.md'), 'utf8'), content)
  assert.equal(m.status, 'complete')
})

test('manifest includes materialized (recovery) files, not just writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  const p = {
    writes: [],
    materialized: [{ targetPath: '.claude/rules/alpha.md', plannedHash: 'h1', sourcePack: 'glue-rules', packVersion: '0.2.0', sourceTemplate: 'alpha.md' }],
    deletes: [], conflicts: [],
  }
  const m = applyPlan({ plan: p, projectDir: dir, engines: ['claude'], modules: ['alpha'], deliveryId: 'd', completedAt: 't' })
  assert.ok(m.files.some((f) => f.targetPath === '.claude/rules/alpha.md' && f.writtenHash === 'h1'),
    'materialized file present in manifest')
})

test('TOCTOU: changed file aborts whole apply, manifest not published', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(dir, '.claude', 'rules'), { recursive: true })
  writeFileSync(join(dir, '.claude/rules/alpha.md'), 'CHANGED after planning\n')
  const p = { writes: [{ targetPath: '.claude/rules/alpha.md', plannedHash: hashContent('new\n'), content: 'new\n', sourcePack: 'glue-rules', sourceTemplate: 'alpha.md', packVersion: '0.2.0', expectedCurrentHash: hashContent('what planner saw\n') }], materialized: [], deletes: [], conflicts: [] }
  assert.throws(() => applyPlan({ plan: p, projectDir: dir, engines: ['claude'], modules: ['alpha'], deliveryId: 'd', completedAt: 't' }), /TOCTOU|changed|abort/)
  assert.equal(existsSync(join(dir, '.glue', 'manifest.json')), false, 'manifest must not be published on abort')
})
```

- [ ] **Step 2: Запустить — FAIL**

- [ ] **Step 3: Реализовать `writer.mjs`**

Порядок: (1) для каждого `write` и `delete` — `safeTargetPath`; если файл существует — `lstatSync`: symlink → **throw/abort**; перечитать текущий хеш и сверить с `expectedCurrentHash` (TOCTOU); **при любом расхождении — throw (abort всего применения), манифест не публикуется**. (2) Все TOCTOU-сверки пройдены → записать `writes`, удалить `deletes`. (3) Собрать `files[]` манифеста = **записи `writes`** (`writtenHash` = хеш записанного) **∪ записи `materialized`** (`writtenHash` = их `plannedHash`, файл уже на диске). (4) `writeManifest` атомарно последним. Вернуть манифест. (Сверки можно сделать пакетом до любой записи — тогда abort гарантированно до мутаций; но даже при пофайловой проверке abort прекращает дальнейшее и не публикует манифест.)

- [ ] **Step 4: Запустить — PASS**

- [ ] **Step 5: Commit**

```bash
git add plugins/glue-core/lib/writer.mjs plugins/glue-core/test/writer.test.mjs
git commit -m "feat(glue-core): writer — TOCTOU re-verify, deletions, atomic manifest publish"
```

---

### Task 2.7: `init` + CLI `glue init`

**Files:**
- Create: `plugins/glue-core/lib/init.mjs`
- Modify: `plugins/glue-core/bin/glue.mjs` (добавить dispatch `init`)
- Test: `plugins/glue-core/test/init.test.mjs`

**Interfaces:**
- Consumes: `discoverPacks`/`mergePackRegistries`, `plan`, `applyPlan`.
- Produces: `runInit({selected, engines, projectDir, force, now, registryPath}) → {manifest, conflicts}`. CLI: `glue init --modules a,b --engines claude[,agents,gemini] [--force]`.

- [ ] **Step 1: Тест init (склейка на фикстуре)**
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit } from '../lib/init.mjs'

test('init lays out rules + instruction + manifest from fixture pack', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  const { manifest, conflicts } = runInit({
    selected: ['alpha'], engines: ['claude'], projectDir: proj,
    force: false, now: '2026-06-25T00:00:00Z', registryPath: FIXTURE_INSTALLED_JSON,
  })
  assert.equal(conflicts.length, 0)
  assert.ok(existsSync(join(proj, '.claude/rules/alpha.md')))
  assert.ok(existsSync(join(proj, 'CLAUDE.md')))
  assert.equal(manifest.status, 'complete')
})
```

- [ ] **Step 2: Запустить — FAIL**

- [ ] **Step 3: Реализовать `init.mjs`** — `discoverPacks(registryPath)` → `mergePackRegistries` → `resolveDependencies` → `plan({packs, selected, engines, projectDir, prevManifest: readManifest(projectDir), force})` → если `conflicts.length && !force` — вернуть `{manifest: null, conflicts}` **без записи** → иначе `applyPlan({plan, ...})` и вернуть `{manifest, conflicts: []}`. `force` берётся из флага и прокидывается в `plan`. `claude` всегда в engines.

- [ ] **Step 4: Добавить dispatch в `bin/glue.mjs`** — `const [cmd] = process.argv.slice(2)`; `if (cmd === 'init') { ...parse flags..., runInit(...), print JSON }`. Сохранить ветку `session-start` (хук, Task 2.8).

- [ ] **Step 5: Запустить — PASS**

- [ ] **Step 6: Commit**

```bash
git add plugins/glue-core/lib/init.mjs plugins/glue-core/bin/glue.mjs plugins/glue-core/test/init.test.mjs
git commit -m "feat(glue-core): glue init command wiring"
```

---

### Task 2.8: Условный хук — снятие body-injection без окна потери (акценты 4, 5)

**Files:**
- Modify: `plugins/glue-core/bin/glue.mjs` (ветка `session-start`)
- Modify: `plugins/glue-core/.claude-plugin/plugin.json` (bump `0.2.0`)
- Test: `plugins/glue-core/test/hook.test.mjs`

**Interfaces:**
- Consumes: `readManifest`, `hashContent`, `discoverPacks`.
- Produces: SessionStart-вывод. Логика: `nativeDeliveryValid(projectDir, packs)` → если true: **не инжектить** тело (нативная раскладка активна); если false: **инжектить** тело (fallback 0.1.1) + диагностика stderr.

**`nativeDeliveryValid` (полная валидация, акцент 4):** манифест есть И `schemaVersion` поддерживается И `status == complete` И обязательные Claude-targets присутствуют на диске И их текущие хеши == `writtenHash` И `packVersion` в манифесте соответствует актуально установленным версиям паков. **Обязательные Claude-targets = корневой `CLAUDE.md` И все `.claude/rules/*` из манифеста** (не только правила — без инструкц-файла `CLAUDE.md` нативная доставка неполна). Иначе — false (fallback).

**Инвариант (акцент 5):** хук всегда выдаёт один из двух путей — нативная доставка валидна → правила уже в `.claude/rules` (нативно); невалидна → fallback инъекция. **Никогда не выключены оба.**

- [ ] **Step 1: Тест перехода fallback ↔ native**

`plugins/glue-core/test/hook.test.mjs`:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeDeliveryValid } from '../lib/init.mjs' // или отдельный hook.mjs

test('no manifest → fallback (native invalid)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  assert.equal(nativeDeliveryValid(dir, []), false)
})
test('complete manifest with matching hashes → native valid', () => {
  // подготовить .claude/rules/alpha.md + .glue/manifest.json (status complete, writtenHash == file hash)
  // assert true
})
test('manifest present but file hash drifted → fallback', () => {
  // writtenHash != current → false
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
  // при false хук возвращает payload с additionalContext (инъекция), не пустоту
})
```

- [ ] **Step 2: Запустить — FAIL**

- [ ] **Step 3: Реализовать `nativeDeliveryValid` + переключить хук**

В `bin/glue.mjs` ветка `session-start`: `const packs = discoverPacks()`; `if (nativeDeliveryValid(PROJECT_DIR, packs)) { stderr "native delivery active"; вывести пустой/мета-контекст без тела правил; } else { ...текущая логика 0.1.1 инъекции тела + stderr "fallback: native delivery not validated"; }`. (Мета-карта — срез 2; пока при native-valid просто не инжектим тело.)

- [ ] **Step 4: Bump `glue-core` → 0.2.0**

`plugins/glue-core/.claude-plugin/plugin.json`: `"version": "0.2.0"`, описание — «механизм раскладки правил (glue init) + условный хук».

- [ ] **Step 5: Запустить — PASS**

- [ ] **Step 6: Commit**

```bash
git add plugins/glue-core/bin/glue.mjs plugins/glue-core/.claude-plugin/plugin.json plugins/glue-core/test/hook.test.mjs
git commit -m "feat(glue-core): conditional hook — drop body-injection only when native delivery validated"
```

---

### Task 2.9: Интеграционный прогон fallback → glue init → native (акцент 4) + simplify pass

**Files:**
- Test: `plugins/glue-core/test/integration.test.mjs`

- [ ] **Step 1: Интеграционный тест полного перехода**

Один тест в temp-проекте на фикстуре-паке:
```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
// 1. до init: nativeDeliveryValid == false → fallback
// 2. runInit(...) → раскладка + манифест
// 3. после init: nativeDeliveryValid == true → native
// 4. порча файла правила вручную → nativeDeliveryValid == false → снова fallback (recovery)
test('fallback → glue init → native → drift → fallback', () => { /* ... */ })
```

- [ ] **Step 2: Запустить — PASS**

- [ ] **Step 3: Прогнать все тесты core**

Run: `node --test plugins/glue-core/test/`
Expected: PASS (resolve, blocks, paths, registry, discovery, manifest, planner, writer, init, hook, integration).

- [ ] **Step 4: Simplify pass** (pr-policy)

Запустить `/simplify` (или `code-simplifier`) на изменениях ветки, согласовать findings с оператором, отдельный коммит на применённые правки (если 0 — без коммита).

- [ ] **Step 5: Commit интеграционного теста**

```bash
git add plugins/glue-core/test/integration.test.mjs
git commit -m "test(glue-core): integration — fallback→init→native→drift→fallback"
```

---

### Task 2.10: Удалить legacy fallback-слой `glue-rules` (после хука)

**Files:**
- Delete: `plugins/glue-rules/rules/commit-discipline.md`, `plugins/glue-rules/rules/secret-hygiene.md`
- Modify: `plugins/glue-rules/test/templates.test.mjs` (снять тест fallback-совместимости)
- Modify: `plugins/glue-rules/.claude-plugin/plugin.json` (bump `0.2.1`)

**Контекст:** этот шаг — в **PR2** (а не PR1), потому что только после переключения core-хука на нативную доставку (Task 2.8) старый формат `rules/*.md` больше не нужен. До этого момента он держал fallback старого core. Удаляется как часть PR2, где новый хук уже не зависит от него.

- [ ] **Step 1: Удалить legacy-файлы и тест совместимости**

```bash
git rm plugins/glue-rules/rules/commit-discipline.md plugins/glue-rules/rules/secret-hygiene.md
```
Снять тест `fallback layer preserved...` из `templates.test.mjs`.

- [ ] **Step 2: Bump `glue-rules` → 0.2.1**

`plugins/glue-rules/.claude-plugin/plugin.json`: `"version": "0.2.1"` (legacy-слой удалён, нативная доставка — основной путь).

- [ ] **Step 3: Прогнать тесты пака — PASS**

Run: `node --test plugins/glue-rules/test/`

- [ ] **Step 4: Commit**

```bash
git add plugins/glue-rules
git commit -m "chore(glue-rules): drop legacy fallback rules after native delivery cutover"
```

(Тег `glue-rules--v0.2.1` ставится вместе с тегом core после merge PR2.)

**После merge PR2:** теги `glue-core--v0.2.0` и `glue-rules--v0.2.1` на пост-merge HEAD + push.

---

## Зависимость и порядок (акцент 1) — сводка

1. **PR1 `glue-rules` 0.2.0** merge → тег `glue-rules--v0.2.0` push. Новый контракт+10 модулей в `rules/templates/`; **старые `rules/*.md` сохранены** → `glue-core` 0.1.1 нерекурсивный fallback продолжает их инжектить (доставка не прервана).
2. **PR2 `glue-core` 0.2.0** разрабатывается на фикстуре-паке (не зависит от установки); резолвит реальный контракт `glue-rules` только в интеграционном прогоне. Включает Task 2.10 — удаление legacy `rules/*.md` (bump `glue-rules` 0.2.1) уже после переключения хука. Merge → теги `glue-core--v0.2.0` + `glue-rules--v0.2.1` push.
3. Установка/обновление в тест-проекте: `claude plugin update` → 0.2.0; затем `glue init --modules ... --engines claude` → раскладка; следующая сессия (`/clear`) — хук видит валидный манифест → нативная доставка, инъекция снята.

**Инвариант непрерывности (акцент 5):** на каждом промежуточном HEAD — либо старый хук инжектит (PR1, до core-0.2.0), либо новый хук инжектит-или-нативно (PR2). Состояния «оба пути выключены» не существует: `nativeDeliveryValid == false` всегда влечёт fallback-инъекцию.

## Verification (вся тестовая матрица — акцент 2)

| Зона | Тест | Task |
|---|---|---|
| resolve/blocks | топопорядок, цикл, unknown, фильтр блоков | 2.1 |
| path-safety | source-в-паке, target-зона, `..`/abs/symlink | 2.2, 2.6 |
| registry/identity | валидация, коллизия ID, within-pack deps | 2.3 |
| манифест | roundtrip, атомарность | 2.4 |
| конфликты | absent/planned/written/conflict/force | 2.5 |
| recovery | прерванный запуск (== plannedHash → skip) | 2.5, 2.9 |
| удаление | dropped-unchanged → delete, dropped-edited → conflict | 2.5 |
| TOCTOU | хеш изменился после планирования → не затирать | 2.6 |
| переход доставки | fallback→init→native→drift→fallback | 2.8, 2.9 |
| инвариант | native-invalid ⇒ fallback (никогда оба off) | 2.8 |
| fallback-совместимость | старые `rules/*.md` сохранены до cutover (дефект-фикс 1) | 1.2 |
| recovery в манифест | `materialized` входит в `files[]` (дефект-фикс 2) | 2.5, 2.6 |
| TOCTOU abort | манифест не публикуется при расхождении (дефект-фикс 3) | 2.6 |
| force | conflict→write, dropped-edited→delete (дефект-фикс 4) | 2.5 |
| CLAUDE.md в хуке | отсутствие → fallback (дефект-фикс 5) | 2.8 |

## Self-Review

- **Spec coverage:** контракт пака (1.1) ✓; манифест+атомарность (2.4) ✓; конфликт+recovery+удаление (2.5) ✓; TOCTOU (2.6) ✓; path-safety (2.2/2.6) ✓; module-identity (2.3) ✓; условный хук без окна (2.8) ✓; 10 модулей без retro (1.1/1.2) ✓; `.invoker`-аудит (1.2) ✓; порядок 2 PR (сводка) ✓.
- **Дефект-фиксы адвизора (контрактные):** (1) PR1 сохраняет fallback-слой, legacy-уборка в PR2/Task 2.10 ✓; (2) recovery-файлы (`materialized`) входят в манифест ✓; (3) TOCTOU → abort без публикации манифеста ✓; (4) `force` в сигнатуре `plan` + проброс в `init` ✓; (5) `CLAUDE.md` среди обязательных хук-targets ✓.
- **Дословные тесты (по требованию адвизора):** fallback-совместимость (1.2), recovery→manifest (2.5+2.6), TOCTOU-abort (2.6), force write/delete (2.5), CLAUDE.md-в-хуке (2.8). Прочие кейсы матрицы — named + helper-описание, раскрываются при реализации.
- Перенос дословный (resolve/blocks) — код показан; новый код (registry/planner/writer/manifest/hook) — сигнатуры и реализации заданы.

## Deviations log

Отклонения, возникшие по ходу исполнения (pr-policy § «Sync spec/plan при отклонениях»).

- **[tooling] Verification-команда `node --test`.** План задаёт директорную форму `node --test plugins/<pack>/test/` (Task 1.4 Step 2, Task 2.9 Step 3, сводка Verification). На Node v24.16.0 (Windows) эта форма трактует путь как один тест-файл и падает (`tests 1 / fail 1`), не выполняя discovery. Принятый стандарт по всему срезу: glob-форма `node --test "plugins/<pack>/test/*.mjs"`. Подтверждено механически в worktree PR1. Причина — поведение test-runner'а Node 24, не предусмотренное планом; реализация и поведение пакетов не затронуты. Применять ту же форму в PR2.

### PR2

- **[plan-fix] Task 2.1 blocks-тест fixture.** План одновременно требовал «перенести `blocks.mjs` дословно» и приводил тест, ожидающий `'A\nX\n\nB'` (пустая строка-разделитель), которую дословный invoker-код не производит (даёт `'A\nX\nB'`). Оператор адъюдицировал: главенствует дословный перенос (синтетические пустые строки засоряли бы генерируемые `CLAUDE.md`/`AGENTS.md`). Исправление: `blocks.mjs` дословный, ожидание теста → `'A\nX\nB'` (commit 61878d2). **Поправить тест в плане Task 2.1 Step 5 на `'A\nX\nB'`.**
- **[plan-fix] Task 2.3 mergePackRegistries.** Код-пример плана проверял только коллизию ID, но тест `cross-pack dependsOn is rejected` ждёт throw на межпаковой зависимости. Реализация расширена (контроллер): после owner-map проверяется, что каждая `dependsOn`-запись принадлежит тому же паку, иначе throw `cross-pack` (commit 3cff98c). **Дополнить код mergePackRegistries в плане Task 2.3 Step 5.**
- **[hardening] Task 2.6 writer TOCTOU absent-case.** Дословный алгоритм оборачивал symlink+TOCTOU-проверки в `if (existsSync)`, пропуская случай «файл отсутствует, но `expectedCurrentHash` ненулевой» (удалён между план и apply). Ревью пометило Important; добавлена ветка absent → abort (commit 52fc12a), чтобы «ANY mismatch → throw» выполнялось буквально.
- **[plan-fix] Task 2.10 dependency-constraint.** План не предусмотрел обновление зависимости `glue-rules`→`glue-core` (осталось `~0.1.0` с PR1). После bump core→0.2.0 пак 0.2.1 функционально требует механизм `glue init` (core 0.2.0+); с 0.1.x доставки нет. Исправлено `~0.1.0`→`~0.2.0` (commit bd88e8f). **Добавить шаг обновления dependency в план Task 2.10.**
- **[process] Simplify pass timing.** План помещал simplify pass внутрь Task 2.9 Step 4. Выполнен один раз branch-wide непосредственно перед PR (тайминг pr-policy § «Simplify pass перед PR»), по полному коду PR2 (после Task 2.10).
