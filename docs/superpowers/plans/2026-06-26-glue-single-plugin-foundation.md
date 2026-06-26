# Glue single-plugin — foundation (PR 0 + Срез 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать новый greenfield-плагин `plugins/glue/` со встроенным контентом и рабочей командой `/glue:list` — первый тестируемый результат схлопывания в один плагин.

**Architecture:** Один плагин `glue` с механизмом в `src/` и контентом в `content/`. Загрузчик `bundle` читает **свой** контент по внутреннему bundle-контракту (`glue.contract_v1.json`) — без скана `installed_plugins.json`, без меж-плагинного merge. `bin/glue.mjs` — тонкий диспетчер подкоманд. Этот план покрывает только загрузку bundle + `list`; `init`/`status`/хук — следующие срезы (отдельные планы).

**Tech Stack:** Node.js ESM (`.mjs`), встроенный тест-раннер `node:test` + `node:assert/strict`. Внешних зависимостей нет (нет `package.json`). Node v24 на Windows.

## Global Constraints

- **Один плагин `glue`**: контент встроен; **нет** скана `installed_plugins.json`, `dependencies` между плагинами, меж-пакового merge/коллизий/qualified IDs. (`2026-06-25-glue-single-plugin-collapse-design.md` § «Снятые инварианты»)
- **Контракт** — `glue.contract_v1.json`: версия в имени файла, **без** поля `contractVersion` в теле, **без** поля `kind`. (`versioning.md`; design § «Внутренний bundle-контракт»)
- **Формат реестра** (`content/bundle.json`): `module-id → { title, group, default, note, templates[], instructionBlock, dependsOn[] }`; имена в `templates[]` резолвятся относительно `modulesDir`. (design § «Формат реестра»)
- **10 модулей**, без `retro-loop` (он завязан на retro-инфру среза 3). (design § «Формат реестра»)
- **`/glue:list` выводит** `id, title, group, default, note` (acceptance-сценарий 1).
- **Имена** (slug'и, файлы, ключи) — ASCII; содержание правил/описаний — русский (`glossary.md`).
- **Бюджет PR** (`pr-policy`): target 400 reviewable строк, hard-cap 800 строк / **15 файлов**.
- **Окружение:** Windows, primary shell — **PowerShell**. Все шелл-команды плана даны в PowerShell. Тест-раннер на Node 24/Windows: для полного прогона использовать **glob-форму** `node --test "<dir>/*.test.mjs"` — directory-форма (`node --test <dir>/`) на Node 24 трактует путь как один тест-файл и падает (проверено).
- **Параллелизм:** новый `plugins/glue/` создаётся рядом с нетронутыми `glue-core`/`glue-rules`. Удаление legacy и переключение marketplace — срез 5 (cutover), не здесь.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `plugins/glue/content/bundle.json` | реестр 10 модулей (порт из `glue-rules/rules/registry.json`) |
| `plugins/glue/content/modules/*.md` | 10 шаблонов правил (порт из `glue-rules/rules/templates/`) |
| `plugins/glue/content/instructions/*.tmpl` | 3 инструкц-шаблона (порт из `glue-rules/rules/instructions/`) |
| `plugins/glue/.claude-plugin/plugin.json` | манифест плагина (`name: "glue"`) |
| `plugins/glue/glue.contract_v1.json` | внутренний bundle-контракт: пути к реестру/модулям/инструкциям |
| `plugins/glue/src/bundle.mjs` | загрузка+валидация своего bundle; flat-список модулей |
| `plugins/glue/bin/glue.mjs` | диспетчер подкоманд (в этом срезе — только `list`) |
| `plugins/glue/skills/list/SKILL.md` | навык `/glue:list` |
| `plugins/glue/test/bundle.test.mjs` | тесты загрузчика bundle |
| `plugins/glue/test/list.test.mjs` | тесты flat-списка модулей |
| `.claude-plugin/marketplace.json` | добавить запись плагина `glue` (legacy-записи не трогать) |

**PR-границы (укладка в 15-файловый cap):**
- **PR 0** = Task 1 (импорт контента) — ровно 14 файлов (`bundle.json` + 10 `modules` + 3 `instructions`), content-only.
- **Срез 1 PR** = Task 2-5 (scaffold + loader + list + skill + marketplace) — ~8 файлов.

---

### Task 1: Импорт контента (PR 0, механический, content-only)

**Files:**
- Create: `plugins/glue/content/bundle.json` (порт из `plugins/glue-rules/rules/registry.json`)
- Create: `plugins/glue/content/modules/*.md` (10 файлов, порт из `plugins/glue-rules/rules/templates/`)
- Create: `plugins/glue/content/instructions/{CLAUDE.md.tmpl,AGENTS.md.tmpl,GEMINI.md.tmpl}` (порт из `plugins/glue-rules/rules/instructions/`)

**Interfaces:**
- Consumes: ничего (механический перенос).
- Produces: реестр + 10 шаблонов + 3 инструкц-шаблона, читаемые `src/bundle.mjs` (Task 3). Реестр содержит ключи: `operator-gate`, `secret-hygiene`, `worktree-workflow`, `pr-policy`, `review-loop`, `subagent-dispatch`, `safety`, `architectural-invariants`, `versioning`, `glossary`.

- [ ] **Step 1: Скопировать модули, инструкции и реестр (verbatim, не move) — PowerShell**

```powershell
New-Item -ItemType Directory -Force plugins/glue/content/modules, plugins/glue/content/instructions | Out-Null
Copy-Item plugins/glue-rules/rules/templates/*.md plugins/glue/content/modules/
Copy-Item plugins/glue-rules/rules/instructions/*.tmpl plugins/glue/content/instructions/
Copy-Item plugins/glue-rules/rules/registry.json plugins/glue/content/bundle.json
```

- [ ] **Step 2: Проверить состав — ровно 10 модулей, без `retro-loop`**

```powershell
Get-ChildItem plugins/glue/content/modules/ -Name | Sort-Object
```
Expected: 10 файлов — `architectural-invariants.md`, `glossary.md`, `operator-gate.md`, `pr-policy.md`, `review-loop.md`, `safety.md`, `secret-hygiene.md`, `subagent-dispatch.md`, `versioning.md`, `worktree-workflow.md`. Файла `retro-loop.md` быть НЕ должно. Если есть — удалить (`Remove-Item plugins/glue/content/modules/retro-loop.md`) и убрать его ключ из `content/bundle.json`.

- [ ] **Step 3: Аудит `.invoker/*` ссылок в перенесённом контенте**

```powershell
Get-ChildItem plugins/glue/content -Recurse -File | Select-String -Pattern '\.invoker'
```
Expected: пустой вывод (контент шёл из `glue-rules` 0.2.1, аудит уже пройден). Если ссылки найдены — для каждой переформулировать нейтрально или мигрировать на `.glue/`; немигрированные `.invoker/`-ссылки в Glue-контенте недопустимы.

- [ ] **Step 4: Проверить, что файлов ровно 14 (укладка в cap)**

```powershell
(Get-ChildItem plugins/glue/content -Recurse -File).Count
```
Expected: `14` (1 `bundle.json` + 10 modules + 3 instructions).

- [ ] **Step 5: Commit (PR 0)**

```powershell
git add plugins/glue/content/
git commit -m "feat(glue): import content bundle (10 modules + instructions)"
```

---

### Task 2: Scaffold плагина + контракт

**Files:**
- Create: `plugins/glue/.claude-plugin/plugin.json`
- Create: `plugins/glue/glue.contract_v1.json`

**Interfaces:**
- Consumes: ничего.
- Produces: манифест плагина + контракт, на который опирается `src/bundle.mjs` (Task 3). Контракт-поля: `registry`, `modulesDir`, `instructionsDir`.

- [ ] **Step 1: Создать манифест плагина (без рекламы нереализованных команд)**

`plugins/glue/.claude-plugin/plugin.json`:

```json
{
  "name": "glue",
  "version": "0.1.0",
  "description": "Glue: нативная раскладка правил и знаний в проект (один плагин, встроенный контент). Доступно: /glue:list. В разработке: /glue:init, /glue:status + SessionStart-хук."
}
```

- [ ] **Step 2: Создать bundle-контракт**

`plugins/glue/glue.contract_v1.json` (версия в имени файла, без `contractVersion`/`kind` в теле):

```json
{
  "registry": "content/bundle.json",
  "modulesDir": "content/modules",
  "instructionsDir": "content/instructions"
}
```

- [ ] **Step 3: Commit**

```powershell
git add plugins/glue/.claude-plugin/plugin.json plugins/glue/glue.contract_v1.json
git commit -m "feat(glue): scaffold single plugin + bundle contract"
```

---

### Task 3: Bundle-loader (`src/bundle.mjs`)

**Files:**
- Create: `plugins/glue/src/bundle.mjs`
- Test: `plugins/glue/test/bundle.test.mjs`

**Interfaces:**
- Consumes: контракт (Task 2) + реестр (Task 1).
- Produces:
  - `loadContract(root?) → object` — читает `glue.contract_v1.json` из корня плагина (по умолчанию — вычисленный корень относительно `src/`);
  - `loadBundle(root?, contract?) → registry` — читает и валидирует реестр по контракту; бросает при невалидном;
  - `validateBundle(registry) → registry` — валидация формата; бросает `Error` с перечнем ошибок.
  - **Нет** `mergePackRegistries`, **нет** скана `installed_plugins.json` — один встроенный bundle.

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/bundle.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadContract, loadBundle, validateBundle } from '../src/bundle.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('loadContract читает glue.contract_v1.json без contractVersion', () => {
  const c = loadContract(ROOT)
  assert.equal(c.registry, 'content/bundle.json')
  assert.equal(c.modulesDir, 'content/modules')
  assert.equal(c.instructionsDir, 'content/instructions')
  assert.equal('contractVersion' in c, false)
})

