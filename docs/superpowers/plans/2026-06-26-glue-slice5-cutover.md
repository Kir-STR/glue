# Glue срез 5 — cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Удалить legacy `glue-core`/`glue-rules`, переключить marketplace на единственный `glue`, синхронизировать README и закрепить repo-инвариант «ровно один SessionStart-хук + marketplace только glue» тестом.

**Architecture:** Один деструктивный cutover-PR. TDD: новый `cutover-hooks.test.mjs` фиксирует целевой инвариант (RED при наличии legacy), затем удаление legacy + правка marketplace делают его GREEN. README — отдельный docs-sync коммит в том же PR. Код `glue` (`src/`, `bin/`, навыки) не трогается.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, `node:fs`. Git (`git rm -r`).

## Global Constraints

- **PR-budget exception (дословно, в тело PR):** «PR-budget exception: cutover removes superseded legacy plugin trees `plugins/glue-core` and `plugins/glue-rules`. Reviewable risk is bounded by path scope and marketplace diff; deletion volume is mechanical and cannot be meaningfully split under cap because glue-core alone exceeds it.»
- **Не трогать:** `docs/superpowers/specs/*` и `docs/superpowers/plans/*` (read-only исторические); литералы `glue-core`/`glue-rules` в `plugins/glue/test/*.test.mjs` (легитимные fixture'ы отклонения foreign-манифеста — остаются).
- **Код `glue` не трогать:** `plugins/glue/src/`, `plugins/glue/bin/`, `plugins/glue/skills/`, `plugins/glue/content/`, `plugins/glue/hooks/` — без изменений. Срез только удаляет legacy + правит marketplace + README + добавляет один тест.
- **Запуск тестов — только glob-форма:** `node --test "plugins/glue/test/*.test.mjs"` (directory-форма падает на Node 24/Windows).
- **Safeguards:** полный сьют зелёный до (RED только на новом cutover-тесте) и после удаления; `marketplace.json` валидный JSON; legacy-директории отсутствуют; `plugins/glue` остаётся; marketplace содержит только `glue`.
- **Commit-классы не смешивать:** cutover (удаление+marketplace+тест) — `refactor:`; README — `docs:`.
- **Имена/пути ASCII; README — английский** (текущий язык файла).

---

### Task 1: Cutover — invariant-тест + удаление legacy + sync README

**Files:**
- Create: `plugins/glue/test/cutover-hooks.test.mjs`
- Delete: `plugins/glue-core/` (вся директория), `plugins/glue-rules/` (вся директория)
- Modify: `.claude-plugin/marketplace.json` (оставить только `glue`)
- Modify: `README.md:5-9` (docs-sync на единый плагин)

**Interfaces:**
- Consumes: существующая раскладка — `plugins/<name>/hooks/hooks.json` с `{hooks:{SessionStart:[…]}}` (есть у `glue` и legacy `glue-core`); `.claude-plugin/marketplace.json` с полем `plugins:[{name, source, …}]`.
- Produces: repo-инвариант (тест), проверяемый существующим прогоном `node --test "plugins/glue/test/*.test.mjs"`.

- [ ] **Step 1: Написать cutover-тест (RED)**

Create `plugins/glue/test/cutover-hooks.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // plugins/glue/test
const PLUGINS_DIR = join(HERE, '..', '..')           // plugins/
const REPO_ROOT = join(PLUGINS_DIR, '..')            // корень репо

function pluginDirs() {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
}

test('cutover: ровно один плагин объявляет SessionStart-хук, и это glue', () => {
  const withSessionStart = []
  for (const name of pluginDirs()) {
    const hooksPath = join(PLUGINS_DIR, name, 'hooks', 'hooks.json')
    if (!existsSync(hooksPath)) continue // плагины без hooks/ игнорируем (устойчивость)
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'))
    if (hooks?.hooks?.SessionStart) withSessionStart.push(name)
  }
  assert.deepEqual(withSessionStart.sort(), ['glue'])
})

test('cutover: marketplace содержит только glue → ./plugins/glue', () => {
  const mp = JSON.parse(readFileSync(join(REPO_ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))
  assert.deepEqual(mp.plugins.map((p) => p.name), ['glue'])
  const glue = mp.plugins.find((p) => p.name === 'glue')
  assert.equal(glue.source, './plugins/glue')
})

test('cutover: legacy-директории удалены, glue остаётся', () => {
  assert.ok(existsSync(join(PLUGINS_DIR, 'glue')))
  assert.ok(!existsSync(join(PLUGINS_DIR, 'glue-core')))
  assert.ok(!existsSync(join(PLUGINS_DIR, 'glue-rules')))
})
```

- [ ] **Step 2: Прогон — RED**

Run: `node --test "plugins/glue/test/*.test.mjs"`
Expected: три новых теста падают — `glue-core` тоже несёт SessionStart-хук (набор `['glue','glue-core']`), marketplace содержит 3 записи, `plugins/glue-core` существует. Существующие 85 тестов — PASS.

- [ ] **Step 3: Удалить legacy-директории**

Run:
```bash
git rm -r plugins/glue-core plugins/glue-rules
```
Expected: ~53 файла помечены на удаление.

- [ ] **Step 4: Переключить marketplace на единственный glue**

Заменить весь файл `.claude-plugin/marketplace.json` на:

```json
{
  "name": "glue",
  "owner": {
    "name": "Kirill Bogdanov",
    "email": "kirill.bogdanov@strela.digital"
  },
  "plugins": [
    {
      "name": "glue",
      "source": "./plugins/glue",
      "description": "Glue: нативная раскладка правил и знаний в проект (один плагин, встроенный контент).",
      "author": { "name": "Kirill Bogdanov" }
    }
  ]
}
```

- [ ] **Step 5: Прогон — GREEN (cutover + полный сьют)**

Run: `node --test "plugins/glue/test/*.test.mjs"`
Expected: все тесты PASS (85 существующих + 3 новых cutover = 88), `# fail 0`. Существующие тесты с литералами `glue-core`/`glue-rules` остаются зелёными (они не читают legacy-файлы).

- [ ] **Step 6: Commit (cutover, класс refactor)**

Сначала проверь ветку:
```bash
git rev-parse --abbrev-ref HEAD
```
Expected: `feat-glue-slice5-cutover` (не `main`).

```bash
git add plugins/glue/test/cutover-hooks.test.mjs .claude-plugin/marketplace.json
git commit -m "refactor(glue): cutover — remove legacy glue-core/glue-rules + one-hook invariant"
```
(Удаления из Step 3 уже в индексе после `git rm`.)

- [ ] **Step 7: Sync README на единый плагин**

В `README.md` заменить строки 5–9. Точный old → new:

old (строки 5–9):
```
It ships through the `glue` marketplace: the `glue-core` plugin (command, map, judges, adapters) plus content packs you install as a project grows. Each pack depends on `glue-core@glue`, so the core is delivered automatically — you just pick the packs you need:

- **`glue-rules` (P1 "Rules & Knowledge")** — structure and visibility for rules and knowledge (soft control only — brings no constraints to enforce).
- **`glue-decisions` (P2 "Decisions & Constraints")** — recording decisions and hard enforcement of constraints (code judge + provenance).
- **`glue-support` (P3 "Support")** — the same pattern for infrastructure (backlog).
```

new:
```
It ships as a single `glue` plugin through the `glue` marketplace: the plugin carries its mechanism and content embedded — you select engines and modules with `/glue:init`. Today it fills P1 ("Rules & Knowledge") — structure and visibility for rules and knowledge (soft control only). Further kinds are roadmap:

- **P2 "Decisions & Constraints"** — recording decisions and hard enforcement of constraints (code judge + provenance).
- **P3 "Support"** — the same pattern for infrastructure (backlog).
```

- [ ] **Step 8: Commit (README, класс docs)**

```bash
git add README.md
git commit -m "docs: sync README to single-plugin model"
```

---

## Self-Review

**Spec coverage:** Секция 1 (удаление legacy → Step 3; marketplace → Step 4; README docs-sync → Step 7–8; repo-тест → Step 1). Секция 2 (budget exception → Global Constraints + тело PR). Секция 3 (safeguards + TDD → Step 2/5). Секция 4 (cutover-hooks.test.mjs: hook-инвариант устойчив к отсутствию `hooks/` через `continue`; marketplace-ассерты name/source; legacy отсутствуют, glue остаётся → Step 1). Секция 5 (рунбук среды) — операционный, не в коде, живёт в spec + тело PR (не задача плана). Секция 6 (гейты) — процессные, у контроллера. Все кодовые требования покрыты.

**Placeholder scan:** полный код теста, целевой marketplace.json, точные old/new README приведены. Плейсхолдеров нет.

**Type consistency:** структура `hooks.json` (`{hooks:{SessionStart}}`) сверена с `plugins/glue/hooks/hooks.json`. Поля marketplace (`plugins[].name/source`) сверены с текущим `.claude-plugin/marketplace.json`. Пути теста (`HERE/../..` = plugins, `/../../..` = repo root) выверены.

## Deviations log

(пусто — заполняется при отклонениях по ходу исполнения)
