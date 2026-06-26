# Glue срез 2 — движок `plan`/`apply`/`manifest` + `runInit` (design)

**Дата:** 2026-06-26
**Статус:** рабочий design среза 2. Уточняет (не замещает) `2026-06-25-glue-single-plugin-collapse-design.md` в части API-швов движка. Родительский design — источник правды по онтологии, снятым/сохранённым инвариантам и порядку срезов.
**Решение:** перенести «движок» из legacy `glue-core/lib/` в greenfield-форму одного плагина — без `discovery`/`mergePackRegistries`/скана реестра, с чистым швом `buildTargets`/`decidePlan` и программным `runInit` (не CLI).

---

## Скоуп

**Входит** (`plugins/glue/src/` + `plugins/glue/test/`):

| Модуль | Ответственность |
|---|---|
| `hash.mjs` | `hashContent` (sha256 hex) — порт verbatim |
| `paths.mjs` | `safeTargetPath` + `TARGET_ZONES`. **`safeSourcePath` выброшен** — источник из своего доверенного bundle |
| `resolve.mjs` | `resolveDependencies` — топосорт `dependsOn`, цикл/unknown → throw. Порт verbatim |
| `blocks.mjs` | `filterModuleBlocks` — вырезание `<!-- module:id -->`. `listModuleBlockIds` отложен в срез 3 (нужен только `status`) |
| `manifest.mjs` | `buildManifest`/`readManifest`/`writeManifest`/`isUsablePrevManifest`/`SCHEMA_VERSION`. `producerPack: "glue"`. `readManifest` робастен (corrupt JSON → null, не crash). Публикация последней (tmp + rename) |
| `plan.mjs` | `buildTargets`/`decidePlan`/`plan` + `KNOWN_ENGINES` + engine→instruction map |
| `apply.mjs` | `applyPlan` — batch preflight (TOCTOU + symlink-guard) до любой мутации, затем запись/удаление, манифест публикуется последним |
| `init.mjs` | `runInit` — программный API: resolve → plan → conflict-gate → apply |

**Не входит** (последующие срезы): CLI `glue init`, skill `/glue:init`, интерактивный выбор модулей, `status`, SessionStart-хук, fallback-семантика, marketplace/cutover.

---

## API-контракты (швы)

```
buildTargets({ registry, modules, engines, contract, pluginRoot })
   → { targets, deliveredEngines }
```
- читает `content/modules/*` и `content/instructions/*.tmpl` по путям из `contract` относительно `pluginRoot`;
- `modules` — **уже разрешённые** id (топосорт сделан в `runInit`), итерируется в порядке;
- для каждого модуля: rule-target на каждый файл из `templates[]`;
- для каждого движка: instruction-target из его `.tmpl`, прогнанный через `filterModuleBlocks(text, modules)`;
- `target = { targetPath, plannedHash, content, sourceTemplate, kind }`, `kind ∈ {'rule','instruction'}`;
- **провенанс не висит на target** — он константа (`"glue"` + версия), добавляется в манифесте;
- `deliveredEngines` — движки, для которых targets успешно построены (≡ запрошенным после валидации, см. инвариант ниже);
- **fail-fast:** неизвестный движок → `throw Unknown engine: x` до любого чтения; известный запрошенный движок без `.tmpl` в bundle → `throw` (битый bundle-инвариант, **не** silent skip).

```
decidePlan({ targets, prevManifest, diskHashFn, force })
   → { writes, materialized, deletes, conflicts }
```
- **ЧИСТАЯ** функция: не читает bundle, не знает про движки/файлы; только `targets` + `prevManifest` + `diskHashFn(targetPath)` + `force`;
- конфликт-алгоритм портирован 1:1 из legacy `planner.plan`:
  - `current === null` → **write** (`expectedCurrentHash: null`);
  - `current === plannedHash` → **materialized** (recovery: в манифест, не перезаписываем);
  - `writtenHash !== null && current === writtenHash` → **write** (update, `expectedCurrentHash: writtenHash`);
  - иначе (unmanaged или managed-но-расошёлся) → `force ? write(expected:current) : conflict('hash mismatch')`;