test('loadBundle загружает встроенный реестр с 10 модулями', () => {
  const reg = loadBundle(ROOT)
  assert.equal(Object.keys(reg).length, 10)
  assert.ok(reg['operator-gate'])
  assert.equal(reg['retro-loop'], undefined)
})

test('validateBundle отклоняет модуль без title', () => {
  assert.throws(
    () => validateBundle({ x: { templates: ['x.md'], instructionBlock: 'x', dependsOn: [] } }),
    /title/,
  )
})

test('validateBundle отклоняет dependsOn на неизвестный модуль', () => {
  assert.throws(
    () => validateBundle({ a: { title: 'A', templates: ['a.md'], instructionBlock: 'a', dependsOn: ['nope'] } }),
    /unknown 'nope'/,
  )
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test plugins/glue/test/bundle.test.mjs`
Expected: FAIL — `Cannot find module '../src/bundle.mjs'`.

- [ ] **Step 3: Реализовать загрузчик**

`plugins/glue/src/bundle.mjs`:

```js
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Корень плагина = родитель каталога src/.
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function loadContract(root = PLUGIN_ROOT) {
  return JSON.parse(readFileSync(join(root, 'glue.contract_v1.json'), 'utf8'))
}

export function loadBundle(root = PLUGIN_ROOT, contract = loadContract(root)) {
  const registry = JSON.parse(readFileSync(join(root, contract.registry), 'utf8'))
  return validateBundle(registry)
}

export function validateBundle(registry) {
  const ids = Object.keys(registry)
  const errors = []
  for (const [id, m] of Object.entries(registry)) {
    if (typeof m?.title !== 'string' || !m.title) errors.push(`${id}: title`)
    if (!Array.isArray(m?.templates) || m.templates.length === 0) errors.push(`${id}: templates`)
    if (typeof m?.instructionBlock !== 'string') errors.push(`${id}: instructionBlock`)
    if (!Array.isArray(m?.dependsOn)) errors.push(`${id}: dependsOn`)
    for (const dep of m?.dependsOn ?? []) {
      if (!ids.includes(dep)) errors.push(`${id}: dependsOn references unknown '${dep}'`)
    }
  }
  if (errors.length) throw new Error('Invalid bundle registry:\n' + errors.join('\n'))
  return registry
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node --test plugins/glue/test/bundle.test.mjs`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```powershell
git add plugins/glue/src/bundle.mjs plugins/glue/test/bundle.test.mjs
git commit -m "feat(glue): bundle loader + validation (single embedded bundle)"
```

---

### Task 4: Flat-список модулей + диспетчер `list`

**Files:**
- Modify: `plugins/glue/src/bundle.mjs` (добавить `listModules`)
- Create: `plugins/glue/bin/glue.mjs`
- Test: `plugins/glue/test/list.test.mjs`

**Interfaces:**
- Consumes: `loadBundle` (Task 3).
- Produces:
  - `listModules(registry) → Array<{id, title, group, default, note, dependsOn}>` — плоский список (без merge, прямо из одного реестра); поля нормализованы (`group`/`note` → `null`, `default` → `false`, если отсутствуют);
  - `bin/glue.mjs` подкоманда `list` → печатает JSON-массив в stdout, exit 0; неизвестная команда → stderr + exit 1.

- [ ] **Step 1: Написать падающий тест**

`plugins/glue/test/list.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listModules } from '../src/bundle.mjs'

test('listModules возвращает плоский список с нормализованными полями (включая note)', () => {
  const reg = {
    'a': { title: 'A', group: 'g1', default: true, note: 'заметка A', templates: ['a.md'], instructionBlock: 'a', dependsOn: [] },
    'b': { title: 'B', templates: ['b.md'], instructionBlock: 'b', dependsOn: ['a'] },
  }
  const list = listModules(reg)
  assert.deepEqual(list, [
    { id: 'a', title: 'A', group: 'g1', default: true, note: 'заметка A', dependsOn: [] },
    { id: 'b', title: 'B', group: null, default: false, note: null, dependsOn: ['a'] },
  ])
})
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test plugins/glue/test/list.test.mjs`
Expected: FAIL — `listModules is not a function` / нет экспорта.

- [ ] **Step 3: Добавить `listModules` в `src/bundle.mjs`**

Дописать в конец `plugins/glue/src/bundle.mjs`:

```js
export function listModules(registry) {
  return Object.entries(registry).map(([id, m]) => ({
    id,
    title: m.title,
    group: m.group ?? null,
    default: m.default ?? false,
    note: m.note ?? null,
    dependsOn: m.dependsOn ?? [],
  }))
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node --test plugins/glue/test/list.test.mjs`
Expected: PASS.

- [ ] **Step 5: Создать диспетчер `bin/glue.mjs`**

`plugins/glue/bin/glue.mjs`:

```js
#!/usr/bin/env node
// glue — единый плагин. Тонкий диспетчер подкоманд над src/.
// В этом срезе реализована только `list`; init/status/session-start — следующие срезы.

import { loadBundle, listModules } from '../src/bundle.mjs'

const [cmd] = process.argv.slice(2)

if (cmd === 'list') {
  // glue list → плоский список модулей встроенного bundle (JSON)
  const registry = loadBundle()
  process.stdout.write(JSON.stringify(listModules(registry), null, 2) + '\n')
  process.exit(0)
} else {
  process.stderr.write(`[glue] неизвестная команда: ${cmd ?? '(нет)'}\n`)
  process.exit(1)
}
```

- [ ] **Step 6: Проверить команду end-to-end**

Run: `node plugins/glue/bin/glue.mjs list`
Expected: JSON-массив из 10 объектов `{id,title,group,default,note,dependsOn}` в stdout, exit 0. Проверить наличие `operator-gate`, непустой `note` у дефолтных модулей, и что `dependsOn` у `pr-policy` содержит `worktree-workflow`.

- [ ] **Step 7: Commit**

```powershell
git add plugins/glue/src/bundle.mjs plugins/glue/bin/glue.mjs plugins/glue/test/list.test.mjs
git commit -m "feat(glue): /glue list command + flat module listing"
```

---

### Task 5: Навык `/glue:list` + запись в marketplace

**Files:**
- Create: `plugins/glue/skills/list/SKILL.md`
- Modify: `.claude-plugin/marketplace.json` (добавить запись `glue`; legacy-записи не трогать)

**Interfaces:**
- Consumes: `bin/glue.mjs list` (Task 4).
- Produces: навык `/glue:list`, видимый после установки плагина `glue`; запись плагина в marketplace для локальной установки/тестов.

- [ ] **Step 1: Создать SKILL.md**

Создать `plugins/glue/skills/list/SKILL.md` со следующим содержимым (внешний fence — **четыре** бэктика, чтобы вложенный ```bash не разорвал файл; в сам файл четыре бэктика не пишутся):

````markdown
---
name: list
description: Показать доступные модули правил Glue (id, заголовок, группа, дефолтность, заметка, зависимости) из встроенного bundle.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Покажи доступные модули Glue, выполнив CLI плагина:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" list
```

Команда возвращает JSON-массив объектов `{ id, title, group, default, note, dependsOn }`. Разбери его и покажи оператору модули по группам (поле `group`), отметив дефолтные (`default: true`), заметку (`note`) и зависимости (`dependsOn`).
````

- [ ] **Step 2: Добавить запись в marketplace**

В `.claude-plugin/marketplace.json` в массив `plugins` добавить (рядом с существующими `glue-core`/`glue-rules`, **не** удаляя их):

```json
    {
      "name": "glue",
      "source": "./plugins/glue",
      "description": "Glue: нативная раскладка правил и знаний в проект (один плагин, встроенный контент).",
      "author": { "name": "Kirill Bogdanov" }
    }
```

- [ ] **Step 3: Проверить валидность JSON marketplace**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 4: Прогнать весь тест-набор нового плагина (glob-форма)**

Run: `node --test "plugins/glue/test/*.test.mjs"`
Expected: PASS — все тесты `bundle.test.mjs` + `list.test.mjs` зелёные (`fail 0`).

- [ ] **Step 5: Commit**

```powershell
git add plugins/glue/skills/list/SKILL.md .claude-plugin/marketplace.json
git commit -m "feat(glue): /glue:list skill + marketplace entry"
```

---

## Self-Review

**Spec coverage (этот план покрывает только PR 0 + Срез 1):**
- design § «Структура плагина» (контракт, `content/`, `src/bundle.mjs`, `bin/glue.mjs`) — Task 1-4 ✓
- design § «Acceptance-сценарий 1 (`/glue:list` с `id,title,group,default,note`)» — Task 4-5 ✓ (`note` включён)
- design § «Внутренний bundle-контракт» (`glue.contract_v1.json`, без `contractVersion`/`kind`) — Task 2 + тест Task 3 ✓
- design § «Формат реестра» (10 модулей, без `retro-loop`, `templates[]` под `modulesDir`) — Task 1 ✓
- design § «Снятые инварианты» (нет merge/скана реестра) — `src/bundle.mjs` без `mergePackRegistries` ✓
- **Вне этого плана** (следующие срезы, отдельные планы): `resolve`, `plan`/`apply`/`manifest` (Срез 2), `status` + хук + fallback (Срез 3), `init`-skill + интеграция 10 сценариев (Срез 4), cutover (Срез 5). Acceptance 2-10 — не здесь.

**Placeholder scan:** плейсхолдеров нет; весь код приведён полностью; команды и ожидаемый вывод явны.

**Type consistency:** `loadContract`/`loadBundle`/`validateBundle`/`listModules` — сигнатуры совпадают между Task 3, Task 4 и тестами. `listModules` возвращает `{id,title,group,default,note,dependsOn}` единообразно в реализации (Task 4 Step 3), тесте (Task 4 Step 1), CLI-описании (Task 4 Step 6) и SKILL.md (Task 5).

**File-cap check:** PR 0 = 14 файлов (≤15) ✓; Срез 1 PR = 8 файлов ✓.

**Shell check:** все file-команды — PowerShell; полный прогон тестов — glob-форма (directory-форма на Node 24 падает, проверено).
