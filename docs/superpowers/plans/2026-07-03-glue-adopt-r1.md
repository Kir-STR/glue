# Glue R1 — adopt (семантический init) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести `glue` до семантического adopt: манифест v2 с per-module `decision`, authored-targets через существующий `applyPlan`, `status` без ложного drift, скилл-протокол P0–P5, уход `--force`.

**Architecture:** Четыре последовательных child-PR (зонтичный план): **A** — сквозное удаление `force` (CLI/движок/тесты/скилл); **B** — shared-contract change manifest v2 + co-update всех потребителей `m.modules` (`init` producer, `status`, `session-start`) + контракт-файл; **C** — adopt-движок (`src/adopt.mjs`: валидация авторского плана → authored writes → `applyPlan`) + подкоманда `glue adopt --plan <file>`; **D** — скилл `adopt` (P0–P5), обновление скилла `init`, релиз 0.3.0. Затем интерактивная dogfood-фаза E на самом репо. Спека: `docs/superpowers/specs/2026-07-02-glue-adopt-init-design.md` (состояние `b646f86`).

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, без внешних зависимостей. Windows/PowerShell локально; CI матрица ubuntu/windows × Node 22/24.

## Global Constraints

- **Порядок PR строгий A → B → C → D**, каждый — свой worktree + ветка + PR + merge-гейт (CI зелёный 4 ячейки + оператор буквальное «мержь»). Merge `gh pr merge N --rebase`. После merge — retro-файл, teardown-гейт.
- **Sensitive-paths pre-flight (зонтичный, `subagent-dispatch`):** секция `CLAUDE.md § «Sensitive paths gate»` в проекте **отсутствует** → список чувствительных путей пуст, sweep вакуумно пройден (зафиксировано 2026-07-03).
- **Тесты:** полный прогон `npm test` (glob-форма закреплена в `scripts.test`); одиночный файл `node --test plugins/glue/test/<name>.test.mjs`. Каждый PR уходит с зелёным полным прогоном.
- **Верификация shared-contract (PR B):** статического слоя типов нет — grep-sweep всех потребителей `m.modules` / `m.files` (`grep -rn "\.modules" plugins/glue/src`) + полный test-suite (спека § Manifest v2 «Shared-contract change»).
- **Simplify pass** перед каждым PR (push+PR только после триажа с оператором); 0 применённых правок → без пустого коммита (`pr-policy`).
- **Имена** (файлы, ветки, ключи JSON) — ASCII; контент правил/скиллов — русский; CLI-ошибки — английские (стиль соседей в `bin/glue.mjs`).
- **Бюджет PR** (`pr-policy`): target 400 / cap 800 строк · 15 файлов, reviewable diff без lock/сгенерированного.
- **`files[]` манифеста — только written-файлы** (то, что записал `applyPlan`). `adopted-existing`/`local`/`declined` модули записей в `files[]` **не имеют** — их integrity живёт в git проекта, glue ими не владеет. (Решение плана в рамках спеки § Manifest v2: «по одному entry на каждый **управляемый** файл».)
- **Drift-eligibility (PR B):** файл с модулем → drift только при `decision === 'added-from-template'`; файл без модуля (инструкц-файлы) → drift только при непустом `sourceTemplate` (greenfield пишет из `.tmpl` → eligible; adopt авторит → `sourceTemplate: null` → ineligible). Реконструкция bundle-targets (`buildTargets`) — по **всем не-`local`** id модулей манифеста (инструкц-файлу нужен полный состав карты на момент записи; исключение `tailored` даёт ложный drift `CLAUDE.md`); `local`-id нет в bundle — исключаются; не-`local` id вне bundle → `catch` → `errors`. Eligibility — отдельно и без изменений.
- **Fallback-selection (`session-start`, PR B):** из v2-манифеста берутся `modules[].id`, **отфильтрованные по наличию в bundle registry** (`local`/чужие id пропускаются — лучший effort, не сваливаться в дефолты из-за них).
- **`referenceTemplate` (greenfield, PR B):** `registry[id].templates[0]` — весь текущий bundle одно-шаблонный; multi-template модуль вне объёма R1.
- **Adopt и TOCTOU (PR C):** расхождение диска с `expectedCurrentHash` — **ошибка** (`applyPlan` бросает → JSON `{ok:false,error}`, exit 1), не `conflicts`-массив: adopt-план строится на свежем P2-обзоре, расхождение = гонка.
- **Решения плана сверх спеки** — CLI-поверхность `glue adopt --plan <file>`, скоуп `files[]`, drift-правило для инструкц-файлов, фильтр fallback-selection — **утверждены оператором 2026-07-03** и внесены в спеку (`docs: correct`) до старта PR A.

## Deviations log

_(заполняется по ходу исполнения: отклонение → причина → sync-коммит)_