- удаление: target из `prevManifest`, отсутствующий в новом наборе → если `current === writtenHash` delete; `force` → delete(expected:current); иначе `conflict('dropped file hand-edited')`;
- записи `writes`/`deletes` несут `expectedCurrentHash` для TOCTOU; `materialized`/`writes` несут поля для манифеста (`targetPath`, `plannedHash`, `content`, `sourceTemplate`, `kind`).

```
plan({ registry, modules, engines, contract, pluginRoot, projectDir, force })
   → { writes, materialized, deletes, conflicts, deliveredEngines }
```
- тонкая композиция: `buildTargets` → **prevManifest-гейт** → `diskHashFn` → `decidePlan`;
- **prevManifest-гейт:** `const raw = readManifest(projectDir)` (сырой); `prevManifest = isUsablePrevManifest(raw) ? raw : null`. `isUsablePrevManifest(m)` = `m && m.schemaVersion === '1' && (m.files ?? []).every(f => f.producerPack === 'glue')`. Legacy/чужой/corrupt манифест → `null` → никакой «умной миграции»: byte-identical файлы → `materialized`, разошедшиеся → `conflict`, legacy-«лишние» файлы не удаляются (deletion смотрит только `prevManifest.files`);
- `diskHashFn = (rel) => хеш файла под safeTargetPath или null`.

```
runInit({ selected, engines, projectDir, force, now })
   → { manifest|null, conflicts }
```
- **движки:** `engines` пуст/не передан → `['claude']`; передан явно → валидировать как есть (**не** авто-добавлять `claude`);
- валидация `KNOWN_ENGINES` до диска (`Unknown engine: x`);
- `loadBundle()` (из `bundle.mjs`, срез 1) → `resolveDependencies(registry, selected)` → `resolvedIds`;
- `plan({ ..., modules: resolvedIds, force })`;
- **conflict-gate:** `conflicts.length > 0 && !force` → ранний возврат `{ manifest: null, conflicts }` (диск не тронут — `decidePlan` уже всё решил, мутаций ещё не было);
- иначе `applyPlan({ plan, projectDir, engines: deliveredEngines, modules: resolvedIds, deliveryId: now, completedAt: now })`;
- `now` — инъецируемый ISO-таймстемп (тестируемость).

---

## Провенанс и манифест

- провенанс — **константа**: `producerPack: "glue"`, `packVersion` = версия из `plugin.json` (читается один раз в `applyPlan`/`runInit`);
- `applyPlan` маппит `writes ∪ materialized` в file-entries манифеста, добавляя `producerPack`/`packVersion`; `writtenHash = plannedHash`;
- `manifest.engines = deliveredEngines` (честный набор, acceptance 10 — держится тем, что не раздуваем запрошенное);
- `manifest.modules = resolvedIds`;
- `manifest.status = 'complete'`, `schemaVersion = '1'`;
- `packVersion` — **чистый провенанс** (кто записал); в gate валидности (срез 3) не входит — валидность развязана от версии (родительский design § «Манифест»).

---

## Сохранённые инварианты (доказали ценность в legacy)

