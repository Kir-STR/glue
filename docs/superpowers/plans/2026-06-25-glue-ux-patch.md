# Glue UX-патч — engine-контракт + observability Implementation Plan

> Для агентов: исполнять через superpowers:subagent-driven-development, задача за задачей, ревью между.

**Goal:** Исправить engine-контракт `glue init` (баг codex→нет AGENTS.md, молчаливый приём неизвестных engine, врущий `manifest.engines`) и закрыть пробел наблюдаемости доставки (`/glue-core:status`), упростить `/glue-core:init` (стабильный `list --json` вместо импровизации агента). glue-core → 0.2.2. glue-rules НЕ меняется.

**Контекст:** срез 1 завершён (glue-core 0.2.1, glue-rules 0.2.1 в origin/main 4e26ef6). Тест на чистом проекте вскрыл: (1) `--engines codex` → файл не создан, но `codex` записан в манифест (маппинг ключа `agents`, не `codex`); (2) после `/clear` нативная доставка включается, но видимого сигнала нет (хук на native-пути молчит, трассу не пишет); (3) `/glue-core:init` без аргументов заставил агента импровизировать (`--help`, `find`, `ls`).

**НЕ в скоупе (явно):** НЕ срезать TOCTOU/recovery/конфликт-защиту (защищают записи в проект; YAGNI-рефактор мультидвижка — отдельное архитектурное решение). НЕ переносить `save`/`retro`. glue-rules без изменений.

**Tech Stack:** Node ESM, `node:*` only, `node:test`. Verification: glob-форма `node --test "plugins/glue-core/test/*.mjs"` (директорная падает на Node 24/Windows).

## Global Constraints
- Только `glue-core`. Бамп версии — в Task C (последней), чтобы промежуточные HEAD не рассинхронили версию с поведением.
- Каждый промежуточный HEAD зелёный по полному набору тестов.
- Engine — закрытое множество `{claude, codex, gemini}`. `codex` материализует `AGENTS.md` (шаблон пака `AGENTS.md.tmpl` имя НЕ меняет).

---

### Task A: engine-контракт (rename agents→codex, валидация, честный manifest.engines)

**Files:** Modify `plugins/glue-core/lib/planner.mjs`, `plugins/glue-core/lib/init.mjs`; Test `plugins/glue-core/test/planner.test.mjs` (+ кейсы), `plugins/glue-core/test/init.test.mjs` (+ кейсы).

**Изменения:**
1. `planner.mjs`: `ENGINE_INSTRUCTIONS` ключ `agents` → `codex` (значение `['AGENTS.md.tmpl','AGENTS.md']` без изменений). Экспортировать `export const KNOWN_ENGINES = Object.keys(ENGINE_INSTRUCTIONS)` (или массив `['claude','codex','gemini']`).
2. `plan()` возвращает дополнительно `deliveredEngines` — множество engine'ов, для которых инструкц-таргет реально запланирован (маппинг есть И `.tmpl` существует). Вычислять в `planTargets` (помечать engine у инструкц-таргета) и прокидывать в возврат `plan()`.
3. `init.mjs` `runInit`: ДО планирования валидировать `engines` — каждый ∈ `KNOWN_ENGINES`, иначе бросить понятную ошибку (`Unknown engine: <x>. Known: claude, codex, gemini`). `claude` всегда добавляется (как сейчас). В `applyPlan(... modules ...)` передавать `engines: plan.deliveredEngines` для манифеста (НЕ сырой ввод).

**Tests (TDD):**
- `codex engine materializes AGENTS.md`: `runInit({selected:['operator-gate'], engines:['claude','codex'], ...})` на фикстуре pack-a → среди manifest.files есть `targetPath:'AGENTS.md'`, и `manifest.engines` содержит `codex`. (pack-a инструкц-шаблон: см. ниже — фикстуре нужен `AGENTS.md.tmpl`.)
- `unknown engine rejected before planning`: `runInit({engines:['claude','bogus'],...})` → throws `/Unknown engine/`, ничего не записано.
- `manifest.engines lists only delivered`: engine без `.tmpl` в паке (или валидный, но шаблон отсутствует) не попадает в `manifest.engines`.
- Обновить существующие планнер/инит тесты под `codex` (если использовали `agents`).

