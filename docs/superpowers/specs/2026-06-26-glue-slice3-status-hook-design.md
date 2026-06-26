# Glue срез 3 — `status` + SessionStart-хук + fallback R1 (design)

**Дата:** 2026-06-26
**Статус:** рабочий design среза 3. Уточняет (не замещает) `2026-06-25-glue-single-plugin-collapse-design.md` (§ «Fallback-семантика R1», § «Манифест») и `2026-06-26-glue-slice2-engine-design.md` (переиспользует `buildTargets`/`isUsablePrevManifest`/`readManifest`).
**Решение:** перенести наблюдаемость доставки (`status`) и условный SessionStart-хук (native↔fallback) в greenfield-форму одного плагина — gate без версий, хук read-only, fallback инжектит тела правил из своего `content/`.

---

## Скоуп

**Входит** (`plugins/glue/src/` + `hooks/` + `bin/` + `test/`):

| Модуль | Ответственность |
|---|---|
| `gate.mjs` | `nativeDeliveryValid(projectDir) → boolean` — gate native↔fallback |
| `status.mjs` | `deliveryStatus(projectDir) → отчёт` — наблюдаемость доставки по всем движкам |
| `session-start.mjs` | `runSessionStart(projectDir) → {stdout, stderr, exitCode}` — тестируемое ядро хука |
| `hooks/hooks.json` | SessionStart → `bin/glue.mjs session-start` |
| `bin/glue.mjs` (modify) | подкоманды `status` + `session-start` (к существующей `list`) |
| `plan.mjs` (modify) | экспорт engine→instruction-targetPath хелпера (нужен `status`) |

**Не входит** (последующие срезы): SKILL.md `/glue:status` + `/glue:init` (срез 4), сквозной прогон 10 acceptance (срез 4), cutover + «ровно один хук» / деинсталл legacy (срез 5). Хук **активируется** этим срезом (`hooks.json`), но устранение второго (legacy) хука — срез 5.

---

## `nativeDeliveryValid` (gate)

```
nativeDeliveryValid(projectDir) → boolean
```

Узкий **Claude-gate** для решения inject↔молчать. Версия не участвует (collapse-design § «Манифест»: «bump версии layout не инвалидирует»). Переиспользует helpers из `manifest.mjs` (срез 2), **не дублирует** критерий:

1. `m = readManifest(projectDir)` (corrupt → null);
2. `isUsablePrevManifest(m)` → false → **false** (нет манифеста / `schemaVersion ≠ '1'` / есть file-entry с `producerPack ≠ 'glue'`);
3. `m.status === 'complete'` иначе → **false**;
4. есть file-entry с `targetPath === 'CLAUDE.md'` иначе → **false** (Claude-доставка неполна);
5. для **каждого** file-entry, чей `targetPath` — `CLAUDE.md` или под `.claude/rules/` (обязательные Claude-targets): файл существует на диске и `hashContent(file) === writtenHash`; иначе → **false**;
6. любой throw (path/read/hash) → **false** (fail-closed).

**Gate НЕ требует** `AGENTS.md`/`GEMINI.md`, даже если они в `manifest.engines` — полнота по движкам это забота `status`, не SessionStart (collapse-design § «Fallback-семантика»: иначе отсутствие `AGENTS.md` ложно включит Claude-fallback).

---

## `status` (наблюдаемость)

```
deliveryStatus(projectDir) → {
  mode: 'native' | 'fallback',                 // = nativeDeliveryValid(projectDir)
  reason: string,                              // почему такой mode (машинный код + человекочитаемо)
  missing: string[],                           // targetPath в манифесте, нет на диске
  changed: string[],                           // на диске, hash ≠ writtenHash (правлено вручную)
  drift:   string[],                           // текущий plannedHash ≠ writtenHash (контент пака обновился)
  engines: { [engine]: { status: 'ok'|'missing'|'changed'|'drift', targetPath } },  // по ВСЕМ manifest.engines
  errors:  string[],                           // ошибки вычисления (битый bundle/resolve/hash) — не роняют отчёт
  summary: string                              // человекочитаемая сводка
}
```

**Алгоритм:**
- `mode` = `nativeDeliveryValid(projectDir)` всегда (источник правды по gate).
- `m = readManifest(projectDir)`:
  - `m === null` → `reason: 'missing-or-unreadable-manifest'`, `missing/changed/drift: []`, `engines: {}`, `errors: []`, `summary` человекочитаемый. **Не бросать.**
  - `!isUsablePrevManifest(m)` → `reason: 'unusable-manifest'` (foreign/unsupported), пустые наборы, **не бросать**.
  - usable → полный отчёт (ниже).
- **`missing`/`changed`** — из манифеста + диска (без `buildTargets`): для каждого file-entry — нет на диске → `missing`; есть, но `hash ≠ writtenHash` → `changed`.
- **`drift`** — требует текущих `plannedHash`: `buildTargets({modules: m.modules, engines: m.engines, contract, pluginRoot})` в **try/catch**; успех → `plannedHash ≠ writtenHash` по `targetPath` → `drift`; **throw** (unknown module / missing template / bad engine) → `drift: []` + запись в `errors` (отчёт не падает).
- **`engines`** — по **всем** `m.engines` (вкл. `codex`/`gemini`): per-engine instruction `targetPath` (через хелпер `plan.mjs` engine→target); `status`: нет на диске → `missing`; `hash ≠ writtenHash` → `changed`; `plannedHash ≠ writtenHash` (если drift вычислен) → `drift`; иначе `ok`.
- `reason`/`summary` — `mode` отражает только Claude-gate; `summary` может различать («native for Claude; issues in codex/gemini»).