- **2026-07-04, PR A / A2 (косметика):** заголовок теста `'снятый правленный файл → conflict'` — удалена устаревшая приписка «(без force)» сверх буквы плана; ассерты не тронуты. Принято на spec-ревью A2.
- **2026-07-04, PR A / F4 (дефект плана, категория tooling):** commit-шаблоны плана использовали разделитель ` - ` вместо house-конвенции ` — `; коммиты A1/A3 ушли с ` - ` (историю не переписываем), шаблоны PR B/C/D поправлены (`docs: correct`).
- **2026-07-04, PR B / B1 (STOP → план-гэп):** бамп `SCHEMA_VERSION` сломал pre-existing ownership-тест `manifest.test.mjs` с захардкоженными версиями-литералами (`'1'` = usable, `'2'` = «будущая»); план не предусматривал миграцию фикстуры. Implementer корректно встал (BLOCKED, без коммита). Решение оператора: мигрировать фикстуры на v2, версионные кейсы убрать (покрыты новыми B1-тестами); план дополнен Step 3.5 (`docs: correct`).
- **2026-07-04, PR B / B2 (адаптация в классе Step 3.5):** pre-existing тест `runInit разрешает зависимости` ассертил строковую форму `modules` — адаптирован через `.map(m => m.id)`, суть ожиданий не менялась. Задокументировано implementer'ом, принято на spec-ревью.
- **2026-07-04, PR B / B3 (STOP → дефект плана и спеки, не implementer'а):** передача в `buildTargets` только `added-from-template`-id ломала реконструкцию инструкц-файла (`filterModuleBlocks` терял блоки `tailored`-модулей) → ложный drift `CLAUDE.md`. Implementer корректно встал (BLOCKED, без коммита). Решение оператора: reconstruction set = все не-`local` id; eligibility-фильтр без изменений; спека и план исправлены (`docs: correct` `3656df6`).
- **2026-07-04, PR B / simplify F4 (STOP → дефект контроллерского снипета):** тест «все модули local» обрезал `modules`, оставив `files[]` greenfield-формы (`sourceTemplate` у `CLAUDE.md`) — несогласованная фикстура давала законный drift. Исправление: adopt-реалистичная фикстура (`sourceTemplate: null` у инструкц-записи); ожидания не менялись. Попутно подтверждено исключение: `init.test.mjs` legacy-тест (foreign producerPack) намеренно НЕ мигрируется на v2 — тестирует legacy-путь.
- **2026-07-04, PR D / финальное ревью (дефекты план-текста, не исполнителей):** текст D1 писался до ужесточения валидатора PR C и разошёлся с контрактом движка. Исправлено тем же ходом (docs: correct + fix-коммит, план и файлы идентичны): sourceTemplate: null обязателен для инструкц-write'ов (иначе вечный ложный drift, спека § Status semantics); назван алгоритм хеша (sha256-hex) + однострочник; финальный гейт переставлен ПЕРЕД команду; в P5 добавлены инварианты валидатора (forward-slash, связность write-таргетов); в P3 возвращена строка architectural-invariants из derive-vs-ask; уточнён контракт ошибки (поле error с префиксом TOCTOU abort:); «у local — без referenceTemplate, но с targetPaths»; в init-редирект добавлен AGENTS.md; plugin.json description упоминает /glue:adopt. Minor принятые: id в перечне полей, «движок»→CLI, дубль-хвост P3 убран. Minor отклонённые (не раздувать дифф): определение режима «улучшить» в P1; kind остаётся advisory-полем (решение оператора).

---

## File Structure

| Файл | PR | Ответственность |
|---|---|---|
| `plugins/glue/bin/glue.mjs` (modify) | A, C | −`--force` (+явная ошибка); +подкоманда `adopt --plan` |
| `plugins/glue/src/init.mjs` (modify) | A, B | −параметр `force`; producer modules-object[] (greenfield decisions) |
| `plugins/glue/src/plan.mjs` (modify) | A | −`force` из `decidePlan`/`plan` (мёртвые ветви) |
| `plugins/glue/skills/init/SKILL.md` (modify) | A, D | −гейт «повтор с `--force`»; +отсылка к adopt |
| `plugins/glue/src/manifest.mjs` (modify) | B | `SCHEMA_VERSION '2'`; `isUsablePrevManifest` проверяет форму `modules` |
| `plugins/glue/src/status.mjs` (modify) | B | `.map(x => x.id)` + drift-eligibility по `decision`/`sourceTemplate` |
| `plugins/glue/src/session-start.mjs` (modify) | B | fallback-selection: id из объектов + фильтр по registry |
| `plugins/glue/manifest.schema_v2.json` | B | контракт-файл манифеста v2 (F-09) |
| `plugins/glue/src/adopt.mjs` | C | `validateAdoptPlan` / `buildAuthoredWrites` / `runAdopt` |
| `plugins/glue/test/adopt.test.mjs` | C | тесты adopt-движка + CLI |
| `plugins/glue/skills/adopt/SKILL.md` | D | скилл-протокол P0–P5 |
| `plugins/glue/.claude-plugin/plugin.json` (modify) | D | версия 0.3.0 |
| тесты `decide/acceptance/init/manifest/status/session-start` (modify) | A, B | force-кейсы; v2-кейсы |

---

# PR A — `task-drop-force`: сквозное удаление `--force`

Ветка `task-drop-force` от `main`. Оценка: ~10 файлов, ~120 reviewable строк.

### Task A1: CLI — `--force` → явная ошибка

**Files:**
- Modify: `plugins/glue/bin/glue.mjs:54-67`
- Test: `plugins/glue/test/acceptance.test.mjs:91-108`

- [ ] **Step 1: Переписать падающий тест (кейс 6)**

В `acceptance.test.mjs` заменить тест `'6: правленный файл — конфликт без force; --force перезаписывает'` (строки 91–108) целиком на:

```js
test('6: правленный файл — конфликт; --force — явная ошибка CLI', (t) => {
  const dir = tmp(t)
  runCli(['init', '--modules', 'operator-gate'], dir)
  writeFileSync(join(dir, '.claude', 'rules', 'operator-gate.md'), 'РУЧНАЯ ПРАВКА', 'utf8')

  const second = runCli(['init', '--modules', 'operator-gate'], dir)
  assert.equal(second.exitCode, 0)
  const out = JSON.parse(second.stdout)
  assert.equal(out.ok, false)
  assert.equal(out.conflicts.length, 1)

  const forced = runCli(['init', '--force', '--modules', 'operator-gate'], dir)
  assert.equal(forced.exitCode, 1)
  const err = JSON.parse(forced.stdout)
  assert.equal(err.ok, false)
  assert.match(err.error, /--force removed/)
})
```

(Хелперы `tmp`/`runCli` уже есть в файле — сигнатуры сверить на месте; `tmp(t)` регистрирует `t.after`-cleanup, строка 24.)

- [ ] **Step 2: Прогнать — тест падает**

Run: `node --test plugins/glue/test/acceptance.test.mjs`
Expected: FAIL — `--force` сейчас принимается (exit 0, перезапись).

- [ ] **Step 3: Правка `bin/glue.mjs`**

В ветке `init` (строки 54–67): убрать `let force = false` и заменить ветку парсера:

```js
      if (a === '--force') throw new Error("--force removed: resolve conflicts manually or use semantic adopt ('replace' mode)")
```

Из вызова `runInit({...})` убрать `force,`. Комментарий usage (строка 54) — убрать `[--force]`.

- [ ] **Step 4: Прогнать acceptance — зелёный**

Run: `node --test plugins/glue/test/acceptance.test.mjs`
Expected: PASS (кейс 6 и остальные).

- [ ] **Step 5: Commit**

```bash
git add plugins/glue/bin/glue.mjs plugins/glue/test/acceptance.test.mjs
git commit -m "feat(glue): drop --force from CLI - explicit error with adopt hint"
```

### Task A2: движок — убрать параметр `force` из `runInit`/`plan`/`decidePlan`

**Files:**
- Modify: `plugins/glue/src/init.mjs:7,29,32-35`
- Modify: `plugins/glue/src/plan.mjs:23,56-57,69-70,127,139`
- Test: `plugins/glue/test/decide.test.mjs:37-43` (удаление force-теста), остальные тесты — механическая чистка `force: false`

- [ ] **Step 1: Удалить force-тест и прогнать**

В `decide.test.mjs` удалить тест `'force перезаписывает конфликт (expectedCurrentHash = current)'` (строки 37–43). Поведение «конфликт без force» уже покрыто соседними тестами.

- [ ] **Step 2: Правка `plan.mjs`**

`decidePlan` (строка 23): сигнатура `({ targets, prevManifest, diskHashFn })`. Удалить ветку `else if (force) { writeEntry(current) }` (строки 56–57) и ветку `else if (force) { deletes.push({ targetPath, expectedCurrentHash: current }) }` (строки 69–70). `plan` (строка 127): сигнатура без `force`; вызов `decidePlan({ targets, prevManifest, diskHashFn })` (строка 139).

- [ ] **Step 3: Правка `init.mjs`**

Строка 7: `export function runInit({ selected, engines, projectDir, now })`. Из вызова `plan({...})` убрать `force,` (строка 29). Conflict-gate (строки 32–35):

```js
  // Conflict-gate: при конфликтах диск не тронут (мутаций ещё не было).
  if (planResult.conflicts.length > 0) {
    return { manifest: null, conflicts: planResult.conflicts }
  }
```

- [ ] **Step 4: Механическая чистка тестов**

Убрать аргумент `force: false` из всех вызовов `runInit(...)` / `plan(...)` / `decidePlan(...)` в `test/{init,gate,session-start,status,plan,decide}.test.mjs`. **Не трогать** `rmSync(..., { force: true })` — это Node-API, не наш флаг.

- [ ] **Step 5: Grep-контроль + полный прогон**

Run: `grep -rn "force" plugins/glue/src plugins/glue/bin`
Expected: единственное вхождение — строка ошибки `--force removed` в `bin/glue.mjs`.
Run: `npm test`
Expected: PASS, все тесты (96 минус 1 удалённый force-тест = 95 на этом шаге).

- [ ] **Step 6: Commit**

```bash
git add plugins/glue/src plugins/glue/test
git commit -m "refactor(glue): remove dead force paths from engine"
```

### Task A3: `skills/init/SKILL.md` — убрать force-гейт

**Files:**
- Modify: `plugins/glue/skills/init/SKILL.md:22,30-33`

- [ ] **Step 1: Правка**

Шаг 4: `«Передай выбор явными флагами (без --force):»` → `«Передай выбор явными флагами:»`. Шаг 5, пункт про конфликты (строки 30–33) заменить на:

```markdown
   - `conflicts.length > 0` (`ok: false`, exit 0) → покажи каждый конфликт (`targetPath`, `reason` — напр. файл правлён вручную). Перезаписи нет: предложи оператору разрешить конфликт вручную (сохранить или убрать правки) и повторить `init`. Флаг `--force` удалён — CLI ответит ошибкой.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/glue/skills/init/SKILL.md
git commit -m "docs(glue): init skill - drop --force retry gate"
```

### Task A4: финализация PR A

- [ ] Simplify pass (4 агента, read-only, на закоммиченном коде) → триаж с оператором → отдельный коммит применённых правок (если 0 — без коммита).
- [ ] Push, PR `task-drop-force` (гейт оператора на создание PR), CI зелёный → merge-гейт («мержь») → retro-файл → teardown-гейт.

---

# PR B — `feat-manifest-v2`: shared-contract change + co-update

Ветка `feat-manifest-v2` от `main` (после merge A). Оценка: ~9 файлов, ~380 reviewable строк. **Все правки этого PR — один co-update**: промежуточные коммиты допустимы, но PR мержится только целиком зелёным.

### Task B1: `manifest.mjs` — schemaVersion '2' + форма `modules`

**Files:**
- Modify: `plugins/glue/src/manifest.mjs:4,26-30`
- Test: `plugins/glue/test/manifest.test.mjs`

- [ ] **Step 1: Падающие тесты**

Добавить в `manifest.test.mjs`:

```js
test('buildManifest пишет schemaVersion 2 и объектные modules round-trip', () => {
  const d = tmp()
  try {
    const modules = [{ id: 'operator-gate', decision: 'added-from-template', targetPaths: ['.claude/rules/operator-gate.md'], referenceTemplate: 'operator-gate.md' }]
    const m = buildManifest({ deliveryId: 'T', completedAt: 'T', engines: ['claude'], modules, files: [] })
    assert.equal(m.schemaVersion, '2')
    writeManifest(d, m)
    const r = readManifest(d)
    assert.deepEqual(r.modules, modules)
    assert.equal(isUsablePrevManifest(r), true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('v1-манифест (schemaVersion 1, string modules) → unusable', () => {
  assert.equal(isUsablePrevManifest({ schemaVersion: '1', modules: ['operator-gate'], files: [] }), false)
})

test('v2 с битыми modules (строки вместо объектов) → unusable', () => {
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', modules: ['operator-gate'], files: [] }), false)
})
```

- [ ] **Step 2: Прогнать — падают**

Run: `node --test plugins/glue/test/manifest.test.mjs`
Expected: FAIL (`schemaVersion` = '1'; строковые modules проходят usable).

- [ ] **Step 3: Реализация**

```js
export const SCHEMA_VERSION = '2'
```

`isUsablePrevManifest` (строки 26–30):

```js
// Можно ли доверять манифесту как prevManifest: наш формат и наш producer.
// v2: modules — объекты с string id (битые формы → false, не throw).
export function isUsablePrevManifest(m) {
  const files = m?.files ?? []
  const modules = m?.modules ?? []
  return !!m && m.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(files) && files.every((f) => f?.producerPack === PRODUCER) &&
    Array.isArray(modules) && modules.every((x) => typeof x?.id === 'string')
}
```

- [ ] **Step 3.5: Обновить pre-existing ownership-тест.** `manifest.test.mjs`, тест `'isUsablePrevManifest: glue → true, чужой producerPack → false'`: фикстуры мигрируют с v1-литералов на v2 — валидный glue-кейс: `schemaVersion: '2'`, `modules` — массив объектов с минимум `id`, `files` с glue `producerPack`; foreign producerPack остаётся `false`. Версионные ожидания из старого теста убрать — их покрывают три новых кейса B1 (v1 → unusable; v2 битые modules → unusable; v2 валидный → usable). Та же миграция (`'1'` → `'2'`) — для фикстур теста битых `files` (иначе кейсы падают в false по version-ветке раньше files-ветки, покрытие вакуумное); тот же принцип, отдельный `test(glue)`-коммит.

- [ ] **Step 4: Прогнать manifest-тесты — зелёные** (остальной suite на этом шаге красный — потребители ещё не co-updated; это ожидаемо внутри PR).

- [ ] **Step 5: Commit**

```bash
git add plugins/glue/src/manifest.mjs plugins/glue/test/manifest.test.mjs
git commit -m "feat(glue): manifest v2 — object modules with decision"
```

### Task B2: `init.mjs` — producer собирает modules-object[]

**Files:**
- Modify: `plugins/glue/src/init.mjs`
- Test: `plugins/glue/test/init.test.mjs`

- [ ] **Step 1: Падающий тест**

```js
test('greenfield-манифест v2: каждый модуль added-from-template', () => {
  const d = tmp()
  try {
    const { manifest } = runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
    assert.equal(manifest.schemaVersion, '2')
    const mod = manifest.modules.find((x) => x.id === 'operator-gate')
    assert.equal(mod.decision, 'added-from-template')
    assert.deepEqual(mod.targetPaths, ['.claude/rules/operator-gate.md'])
    assert.equal(mod.referenceTemplate, 'operator-gate.md')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
```

- [ ] **Step 2: Реализация**

В `init.mjs` перед `runInit` добавить и использовать в вызове `applyPlan` (`modules: toModuleEntries(registry, resolvedIds)`):

```js
// Greenfield: каждый модуль добавлен дословно из шаблона (спека § Manifest v2, Greenfield под v2).
// referenceTemplate = templates[0]: текущий bundle одно-шаблонный (Global Constraints).
function toModuleEntries(registry, ids) {
  return ids.map((id) => ({
    id,
    decision: 'added-from-template',
    targetPaths: registry[id].templates.map((f) => '.claude/rules/' + f),
    referenceTemplate: registry[id].templates[0],
  }))
}
```

`applyPlan`/`buildManifest` прозрачны к форме `modules` — правок там нет.

- [ ] **Step 3: Прогнать init-тесты — зелёные**; Commit:

```bash
git add plugins/glue/src/init.mjs plugins/glue/test/init.test.mjs
git commit -m "feat(glue): greenfield init writes manifest v2 decisions"
```

### Task B3: `status.mjs` — `.map(x => x.id)` + drift-eligibility

**Files:**
- Modify: `plugins/glue/src/status.mjs:37,46-60,62-78`
- Test: `plugins/glue/test/status.test.mjs`

- [ ] **Step 1: Падающие тесты**

```js
// Хелпер: manifest v2 с заданным decision для одного управляемого файла.
function seedAdoptLike(d, decision) {
  runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
  const p = join(d, '.glue', 'manifest.json')
  const m = JSON.parse(readFileSync(p, 'utf8'))
  m.modules.find((x) => x.id === 'operator-gate').decision = decision
  // Контент отличается от шаблона → кандидат в drift.
  const target = join(d, '.claude', 'rules', 'operator-gate.md')
  writeFileSync(target, 'ПРОЕКТНАЯ ВЕРСИЯ', 'utf8')
  m.files.find((f) => f.targetPath === '.claude/rules/operator-gate.md').writtenHash = hashContent('ПРОЕКТНАЯ ВЕРСИЯ')
  writeFileSync(p, JSON.stringify(m), 'utf8')
}

test('drift: added-from-template с отличием от шаблона → drift', () => {
  const d = tmp()
  try {
    seedAdoptLike(d, 'added-from-template')
    const s = deliveryStatus(d)
    assert.deepEqual(s.drift, ['.claude/rules/operator-gate.md'])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('drift: tailored-from-template с отличием от шаблона → НЕ drift', () => {
  const d = tmp()
  try {
    seedAdoptLike(d, 'tailored-from-template')
    const s = deliveryStatus(d)
    assert.deepEqual(s.drift, [])
    assert.deepEqual(s.errors, [])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('drift: local-модуль (id вне bundle) не роняет рехеш', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
    const p = join(d, '.glue', 'manifest.json')
    const m = JSON.parse(readFileSync(p, 'utf8'))
    m.modules.push({ id: 'retro-loop', decision: 'local', targetPaths: ['.claude/rules/retro-loop.md'] })
    writeFileSync(p, JSON.stringify(m), 'utf8')
    const s = deliveryStatus(d)
    assert.deepEqual(s.errors, [])
  } finally { rmSync(d, { recursive: true, force: true }) }
})
```

(Импорт `hashContent` из `../src/hash.mjs` добавить в шапку теста.)

- [ ] **Step 2: Реализация**

В `deliveryStatus` после `const writtenByPath = ...` (строка 37) добавить:

```js
  const moduleByPath = new Map()
  for (const mod of m.modules ?? []) {
    for (const tp of mod.targetPaths ?? []) moduleByPath.set(tp, mod)
  }
```

Drift-блок (строки 46–60): в `buildTargets` передавать только шаблонные модули и фильтровать по eligibility:

```js
  // drift через текущий plannedHash (buildTargets); ошибка → errors, drift пуст.
  // Eligibility: модульный файл — только decision 'added-from-template';
  // безмодульный (инструкц-) — только если писался из шаблона (sourceTemplate).
  const drift = []
  let plannedByPath = null
  try {
    const contract = loadContract(PLUGIN_ROOT)
    const registry = loadBundle(PLUGIN_ROOT, contract)
    // Реконструкция — полный состав карты на момент записи: все не-local id
    // (local нет в bundle; не-local id вне bundle → catch → errors — сигнал битости).
    const bundleIds = (m.modules ?? []).filter((x) => x.decision !== 'local').map((x) => x.id)
    const { targets } = buildTargets({ registry, modules: bundleIds, engines: m.engines ?? [], contract, pluginRoot: PLUGIN_ROOT })
    plannedByPath = new Map(targets.map((t) => [t.targetPath, t.plannedHash]))
    for (const f of files) {
      const planned = plannedByPath.get(f.targetPath)
      if (planned === undefined || planned === f.writtenHash) continue
      const mod = moduleByPath.get(f.targetPath)
      const eligible = mod ? mod.decision === 'added-from-template' : !!f.sourceTemplate
      if (eligible) drift.push(f.targetPath)
    }
  } catch (e) {
    errors.push(`drift не вычислен: ${e.message}`)
  }
```

В engines-цикле (строки 62–78) ветка drift — с той же оговоркой по `sourceTemplate`: `written` берётся как раньше, но для drift-ветки нужен file-entry. Заменить `writtenByPath` на `fileByPath = new Map(files.map((f) => [f.targetPath, f]))` (и `written = fileByPath.get(targetPath)?.writtenHash`), ветка drift:

```js
    else if (planned !== undefined && planned !== written && fileByPath.get(targetPath)?.sourceTemplate) status = 'drift'
```

- [ ] **Step 2.5: Миграция pre-existing фикстур потребителей** (тот же класс, что B1 Step 3.5): (а) `status.test.mjs` — тесты с рукотворными манифестами формы `modules: ['operator-gate']` (drift по writtenHash; битый bundle/unknown module) → v2-объекты (`[{ id, decision: 'added-from-template', targetPaths, referenceTemplate }]`; для unknown-module кейса id остаётся несуществующим — интент теста сохраняется); ожидания тестов не менять. (б) `acceptance.test.mjs`, тест 11 (status при неитерируемом `engines` → JSON `{ok:false}`, exit 1): рукотворный манифест `schemaVersion: '1'` → v2-форма (объектные `modules`, glue `producerPack`), `engines: 42` сохранить — интент (throw внутри status → JSON error) не менять.

- [ ] **Step 3: Полный прогон status-тестов — зелёные**; Commit (миграции фикстур — в этом же коммите):

```bash
git add plugins/glue/src/status.mjs plugins/glue/test/status.test.mjs plugins/glue/test/acceptance.test.mjs
git commit -m "feat(glue): status v2 — per-decision drift eligibility"
```

### Task B4: `session-start.mjs` — fallback-selection на v2

**Files:**
- Modify: `plugins/glue/src/session-start.mjs:19-25`
- Test: `plugins/glue/test/session-start.test.mjs`

- [ ] **Step 1: Падающие тесты**

```js
test('fallback: v2-манифест → выбор из manifest.modules, не дефолты', () => {
  const d = tmp()
  try {
    // versioning — НЕ default-модуль: тихий откат к дефолтам не совпадёт с ожиданием.
    runInit({ selected: ['versioning'], engines: ['claude'], projectDir: d, now: 'T' })
    rmSync(join(d, 'CLAUDE.md')) // ломаем native → fallback
    const r = runSessionStart(d)
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /версионировани/i)      // тело versioning.md инжектировано
    assert.doesNotMatch(ctx, /Operator-gate/) // дефолты НЕ подтянулись
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('fallback: local-модуль в манифесте не сваливает выбор в дефолты', () => {
  const d = tmp()
  try {
    runInit({ selected: ['versioning'], engines: ['claude'], projectDir: d, now: 'T' })
    const p = join(d, '.glue', 'manifest.json')
    const m = JSON.parse(readFileSync(p, 'utf8'))
    m.modules.push({ id: 'retro-loop', decision: 'local', targetPaths: ['.claude/rules/retro-loop.md'] })
    writeFileSync(p, JSON.stringify(m), 'utf8')
    rmSync(join(d, 'CLAUDE.md'))
    const r = runSessionStart(d)
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /версионировани/i)      // выбранный модуль инжектирован
    assert.doesNotMatch(ctx, /Operator-gate/) // дефолты НЕ подтянулись
  } finally { rmSync(d, { recursive: true, force: true }) }
})
```

(Regex сверить с реальным телом `versioning.md` / заголовком `operator-gate.md` на месте; проверяется выбор, не проза. Дефолт-модули bundle: `operator-gate`, `secret-hygiene` — для теста выбора обязателен non-default, иначе тихий откат к дефолтам неотличим от успеха.)

- [ ] **Step 2: Реализация**

`selectFallbackModules` (строки 19–25):

```js
function selectFallbackModules(projectDir, registry) {
  const m = readManifest(projectDir)
  if (isUsablePrevManifest(m)) {
    // v2: объекты → id; local/неизвестные bundle id пропускаем (лучший effort,
    // не сваливаться в дефолты из-за них).
    const ids = (m.modules ?? []).map((x) => x.id).filter((id) => registry[id])
    try { return resolveDependencies(registry, ids) } catch { return resolvedDefaults(registry) }
  }
  return resolvedDefaults(registry)
}
```

- [ ] **Step 3: Полный прогон — `npm test` зелёный целиком** (co-update завершён); Commit:

```bash
git add plugins/glue/src/session-start.mjs plugins/glue/test/session-start.test.mjs
git commit -m "feat(glue): session-start fallback selects from manifest v2"
```

### Task B5: контракт-файл `manifest.schema_v2.json` + grep-sweep

**Files:**
- Create: `plugins/glue/manifest.schema_v2.json`
- Test: `plugins/glue/test/manifest.test.mjs` (дозапись)

- [ ] **Step 1: Контракт-файл** (нормативный артефакт, рантайм его не читает — валидатор-зависимость не заводим):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "glue delivery manifest v2",
  "type": "object",
  "required": ["schemaVersion", "deliveryId", "completedAt", "engines", "modules", "status", "files"],
  "properties": {
    "schemaVersion": { "const": "2" },
    "deliveryId": { "type": "string" },
    "completedAt": { "type": "string" },
    "status": { "enum": ["complete"] },
    "engines": { "type": "array", "items": { "type": "string" } },
    "modules": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "decision", "targetPaths"],
        "properties": {
          "id": { "type": "string" },
          "decision": { "enum": ["added-from-template", "tailored-from-template", "adopted-existing", "merged", "declined", "local"] },
          "targetPaths": { "type": "array", "items": { "type": "string" } },
          "referenceTemplate": { "type": ["string", "null"] }
        }
      }
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["producerPack", "packVersion", "targetPath", "writtenHash"],
        "properties": {
          "producerPack": { "type": "string" },
          "packVersion": { "type": "string" },
          "targetPath": { "type": "string" },
          "writtenHash": { "type": "string" },
          "sourceTemplate": { "type": ["string", "null"] }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Тест-страж** (лёгкий, без валидатора):

```js
test('manifest.schema_v2.json парсится и перечисляет все 6 decision', () => {
  const schema = JSON.parse(readFileSync(new URL('../manifest.schema_v2.json', import.meta.url), 'utf8'))
  assert.deepEqual(
    schema.properties.modules.items.properties.decision.enum,
    ['added-from-template', 'tailored-from-template', 'adopted-existing', 'merged', 'declined', 'local']
  )
})
```

- [ ] **Step 3: Grep-sweep потребителей**

Run: `grep -rn "\.modules" plugins/glue/src`
Expected: только `status.mjs` (`.map((x) => x.id)` / `moduleByPath`), `session-start.mjs` (`.map((x) => x.id)`), `plan.mjs:94` (`contract.modulesDir` — не манифест). Любое другое вхождение → разобрать до коммита.
Run: `npm test` — Expected: PASS полностью.

- [ ] **Step 4: Commit**

```bash
git add plugins/glue/manifest.schema_v2.json plugins/glue/test/manifest.test.mjs
git commit -m "feat(glue): manifest v2 contract file (F-09)"
```

### Task B6: финализация PR B

- [ ] Simplify pass → триаж → (коммит) → push, PR-гейт, CI, merge-гейт, retro-файл, teardown-гейт. (Как A4.)

---

# PR C — `feat-adopt-engine`: authored-targets + `glue adopt`

Ветка `feat-adopt-engine` от `main` (после merge B). Оценка: ~4 файла, ~320 reviewable строк.

**Бриф implementer'у (из триажа PR A, F3):** не переиспользовать имя/семантику `force` ни в каких параметрах adopt-движка — деструктуризация JS молча глотает лишние/одноимённые ключи, конфликтующая семантика не всплывёт ошибкой.

### Task C1: `src/adopt.mjs` — валидация + builder + оркестратор

**Files:**
- Create: `plugins/glue/src/adopt.mjs`
- Test: `plugins/glue/test/adopt.test.mjs`
- Test: `plugins/glue/test/manifest.test.mjs` (key-set кросс-чек — перенос из quality-ревью B5)

**Step 0 (перенос из B5): key-set кросс-чек схемы против фактического producer'а** — дозаписать в `manifest.test.mjs` (ловит молчаливое устаревание контракт-файла при переименовании ключей в `toModuleEntries`/`toManifestFileEntry`):

```js
test('manifest.schema_v2.json: ключи реального манифеста ⊆ схемы', () => {
  const schema = JSON.parse(readFileSync(new URL('../manifest.schema_v2.json', import.meta.url), 'utf8'))
  const modProps = Object.keys(schema.properties.modules.items.properties)
  const fileProps = Object.keys(schema.properties.files.items.properties)
  const d = tmp()
  try {
    const { manifest } = runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
    for (const mod of manifest.modules) assert.deepEqual(Object.keys(mod).filter((k) => !modProps.includes(k)), [])
    for (const f of manifest.files) assert.deepEqual(Object.keys(f).filter((k) => !fileProps.includes(k)), [])
  } finally { rmSync(d, { recursive: true, force: true }) }
})
```

(Импорт `runInit` в manifest.test добавить при отсутствии.)

**Interfaces:**
- Consumes: `hashContent` (`hash.mjs`), `applyPlan` (`apply.mjs`), `readPluginVersion`/`PLUGIN_ROOT` (`bundle.mjs`), `KNOWN_ENGINES`/`engineTarget` (`plan.mjs`).
- Produces: `runAdopt({ adoptPlan, projectDir, now }) → { manifest }`; бросает на невалидном плане/TOCTOU/symlink/зоне.
- **Валидация (дополнено по ревью C1 и финальным ревью PR C, утверждено оператором):** + уникальность `writes[].targetPath`; + связность — каждый write-таргет ∈ ∪`modules[].targetPaths` либо инструкц-таргет **заявленного** движка (`engineTarget` по `p.engines`); + только forward-slash в путях; + `.glue/` закрыта для writes; + уникальные `id` модулей, строковые `targetPaths`, `declined` только с `targetPaths: []`; кросс-чек `DECISIONS` ↔ enum схемы; regression на валидный `writes: []` (modules-only). Backlog (вне R1): re-adopt deletes/сжатие; канонизация `..`; вынос `runCli` в общий тест-хелпер (маркер 2/3); имя файла в JSON.parse-ошибках CLI.

**Форма adopt-плана (вход, авторится скиллом):**

```json
{
  "engines": ["claude"],
  "modules": [
    { "id": "safety", "decision": "tailored-from-template",
      "targetPaths": [".claude/rules/safety.md"], "referenceTemplate": "safety.md" },
    { "id": "retro-loop", "decision": "local", "targetPaths": [".claude/rules/retro-loop.md"] }
  ],
  "writes": [
    { "targetPath": ".claude/rules/safety.md", "content": "…согласованный текст…",
      "sourceTemplate": "safety.md", "kind": "rule", "expectedCurrentHash": "хеш-увиденного-P2|null" }
  ]
}
```

- [ ] **Step 1: Падающие тесты**

`plugins/glue/test/adopt.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runAdopt } from '../src/adopt.mjs'
import { hashContent } from '../src/hash.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-adopt-')) }

const MODS = [
  { id: 'safety', decision: 'tailored-from-template', targetPaths: ['.claude/rules/safety.md'], referenceTemplate: 'safety.md' },
  { id: 'retro-loop', decision: 'local', targetPaths: ['.claude/rules/retro-loop.md'] },
  { id: 'glossary', decision: 'declined', targetPaths: [], referenceTemplate: 'glossary.md' },
]
function plan(writes) { return { engines: ['claude'], modules: MODS, writes } }

test('happy path: авторский текст записан, манифест v2 с decisions, declined без files', () => {
  const d = tmp()
  try {
    const { manifest } = runAdopt({
      adoptPlan: plan([{ targetPath: '.claude/rules/safety.md', content: 'ПРОЕКТНЫЙ ТЕКСТ', sourceTemplate: 'safety.md', kind: 'rule', expectedCurrentHash: null }]),
      projectDir: d, now: 'T',
    })
    assert.equal(readFileSync(join(d, '.claude', 'rules', 'safety.md'), 'utf8'), 'ПРОЕКТНЫЙ ТЕКСТ')
    assert.equal(manifest.schemaVersion, '2')
    assert.equal(manifest.modules.find((x) => x.id === 'glossary').decision, 'declined')
    assert.equal(manifest.files.length, 1)
    assert.equal(manifest.files[0].writtenHash, hashContent('ПРОЕКТНЫЙ ТЕКСТ'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('TOCTOU: диск разошёлся с expectedCurrentHash → throw, диск не тронут', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(d, '.claude', 'rules', 'safety.md'), 'ИЗМЕНИЛОСЬ ПОСЛЕ ОБЗОРА', 'utf8')
    assert.throws(() => runAdopt({
      adoptPlan: plan([{ targetPath: '.claude/rules/safety.md', content: 'X', expectedCurrentHash: hashContent('ЧТО ВИДЕЛ P2') }]),
      projectDir: d, now: 'T',
    }), /TOCTOU abort/)
    assert.equal(readFileSync(join(d, '.claude', 'rules', 'safety.md'), 'utf8'), 'ИЗМЕНИЛОСЬ ПОСЛЕ ОБЗОРА')
    assert.equal(existsSync(join(d, '.glue', 'manifest.json')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('невалидный план: неизвестный decision / нет content / чужой движок → Invalid adopt plan', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({ adoptPlan: { engines: ['claude'], modules: [{ id: 'x', decision: 'kept', targetPaths: [] }], writes: [] }, projectDir: d, now: 'T' }), /Invalid adopt plan/)
    assert.throws(() => runAdopt({ adoptPlan: plan([{ targetPath: '.claude/rules/safety.md', expectedCurrentHash: null }]), projectDir: d, now: 'T' }), /Invalid adopt plan/)
    assert.throws(() => runAdopt({ adoptPlan: { ...plan([]), engines: ['borg'] }, projectDir: d, now: 'T' }), /Invalid adopt plan/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('запись вне разрешённой зоны → abort до мутаций', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: plan([{ targetPath: 'src/evil.md', content: 'X', expectedCurrentHash: null }]),
      projectDir: d, now: 'T',
    }), /outside allowed zone/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
```

- [ ] **Step 2: Прогнать — падают** (`adopt.mjs` не существует).

- [ ] **Step 3: Реализация `src/adopt.mjs`**

```js
import { hashContent } from './hash.mjs'
import { applyPlan } from './apply.mjs'
import { readPluginVersion, PLUGIN_ROOT } from './bundle.mjs'
import { KNOWN_ENGINES } from './plan.mjs'

export const DECISIONS = ['added-from-template', 'tailored-from-template', 'adopted-existing', 'merged', 'declined', 'local']

// Валидация авторского adopt-плана до любой мутации. Бросает с полной диагностикой.
export function validateAdoptPlan(p) {
  const errors = []
  if (!Array.isArray(p?.engines) || p.engines.some((e) => !KNOWN_ENGINES.includes(e))) {
    errors.push(`engines: array of known engines required (${KNOWN_ENGINES.join(', ')})`)
  }
  if (!Array.isArray(p?.modules) || p.modules.length === 0) errors.push('modules: non-empty array required')
  for (const m of p?.modules ?? []) {
    if (typeof m?.id !== 'string' || !m.id) errors.push('module: string id required')
    if (!DECISIONS.includes(m?.decision)) errors.push(`${m?.id}: unknown decision '${m?.decision}'`)
    if (!Array.isArray(m?.targetPaths)) errors.push(`${m?.id}: targetPaths array required`)
  }
  if (!Array.isArray(p?.writes)) errors.push('writes: array required')
  for (const w of p?.writes ?? []) {
    if (typeof w?.targetPath !== 'string' || !w.targetPath) errors.push('write: targetPath required')
    if (typeof w?.content !== 'string') errors.push(`${w?.targetPath}: string content required`)
    if (w?.expectedCurrentHash !== null && typeof w?.expectedCurrentHash !== 'string') {
      errors.push(`${w?.targetPath}: expectedCurrentHash must be hash or null`)
    }
  }
  if (errors.length) throw new Error('Invalid adopt plan:\n' + errors.join('\n'))
  return p
}

// Authored-targets: writes[]-entries для applyPlan из авторского контента
// (plannedHash = hash(текста); TOCTOU — по expectedCurrentHash из P2-обзора).
export function buildAuthoredWrites(writes) {
  return writes.map((w) => ({
    targetPath: w.targetPath,
    plannedHash: hashContent(w.content),
    content: w.content,
    sourceTemplate: w.sourceTemplate ?? null,
    kind: w.kind ?? 'rule',
    expectedCurrentHash: w.expectedCurrentHash,
  }))
}

// Оркестратор adopt: validate → authored writes → applyPlan (манифест v2 последним).
// Расхождение диска с expectedCurrentHash — ошибка (гонка), не conflicts: план строится
// на свежем P2-обзоре.
export function runAdopt({ adoptPlan, projectDir, now }) {
  const p = validateAdoptPlan(adoptPlan)
  const manifest = applyPlan({
    plan: { writes: buildAuthoredWrites(p.writes) },
    projectDir,
    engines: p.engines,
    modules: p.modules,
    packVersion: readPluginVersion(PLUGIN_ROOT),
    deliveryId: now,
    completedAt: now,
  })
  return { manifest }
}
```

- [ ] **Step 4: Прогнать adopt-тесты + `npm test` — зелёные.**

- [ ] **Step 5: Commit**

```bash
git add plugins/glue/src/adopt.mjs plugins/glue/test/adopt.test.mjs
git commit -m "feat(glue): adopt engine — authored targets through applyPlan"
```

### Task C2: CLI `glue adopt --plan <file>`

**Files:**
- Modify: `plugins/glue/bin/glue.mjs`
- Test: `plugins/glue/test/adopt.test.mjs` (дозапись CLI-кейсов)

- [ ] **Step 1: Падающие CLI-тесты** (хелпер запуска CLI скопировать по образцу `acceptance.test.mjs` — `spawnSync` с `CLAUDE_PROJECT_DIR`):

```js
test('CLI adopt: --plan file → ok:true, manifest в stdout', () => {
  const d = tmp()
  try {
    const planPath = join(d, 'adopt-plan.json')
    writeFileSync(planPath, JSON.stringify(plan([{ targetPath: '.claude/rules/safety.md', content: 'T', sourceTemplate: 'safety.md', kind: 'rule', expectedCurrentHash: null }])), 'utf8')
    const r = runCli(['adopt', '--plan', planPath], d)
    assert.equal(r.exitCode, 0)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, true)
    assert.equal(out.manifest.schemaVersion, '2')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('CLI adopt: нет --plan / битый JSON → JSON error, exit 1', () => {
  const d = tmp()
  try {
    const r1 = runCli(['adopt'], d)
    assert.equal(r1.exitCode, 1)
    assert.equal(JSON.parse(r1.stdout).ok, false)
    const bad = join(d, 'bad.json')
    writeFileSync(bad, '{оборвано', 'utf8')
    const r2 = runCli(['adopt', '--plan', bad], d)
    assert.equal(r2.exitCode, 1)
    assert.equal(JSON.parse(r2.stdout).ok, false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
```

- [ ] **Step 2: Реализация — ветка в `bin/glue.mjs`** (перед финальным `else`; `readFileSync` добавить в импорты из `node:fs`):

```js
} else if (cmd === 'adopt') {
  // glue adopt --plan <file.json> — исполнить авторский adopt-план (контент авторит скилл).
  // JSON всегда: успех → exit 0; невалидный план/TOCTOU/зона → exit 1.
  try {
    const flags = process.argv.slice(3)
    let planArg = null
    for (let i = 0; i < flags.length; i++) {
      const a = flags[i]
      if (a === '--plan') { planArg = flagValue(flags, i, '--plan'); i++ }
      else throw new Error(`Unknown argument: ${a}`)
    }
    if (planArg === null) throw new Error('Missing required --plan')
    const adoptPlan = JSON.parse(readFileSync(planArg, 'utf8'))
    const { manifest } = runAdopt({ adoptPlan, projectDir: PROJECT_DIR, now: new Date().toISOString() })
    process.stdout.write(JSON.stringify({ ok: true, manifest }, null, 2) + '\n')
    process.exit(0)
  } catch (e) { emitError('adopt', e) }
}
```

Комментарий-шапку файла (строка 3) дополнить: `init (срез 4), adopt (R1)`.

- [ ] **Step 3: `npm test` — зелёный**; Commit:

```bash
git add plugins/glue/bin/glue.mjs plugins/glue/test/adopt.test.mjs
git commit -m "feat(glue): adopt subcommand — execute authored plan file"
```

### Task C3: финализация PR C

- [ ] Simplify pass → триаж → push, PR-гейт, CI, merge-гейт, retro-файл, teardown-гейт.

---

# PR D — `feat-adopt-skill`: скилл-протокол P0–P5 + релиз 0.3.0

Ветка `feat-adopt-skill` от `main` (после merge C). Оценка: ~4 файла, контент + 2 строки версии.

### Task D1: `skills/adopt/SKILL.md`

**Files:**
- Create: `plugins/glue/skills/adopt/SKILL.md`

- [ ] **Step 1: Написать скилл** (полный текст; структура и дисциплина — по образцу `skills/init/SKILL.md`, протокол — спека § Skill protocol):

````markdown
---
name: adopt
description: Семантически подключить Glue к проекту с существующими правилами — обзор существующего, точечные диффы на базлайне, per-module решения, манифест v2. Не перезаписывает молча.
disable-model-invocation: true
allowed-tools: Bash(node:*), Read, Grep, Glob, Write, Task, AskUserQuestion
---

Подключи Glue к проекту, у которого уже есть правила. Ты авторишь контент и решения; CLI — атомарный писатель (`glue adopt --plan`). Никогда не перезаписывай существующее молча.

**P0 — инвентарь.** Проверь наличие хотя бы одного инструкц-источника: `CLAUDE.md`, `AGENTS.md`, `.claude/rules/*`. Ни одного → этот скилл не нужен, отправь оператора в `/glue:init` (greenfield). Есть → перечисли найденное оператору.

**P1 — один гейт режима на весь набор.** Спроси оператора один раз: `улучшить` (дефолт) / `оставить` / `заменить`. `оставить` → работа только с недостающими модулями glue; `заменить` → существующие файлы становятся кандидатами на перезапись, но каждый — через P4-подтверждение. Per-module решения — не здесь, а в P4.

**P2 — обзор субагентом.** Диспатчни read-only субагента по источникам: `CLAUDE.md`, `AGENTS.md`, `.claude/rules/*`, `README.md`, `docs/**`, исходный код проекта. Мастер-шаблон glue — референс-чеклист: `node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" list` + тела модулей в `${CLAUDE_PLUGIN_ROOT}/content/modules/`. Субагент возвращает: (а) карту существующих правил → модулям glue (покрыто/частично/нет); (б) для каждого существующего файла — sha256-hex содержимого на момент обзора: `node -e "const{createHash}=require('crypto');const{readFileSync}=require('fs');console.log(createHash('sha256').update(readFileSync(process.argv[1],'utf8')).digest('hex'))" <файл>`; (в) **что не выводится из кода** — это вопросы P3. Гардрейлы: источник правды по архитектуре — код, не исторические доки; `.env*` не читать и не эхоить.

**P3 — добор пробелов.** AskUserQuestion только по тому, чего код не доказывает: неприменимость safety-разделов — утверждение оператора; неприменимость разделов architectural-invariants («тонкий транспорт», «изоляция внешних адаптеров») — подтверждение оператора; неочевидные переводы glossary — суждение оператора.

**P4 — дифф-предложение на базлайне.** Для каждого модуля glue покажи решение и дифф к существующему (существующий файл = базлайн): предложение + одна строка обоснования. Критерий строки: «уберёшь — агент начнёт ошибаться? нет → режь». Per-module accept/reject оператором. Итог каждого модуля — одно из: `added-from-template` / `tailored-from-template` / `adopted-existing` / `merged` / `declined`; существующие правила проекта вне модулей glue → `local` (сохраняются как есть).

**P5 — запись через CLI.** Собери adopt-план JSON (`engines` + `modules[]` в форме манифеста v2 + `writes[]`; отдельной схемы у adopt-плана нет):
- `modules[]` — все рассмотренные модули: `id`, `decision`, `targetPaths`, `referenceTemplate` (у `local` — без `referenceTemplate`, но с `targetPaths`; у `declined` — `targetPaths: []`);
- `writes[]` — только согласованные записи: `targetPath`, `content` (финальный текст целиком), `sourceTemplate` (имя шаблона; `null` для авторского текста — у инструкц-файлов (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`) всегда `null`, иначе `status` навсегда получит ложный drift), `kind` (`rule`/`instruction`), `expectedCurrentHash` (sha256-hex из P2-обзора; `null` для нового файла);
- инварианты валидатора: пути только с forward slash (даже на Windows); каждый `writes[].targetPath` заявлен модулем (∈ `modules[].targetPaths`) либо является инструкц-файлом заявленного движка; дубликаты таргетов и записи в `.glue/` отклоняются;
- карту модулей в инструкц-файлах движков (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`) правь тоже диффом (write с `expectedCurrentHash`), чтобы ссылалась на финальный набор, включая `local`.

Финальный гейт перед выполнением команды: покажи оператору полный список записей (пути + краткое описание изменений) и дождись подтверждения (UX-подтверждение; запись атомарна и обратима через git).

Запиши план во временный файл и выполни:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" adopt --plan <путь-к-плану.json>
```
Разбери JSON stdout. `ok: true` → покажи манифест (decisions, файлы). `ok: false` с полем `error`, начинающимся с `TOCTOU abort:` → файлы изменились после обзора: вернись к P2 для изменившихся, не перезапускай вслепую. Иная ошибка → покажи диагностику оператору.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/glue/skills/adopt/SKILL.md
git commit -m "feat(glue): adopt skill — P0-P5 protocol"
```

### Task D2: `skills/init/SKILL.md` — отсылка к adopt

**Files:**
- Modify: `plugins/glue/skills/init/SKILL.md`

- [ ] **Step 1:** В шаге 5 пункт про конфликты дополнить: `«…и повторить init — либо перейди на семантический adopt: `/glue:adopt` (существующие правила = базлайн, точечные диффы вместо перезаписи)»`. В шапку скилла (строка 8) добавить: `«Если в проекте уже есть правила (`.claude/rules/*`, `CLAUDE.md`, `AGENTS.md`) — сначала предложи `/glue:adopt`»`.

- [ ] **Step 2: Commit**

```bash
git add plugins/glue/skills/init/SKILL.md
git commit -m "docs(glue): init skill points conflicts to adopt"
```

### Task D3: релиз 0.3.0

**Files:**
- Modify: `plugins/glue/.claude-plugin/plugin.json` (version `0.3.0`)
- Modify: `.claude-plugin/marketplace.json` — только если содержит версию плагина (сверить на месте)

- [ ] **Step 1:** Бамп версии; `npm test` зелёный; сверить `readPluginVersion` — `packVersion` в манифестах станет `0.3.0`.

- [ ] **Step 2: Commit**

```bash
git add plugins/glue/.claude-plugin/plugin.json
git commit -m "chore(glue): release 0.3.0 — semantic adopt"
```

### Task D4: финализация PR D

- [ ] Simplify pass → триаж → push, PR-гейт, CI, merge-гейт, retro-файл, teardown-гейт.

---

# Фаза E — dogfood-прогон на репо glue (интерактивная, с оператором)

Не subagent-задача: P1/P3/P4 — операторские гейты. Выполняется в основной сессии после merge D.

- [ ] **Step 1:** Запустить `/glue:adopt` на самом репо. Ожидаемые решения (спека § Dogfood acceptance): 9 байт-в-байт модулей → `adopted-existing` (или `added-from-template` — решает оператор по диффу); `review-loop.md` (репо точнее шаблона) → `adopted-existing`, **не перетёрт**; `retro-loop.md` → `local`; `architectural-invariants`/`safety`/`glossary` → `tailored-from-template` (заполнены из кода/ответов) или явные N/A.
- [ ] **Step 2:** `node plugins/glue/bin/glue.mjs status` → **0 ложного drift**; `integrity` чистая; `errors: []`.
- [ ] **Step 3:** Изменения репо (заполненные правила, `.glue/manifest.json` — он не gitignored, идёт в git) — отдельный PR `task-dogfood-adopt` с операторским ревью содержания правил.
- [ ] **Step 4:** Acceptance-чек по 5 пунктам спеки § Dogfood acceptance; итоги — в retro; roadmap: R1 → done.

---

## Self-review (выполнен при написании)

- **Spec coverage:** Problem/`--force` → PR A; Manifest v2 + Greenfield + Shared-contract + F-09 → PR B; Architecture (authored-targets → `applyPlan`) → PR C; Status semantics → B3; Skill protocol P0–P5 + derive-vs-ask → D1; Migration/тест-план → задачи B, кейсы A1/B1–B5/C1–C2; Dogfood acceptance → фаза E.
- **За спекой (утверждено оператором 2026-07-03, внесено в спеку):** CLI-поверхность `adopt --plan`, `files[]` = только written, drift инструкц-файлов по `sourceTemplate`, фильтр fallback-selection по registry.
- **Type consistency:** `modules[]` объекты `{id, decision, targetPaths, referenceTemplate?}` едины в B1/B2/B3/C1/D1/schema; `writes[]` `{targetPath, content, sourceTemplate?, kind?, expectedCurrentHash}` едины в C1/C2/D1; `SCHEMA_VERSION '2'` — единственная константа сравнения.
