# Glue срез 5 — cutover (design, последний срез)

**Дата:** 2026-06-26
**Статус:** рабочий design. Реализует срез 5 (последний) из `2026-06-25-glue-single-plugin-collapse-design.md` §«Порядок поставки» (#5) и §«Cutover и миграция».
**Решение:** удалить legacy `glue-core`/`glue-rules`, переключить marketplace на единственный `glue`, синхронизировать README, закрепить repo-инвариант «ровно один SessionStart-хук» тестом; среду оператора перевести по рунбуку. Деструктивный класс — отдельные гейты.

---

## Контекст

Срезы 0–4 (все в `main`, `85e8cf9`) отгрузили единый плагин `glue` целиком: движок + status + хук + fallback R1 + CLI `init` + навыки `/glue:list`/`/glue:init`/`/glue:status` + сквозной acceptance (85/85). Legacy `glue-core` (34 файла) + `glue-rules` (19 файлов) продолжают лежать в `plugins/` и значатся в `.claude-plugin/marketplace.json` рядом с `glue`. До cutover legacy продолжает доставлять — окна потери нет (collapse-design §«Cutover»).

Этот dev-репо **не** glue-managed (правила в `.claude/rules/` рукописные) → удаление legacy-плагинов его собственные правила не ломает.

---

## Секция 1. Содержимое cutover-PR (один, деструктивный)

1. **Удалить** директории `plugins/glue-core/` + `plugins/glue-rules/` (53 файла суммарно).
2. **`.claude-plugin/marketplace.json`** — снять записи `glue-core` и `glue-rules`, оставить только `glue` (`source: ./plugins/glue`).
3. **`README.md` строки 5–9 (docs-sync к cutover, НЕ отдельный docs-PR)** — заменить трёх-паковый нарратив доставки («ships as glue-core + content packs, each depends on glue-core@glue») описанием единого плагина `glue` со встроенным контентом: сейчас наполнен вид P1 (Rules & Knowledge); P2 (Decisions & Constraints) и P3 (Support) — roadmap. Концептуальную онтологию и раздел «Repository» не трогать. README объясняет новое состояние marketplace/repo, поэтому входит в тот же PR.
4. **Repo acceptance-тест** `plugins/glue/test/cutover-hooks.test.mjs` (см. Секцию 4).

**НЕ трогаем:**
- `docs/superpowers/specs/*` и `docs/superpowers/plans/*` — исторические артефакты, read-only (CLAUDE.md §«Источники правды»); ссылки на legacy там описывают прошлое состояние, корректны.
- Литералы `glue-core`/`glue-rules` в `plugins/glue/test/*.test.mjs` (`status`/`gate`/`session-start`/`init`/`manifest`) — легитимные fixture'ы проверки отклонения foreign/legacy-манифеста (`producerPack: "glue-rules"` и т.п.); не зависят от существования legacy-директорий, остаются.

---

## Секция 2. PR-budget exception (дословно в design и в теле PR)

Удаление 53 файлов / ~2502 строк кратно превышает `pr-policy` (target 400, hard-cap 800 строк И 15 файлов). Зафиксированное исключение:

> PR-budget exception: cutover removes superseded legacy plugin trees `plugins/glue-core` and `plugins/glue-rules`. Reviewable risk is bounded by path scope and marketplace diff; deletion volume is mechanical and cannot be meaningfully split under cap because glue-core alone exceeds it.

Splitting отвергнут сознательно: `glue-core`/`glue-rules` концептуально удаляются вместе; `glue-core` один (1883 строки) всё равно превышает cap; отдельный de-list создаёт промежуточное «legacy-код в репо, но не в marketplace» без ценности. Review-нагрузка ограничена: проверить, что удалены ровно legacy-плагины и marketplace указывает только на `glue`.

---

## Секция 3. Repo safeguards + TDD

Перед удалением и после удаления выполняется полный сьют — оба прогона зелёные:
- полный `node --test "plugins/glue/test/*.test.mjs"` зелёный **до** удаления (с RED только на новом cutover-тесте, см. ниже);
- полный сьют зелёный **после** удаления legacy + правки marketplace;
- `marketplace.json` — валидный JSON;
- `plugins/glue-core` и `plugins/glue-rules` отсутствуют;
- `plugins/glue` остаётся;
- marketplace содержит только `glue`;
- one-hook/marketplace тест зелёный.

**TDD cutover-теста:** написать `cutover-hooks.test.mjs` (RED — `glue-core` тоже несёт `hooks/hooks.json` с SessionStart, и marketplace ещё содержит 3 записи) → удалить legacy + поправить marketplace (GREEN).

---

## Секция 4. `plugins/glue/test/cutover-hooks.test.mjs`

Repo-инвариант после cutover. Один файл, без размножения тестов. Сканирует дерево `plugins/` (два уровня вверх от каталога теста).

**Hook-инвариант (устойчив к отсутствию `hooks/`):**
- найти все `plugins/*/hooks/hooks.json`; плагины **без** `hooks/hooks.json` игнорировать (не падать на них);
- распарсить JSON каждого; собрать имена плагинов, у которых есть `hooks.SessionStart`;
- assert: этот набор `deepEqual ['glue']`.

**Marketplace-инвариант (тот же файл):**
- `marketplace.plugins.map((p) => p.name)` `deepEqual ['glue']`;
- запись `glue` имеет `source === './plugins/glue'`;
- `plugins/glue` существует; `plugins/glue-core` и `plugins/glue-rules` НЕ существуют.

Repo-тест ловит регресс в коде/раскладке; environment-инвариант (деинсталл на машине оператора) закрывается рунбуком (Секция 5) — это две разные поверхности, их не смешиваем.

---

## Секция 5. Operator runbook среды (spec + тело PR)

На машине оператора legacy-плагины могли быть установлены из старого marketplace/кэша — их надо снять отдельно (репо-удаление их не деинсталлирует). Порядок — через plugin manager среды, ручная чистка кэша только как fallback:

1. Обновить marketplace (`glue` маркетплейс).
2. Установить/обновить плагин `glue`.
3. Деинсталлировать `glue-core` и `glue-rules` командами plugin manager среды (uninstall/deinstall).
4. `/reload-plugins`.
5. Проверить, что активен **ровно один** SessionStart-хук — от `glue`.
6. Запустить `/glue:status` в тест-проекте (живой smoke доставки).
7. Fallback: если plugin manager оставил orphaned-кэш legacy — только тогда удалить кэш вручную.

---

## Секция 6. Гейты и завершение

- **Create PR** — outward-facing, отдельный гейт (буквальное «да»).
- **Merge** — деструктивный cutover, отдельный независимый буквальный гейт, форма report+STOP (не UX-модаль). Свежий пакет перепроверок между Gate 1 и Gate 2 (SHA, sensitive-paths, статус, тесты).
- После merge — 6/6 срезов, переписывание доставки П1 завершено. Дальнейшие слои (карта, retro-loop, provenance-граф+judge, Решения/Ограничения) — отдельный roadmap, вне этого среза.

Метод: `writing-plans` → SDD.

## Scope — что НЕ входит

Карта/визуализация, retro-loop, provenance-граф+judge, Решения/Ограничения как наполненные виды — последующие слои поверх (collapse-design §«Scope»). Этот срез закрывает только переключение доставки на единственный плагин.