`drift` заменяет legacy `stale` (по `packVersion`) — сигнал «новее контент» по **хешам**, не по версии (collapse-design § «Манифест»).

---

## SessionStart-хук

```
runSessionStart(projectDir) → { stdout: string, stderr: string, exitCode: number }
```

Тестируемое ядро; `bin/glue.mjs session-start` — тонкая обёртка (пишет stdout/stderr, `process.exit(exitCode)`). **Хук read-only: НЕ пишет в проект** (важный инвариант — legacy `.glue/last-run.json` убрана; кросс-папочный риск, ради которого она писалась, в едином плагине снят).

- **native валиден** (`nativeDeliveryValid`) → `{ stdout: '{}', stderr: '', exitCode: 0 }`. Ноль `additionalContext`, ноль дубля, ноль шума (правила в `.claude/rules`, Claude читает сам).
- **native невалиден** → fallback:
  - **выбор модулей (R1):**
    - `m = readManifest`; если `m` **usable** (`isUsablePrevManifest(m)` — наш формат и наш `producerPack`) **и** `resolveDependencies(registry, m.modules ?? [])` успешно → эти resolved modules (в т.ч. `m.modules === []` → **пустой набор**, не defaults);
    - иначе (отсутствует/corrupt/unsupported/**foreign**/неразрешимо) → resolved **defaults** (`default:true` + их `dependsOn`);
    - **никогда не инжектить все** неявно;
    - _(уточнение по финальному ревью среза 3: выбор модулей переведён с «`schemaVersion === '1'`» на `isUsablePrevManifest(m)` — единый критерий «наш usable-манифест» во всём коде; хук больше не читает legacy/foreign-манифест как источник выбора, согласуется с принципом среза 2 «не читать legacy ради миграции». Асимметрия gate↔hook снята.)_
  - тела правил: `buildTargets({registry, modules, engines: [], contract, pluginRoot})` → `targets.filter(t => t.kind === 'rule')` → `content` этих rule-targets (с `engines:[]` инструкц-targets и так нет; фильтр — явная гарантия);
  - `stdout` = SessionStart JSON `{hookSpecificOutput:{hookEventName:'SessionStart', additionalContext}}`, где `additionalContext` = собранные тела правил (если набор пуст → честная заметка «правил не выбрано»);
  - `stderr` = короткая диагностика («native delivery inactive — запусти `/glue:init`»);
  - `exitCode: 0` (хук не валит сессию).
- **fail-closed:** любой throw в fallback-ветке ловится → деградированный, но валидный SessionStart-ответ + диагностика в stderr; exit 0.

### `hooks.json`

`SessionStart` event. Matcher **копируется verbatim из текущего формата плагина** (`plugins/glue-core/hooks/hooks.json`) — план сверяет по файлу, не из памяти (на момент design значение там — `startup|clear|compact`). Команда: `node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" session-start`, `async: false`.

---

## Сохранённые / снятые инварианты

**Сохранены:** условный native↔fallback (третьего пути нет, fail-closed); честная диагностика непокрытого; path-safety target (`safeTargetPath` в gate/status); мультидвижок (status по всем движкам).

**Сняты (greenfield):** скан `installed_plugins.json` / `discoverPacks` (gate/status/hook больше не принимают `packs`); `packVersion` в gate (валидность развязана от версии); чтение **чужих** паков и инъекция их правил (хук инжектит только свой `content/`); `.glue/last-run.json` трасса (хук read-only); `stale`-по-версии в status (→ `drift`-по-хешу).

---

## Тестирование

- **`gate.test`** — valid (полный native), invalid-ветки: нет манифеста, `schemaVersion ≠ '1'`, foreign `producerPack`, `status ≠ complete`, нет CLAUDE.md-entry, Claude-target отсутствует/hash-mismatch; AGENTS.md отсутствует но Claude валиден → **true** (gate не требует движков); throw → false.
- **`status.test`** — на temp `projectDir` + реальный bundle: native (всё ok); `missing`/`changed`/`drift` по отдельности; `engines` по всем движкам (codex/gemini); `mode='fallback'` + `reason` при отсутствующем/foreign манифесте (не бросает); `errors` непуст при битом наборе (напр. манифест с unknown module → buildTargets throw → drift []).
- **`session-start.test`** — native валиден → `stdout==='{}'`, stderr пусто, **диск не изменён** (read-only инвариант); fallback с usable-манифестом → инжект его modules; fallback без манифеста → defaults; usable-манифест с `modules: []` → инжект **пусто** (не defaults); fallback не бросает на битом bundle.

Полный прогон — glob: `node --test "plugins/glue/test/*.test.mjs"` (directory-форма на Node 24/Windows падает).

---

## PR

Срез 3 ≈ 9 файлов (`gate`/`status`/`session-start` + 3 теста + `hooks.json` + `bin` mod + `plan` mod) / ~400 reviewable строк → **1 PR** (`feat-glue-slice3-status-hook`). В `pr-policy` target 400 / cap 800·15. Код плагина — только worktree + PR. Simplify pass перед push.