- **конфликт-детекция** — не перезаписывать правленные вручную файлы без `force`;
- **TOCTOU-защита** — `applyPlan` batch-проверяет хеши непосредственно перед мутацией; рассинхрон → abort до любой записи;
- **symlink-guard** — symlink в target → abort;
- **manifest published last** — публикуется последним через tmp + `renameSync`; preflight-abort (TOCTOU/symlink) оставляет диск нетронутым. Это **не** полнотранзакционная атомарность ФС: гарантия — «нет `status: complete` манифеста без полной записи файлов», а не «всё-или-ничего» при сбое посреди фазы записи;
- **толерантность к legacy/corrupt манифесту** — `readManifest` не падает на битом JSON (→ null); legacy/чужой манифест (`producerPack ≠ glue`) не используется как `prevManifest` (parent-design: «не читать legacy ради миграции»);
- **path-safety target** — `safeTargetPath` держит target внутри проекта и зон (`.claude/`, `.glue/`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`);
- **resolve зависимостей** — топосорт `dependsOn` (реально: `pr-policy`→`worktree-workflow`);
- **мультидвижок** — `blocks`-фильтрация под `claude`/`codex`(→`AGENTS.md`)/`gemini`.

## Снятые инварианты (greenfield свободен)

- скан `installed_plugins.json`, `discoverPacks`, `mergePackRegistries`, кросс-папочное чтение, qualified `pack:module` ID, коллизии между паками;
- `safeSourcePath` (source — свой bundle);
- **авто-форс `claude`** в набор движков (legacy `['claude', ...engines]`) — артефакт мульти-пакового мира;
- **silent-skip движка без `.tmpl`** (legacy `if (!existsSync) continue`) — хедж под чужие паки; в своём bundle отсутствие шаблона = битый инвариант → throw.

---

## Forward-notes (для среза 3, не решается здесь)

- **codex-only init:** не добавляя `claude` авто, получаем манифест без Claude-targets. Claude-gate хука (срез 3) вернёт `false` → fallback инжектит defaults в Claude-контекст. Согласуется с «guardrails by default» (init выбирает нативные файлы; хук всё равно прикрывает Claude), но «codex-only как стационар vs вечный Claude-fallback» — вопрос brainstorm среза 3.

---

## Тестирование

Юнит-тесты на синтетических данных (без temp-FS, кроме `apply`/integration):

- `hash` — детерминизм, hex;
- `paths` — зоны, escape `..`, абсолютный путь → throw;
- `resolve` — порядок, цикл, unknown;
- `blocks` — keep/drop/nested/stray/unclosed;
- `manifest` — build-форма, read отсутствующего → null, **read corrupt JSON → null (не throw)**, write→read round-trip, tmp-файл убран после rename; `isUsablePrevManifest`: glue-манифест → true, `producerPack: 'glue-rules'` → false, пустые files → true;
- `decidePlan` — все ветки (absent→write, ==plannedHash→materialized, ==writtenHash→update, mismatch→conflict, force→write/delete, delete-ветки);
- `buildTargets` — реальный bundle (10 модулей, 3 движка); unknown engine → throw; missing-template → throw (через temp `pluginRoot`/`contract`);
- `apply` — TOCTOU-abort, symlink-abort, атомарная публикация, recovery (materialized в манифесте);
- `init` — интеграционные на temp `projectDir` + реальный bundle: чистый init → файлы + манифест; повторный init → идемпотентность (materialized, не конфликт); правленный файл → конфликт без перезаписи; **legacy-манифест в проекте** (`producerPack: 'glue-rules'`, byte-identical файлы) → `runInit` не падает, файлы → materialized, манифест перезаписан в новом формате (`producerPack: 'glue'`).

Полный прогон — glob-форма: `node --test "plugins/glue/test/*.test.mjs"` (directory-форма на Node 24/Windows падает).

---

## Разбивка на PR (срез ≠ один PR; cap: 15 файлов / 800 reviewable строк)

≈16 файлов и ~900 строк пробивают cap → **срез 2 = 2 PR**:

- **PR A — примитивы + манифест:** `hash`/`paths`/`resolve`/`blocks`/`manifest` + тесты (~10 файлов, порт почти verbatim).
- **PR B — plan/apply/runInit:** `plan`/`apply`/`init` + `plan.test`/`apply.test`/`init.test` (~6 файлов, ядро логики).

Каждый PR — зелёный HEAD. Код плагина — только worktree + PR (`worktree-workflow`).

---

## Scope — что НЕ входит

`status` + staleness-сигнал, SessionStart-хук + fallback R1, CLI/skill `/glue:init`, интерактивный выбор, marketplace cutover, Решения/Ограничения как наполненные виды — последующие срезы (родительский design § «Порядок поставки»).
