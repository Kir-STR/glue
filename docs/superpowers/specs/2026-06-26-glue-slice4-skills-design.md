# Glue срез 4 — skills + сквозной acceptance (design)

**Дата:** 2026-06-26
**Статус:** рабочий design. Реализует срез 4 из `2026-06-25-glue-single-plugin-collapse-design.md` §«Порядок поставки» (#4) и §«Acceptance-сценарии».
**Решение:** подключить готовые `runInit`/`deliveryStatus` к CLI-подкомандам + skills + доказать поведенческий контракт переписывания сквозным интеграционным тестом на 10 acceptance-сценариев.

---

## Контекст и границы

Срезы 0–3 (все в `main`, `6201b5d`) отгрузили движок целиком: `runInit({selected, engines, projectDir, force, now})` и `deliveryStatus(projectDir)` — программные, не CLI. `bin/glue.mjs` диспетчит `list`/`status`/`session-start`, но **не** `init`. Skill `/glue:list` — образец паттерна (`disable-model-invocation: true`, `allowed-tools: Bash(node:*)`, парсит JSON).

**Код движка не трогаем.** Срез 4 не меняет `src/` (`plan`/`apply`/`init`/`status`/`session-start`/`gate`/`manifest`/…) — единственное исключение, если acceptance вскроет regression (тогда — `docs: spec sync` + plan §Deviations log, не молчаливый фикс). Основной scope — **CLI wiring + skills + acceptance**. Проверка перед записью дизайна подтвердила: сценарий 7 (удаление снятого модуля) уже полностью реализован в срезе 2 (`decidePlan` `plan.mjs:63-74` + `applyPlan` `apply.mjs:66-69`) — это regression-тест, не доварка.

---

## Секция 1. Подкоманда `init` в `bin/glue.mjs`

Ветка `init` в тонком диспетчере — обёртка над `runInit`.

**Парсинг аргументов** — только после имени подкоманды (`argv.slice(1)`), чтобы флаги не путались с командой:
- `--modules a,b,c` — comma-separated, **обязателен** (skill всегда передаёт явный выбор; пустой выбор — не валидный init);
- `--engines claude,codex` — comma-separated, опционален → `runInit` дефолтит `['claude']`;
- `--force` — boolean-флаг, без значения;
- неизвестный флаг → JSON-ошибка + exit 1.

**`now`** — CLI генерирует `new Date().toISOString()` для `deliveryId`/`completedAt` (рантайм CLI, `Date` доступен).

**CLI не интерпретирует «defaults».** Вычисление дефолтов (`default:true` + их `dependsOn`) — забота skill через `list`; CLI получает explicit `--modules` и не знает о дефолтности.

**JSON-контракт (stdout всегда) + exit-коды:**

| Исход | stdout | exit |
|---|---|---|
| успех | `{ ok: true, manifest: {...}, conflicts: [] }` | 0 |
| конфликты без `--force` | `{ ok: false, manifest: null, conflicts: [{targetPath, reason}] }` | 0 |
| ошибка аргументов / unknown engine / unknown module | `{ ok: false, error: "..." }` (+ короткий stderr) | 1 |

Конфликт ≠ «команда сломалась» (exit 0): skill всегда парсит JSON и решает, что дальше. `runInit` бросает на unknown engine — ветка CLI оборачивает `try/catch` → `{ok:false,error}` + exit 1.

**`--help` / unknown / no command** → stdout `{ok:false, error:"..."}` + короткий stderr + exit 1, и **никогда** не дефолтит в `session-start` (ловит исторический баг «`--help` улетал в session-start»).

---

## Секция 2. Skills `/glue:init` + `/glue:status`

Оба — по образцу `/glue:list` (frontmatter: `disable-model-invocation: true`, `allowed-tools: Bash(node:*)`). Флаг гейтит только авто-инвокацию моделью (skill вызывается явной слэш-командой) — reasoning/вопросы внутри процедуры не запрещает.

**`/glue:status`** — тонкий, как `list`: `node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" status` → парсит JSON `deliveryStatus` → показывает `mode`/`reason`/`summary`, списки `missing`/`changed`/`drift`, покрытие по `engines` (все заявленные движки), `errors`. Read-only, без гейта.

**`/glue:init`** — мультишаговый, держит UX и operator-gate:
1. `glue list` → показать модули по группам, отметить `default:true`.
2. Спросить оператора: движки (`claude`/`codex`/`gemini`), модули (предложить дефолты **явным списком**).
3. **Gate (UX-подтверждение, не строгое «да»):** подтвердить выбор engines/modules + что Glue создаст/обновит управляемые файлы. Init пишет в `.claude/` — обратимая серия, недеструктивный класс.
4. `glue init --engines … --modules …` (без `--force`) → парсить JSON.
5. `ok:true` → показать манифест (доставленные движки, файлы). `conflicts.length>0` → показать конфликты (`targetPath`/`reason`) и **отдельным гейтом** (строгое буквальное «да» — перезапись ручных правок, деструктивный класс) спросить про повтор с `--force`. `--force` не добавляется автоматически.
6. `ok:false` + `error` → показать диагностику, не повторять вслепую.

**Skill читает только CLI JSON**, не прозу/stderr: `list`/`init`/`status` stdout парсятся как JSON; при ненулевом exit, но JSON-error в stdout — показать его; никогда не выводить успех из прозы/stderr.

---

## Секция 3. Сквозной интеграционный тест (10 acceptance через CLI)

Один файл `test/acceptance.test.mjs`. **Acceptance гоняется только через CLI:** все 10 сценариев + `--help`-regression — через `node plugins/glue/bin/glue.mjs <cmd>` (`child_process`), **не** через src-функции. Это доказывает проводку (аргументы, форма JSON, exit-коды), которую юниты срезов 2–3 не видят.

Хелпер `runCli(args, {projectDir})` → `{stdout, stderr, exitCode}` (через `CLAUDE_PROJECT_DIR`); парсинг stdout как JSON где применимо. Каждый тест — изолированный временный `projectDir`.

| # | Сценарий | Проверка |
|---|----------|----------|
| 1 | `list` | stdout JSON-массив `{id,title,group,default,note,dependsOn}`, exit 0 |
| 2 | `init` | `ok:true`, файлы `.claude/rules/*.md` + `CLAUDE.md` на диске, манифест записан |
| 3 | `status` | после init → `mode:native`, покрытие по всем заявленным движкам |
| 4 | `session-start` | native-валидно → stdout `{}` exit 0; снести target → fallback инжектит тела + stderr-диагностика, exit 0 |
| 5 | повторный `init` | идемпотентность: `текущий==plannedHash` → не конфликт, `ok:true` |
| 6 | правленный файл | руками изменить target → `init` без force → `ok:false`, `conflicts[]`, exit 0; затем `--force` → `ok:true` |
| 7 | снятый модуль | `init` без модуля → его неизменённый файл удалён; правленный → конфликт |
| 8 | `codex` в движках | `--engines claude,codex` → создан `AGENTS.md` (blocks-фильтрация) |
| 9 | неизвестный движок | `--engines borg` → `ok:false`, `error`, exit 1 |
| 10 | честный манифест | `manifest.engines` = только реально доставленные |
| — | `--help`-regression | `node bin/glue.mjs --help` → `ok:false`, `error`, exit 1; не дефолтит в session-start |

Покрывает баги из истории: `--help`→session-start (regression + #9), codex/AGENTS.md (#8), недоставленные engines в манифесте (#10).

**Caveat запуска (память срезов 2–3):** `node --test "plugins/glue/test/*.test.mjs"` — **только** glob-форма (directory-форма падает на Node 24/Windows).

---

## Scope — что НЕ входит

По collapse-design §«Scope»: срез 5 cutover (удаление legacy `glue-core`/`glue-rules`, marketplace-переключение, деинсталл), карта/retro-loop/provenance-граф/judge, Решения/Ограничения как наполненные виды.

## Дисциплина поставки

Код плагина → worktree + PR (`feat-glue-slice4-skills` от `origin/main`). Бюджет: ~5 reviewable-файлов (2 skills + bin-правка + 1 тест + plan) — в `pr-policy` (target 400). CI в репо нет → merge-гейт = локальные тесты (зелёные acceptance + 72/72 юнита) + ревью + оператор «мержь». Метод: `writing-plans` → SDD.