**Фикстура:** `plugins/glue-core/test/fixtures/pack-a/rules/instructions/` сейчас имеет `CLAUDE.md.tmpl`. Добавить `AGENTS.md.tmpl` (с блоками alpha/beta) — иначе codex-тест не материализует файл. (Минимальное дополнение фикстуры; не трогает реальный пак.)

**Commit:** `fix(glue-core): engine contract — codex→AGENTS.md, reject unknown, honest manifest.engines`

---

### Task B: subcommands `status` + `list --json`

**Files:** Create `plugins/glue-core/lib/report.mjs` (или добавить в init.mjs); Modify `plugins/glue-core/bin/glue.mjs` (dispatch `status`, `list`); Test `plugins/glue-core/test/report.test.mjs`.

**Изменения:**
1. `deliveryStatus(projectDir, packs) → { mode, missing[], changed[], stale[], packs[], summary }`:
   - `mode`: `'native'` если nativeDeliveryValid иначе `'fallback'`.
   - `missing`: targets из манифеста, отсутствующие на диске; `changed`: present, но hash ≠ writtenHash; `stale`: файл, чей `packVersion` в манифесте ≠ установленной версии пака.
   - `packs`: `[{name, version}]` обнаруженные.
   - `summary`: человекочитаемая строка («native delivery active: N файлов» / «fallback: <причина>»).
   - Переиспользовать `readManifest`, `hashContent`, `discoverPacks`, логику `nativeDeliveryValid`.
2. `listModules(packs) → [{id, title, group, default, dependsOn}]` (из `mergePackRegistries`).
3. `bin/glue.mjs`: dispatch `status` → печатать `deliveryStatus` (JSON); `list` (с `--json`) → печатать `listModules` (JSON). Сохранить `init` и `session-start`.

**Tests (TDD):** `deliveryStatus` на фикстуре: до init → `mode:'fallback'`; после раскладки (writeManifest+файлы) → `mode:'native'`, пустые missing/changed; порча файла → `changed` непуст, `mode:'fallback'`. `listModules` → возвращает модули pack-a с полями.

**Commit:** `feat(glue-core): status + list subcommands (delivery observability)`

---

### Task C: skills (`/glue-core:status` новый, `/glue-core:init` переработка) + bump

**Files:** Create `plugins/glue-core/skills/status/SKILL.md`; Modify `plugins/glue-core/skills/init/SKILL.md`; Modify `plugins/glue-core/.claude-plugin/plugin.json` (→0.2.2), `.claude-plugin/marketplace.json` (описание).

**Изменения:**
1. `skills/status/SKILL.md` — `/glue-core:status`, `disable-model-invocation:true`, `allowed-tools: Bash(node:*)`: запустить `node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" status` и доложить `summary` + missing/changed/stale понятно. Без аргументов.
2. `skills/init/SKILL.md` переработка:
   - если `$ARGUMENTS` пуст — получить модули через `node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" list --json` (НЕ `--help`, НЕ `find`/`ls` по кэшу), предложить выбор оператору;
   - запустить `init $ARGUMENTS`;
   - **после init** автоматически запустить `status` и доложить вердикт: «native delivery подтверждена» либо конкретную причину fallback;
   - engine-значения в `argument-hint`: `claude,codex,gemini`.
3. Bump `glue-core` plugin.json → `0.2.2`, описание + marketplace-описание (упомянуть `/glue-core:status`).

**Commit:** `feat(glue-core): status skill + init skill rework (list/auto-status) + bump 0.2.2`

---

## Verification
- `node --test "plugins/glue-core/test/*.mjs"` зелёный после каждой задачи.
- Engine: codex→AGENTS.md (regression), unknown→reject, manifest честный.
- End-to-end smoke перед PR: `init --engines claude,codex,gemini` → CLAUDE.md+AGENTS.md+GEMINI.md; `status` → native; порча → fallback.
- Simplify pass + final whole-branch review перед PR.
