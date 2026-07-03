# Glue adopt — семантический init поверх существующих правил

**Статус:** дизайн-спека (R1 dogfood). Ведётся поверх roadmap (`roadmap_v1.md`) и онтологии концепта; их не переписывает. Описывает, как `glue` подключается к проекту, у которого **уже есть** правила, по образцу штатного `/init`, но с адаптацией «мы несём мастер-шаблоны с собой».

> **Языковая граница.** Спека — внутренний рабочий документ репо (русский). Не путать с продуктовым контентом (`content/*`).

## Problem

`glue init` на проекте с уже разложенными `.claude/rules/*` сейчас атомарен «всё-или-ничего» по хешам: любой файл, разошедшийся с поставляемым шаблоном, даёт `hash mismatch`, весь `init` откатывается до `apply` (`init.mjs:33`), манифест не пишется. Единственный обход — `--force` (слепая перезапись ручных правок). Это противоположность тому, что делает штатный `/init`.

Конкретно на самом репо glue (dogfood): `.claude/rules/` засеяны из `content/modules/` и дрейфнули — 9/10 модулей байт-в-байт совпадают, `review-loop.md` разошёлся на 2 строки (репо-версия точнее), `retro-loop.md` есть только в репо (не модуль glue), а `architectural-invariants.md`/`safety.md`/`glossary.md` до сих пор стоят с `TODO: заполнить под проект`.

**Цель.** `glue` при существующих правилах ведёт себя как `/init`: анализирует существующее + код/документы, **предлагает точечные улучшения на базлайне**, подтверждает, не перезаписывает молча. Отличие от `/init` — glue несёт **мастер-шаблон** как явный чеклист дисциплин и форм проектно-заполняемых секций.

**Две ситуации сходятся в одну.** «Правил нет» — стандартный greenfield-путь (де-скоуплен, не трогаем). «Правила есть» (включая «в точности наши») — семантический adopt. Дальше обе ветки — работа с одним набором правил.

**Не в объёме (YAGNI):** механизм per-project override (пока glue сам себе источник правды своих правил; вводим, когда появится внешний проект с расходящимися правилами); отчёт «template updates available»; открытая критика качества прозы правил (это R4 LLM-судья).

## Reference behavior — что реально делает `/init`

Извлечено из бинарника CLI v2.1.197 (`~/.local/share/claude/versions/2.1.197`), не из пересказа доков — это ground truth самого промпта команды. Воспроизводится: `grep -aboE` по якорям `Please analyze this codebase` (классический, ASCII) и `Set up a minimal CLAUDE` (новый multi-phase, UTF-16).

**Классический** (одна строка ДНК): *«If there's already a CLAUDE.md, suggest improvements to it.»* Читает не только код, а существующие инструкц-артефакты (README, `.cursor/rules`, `.github/copilot-instructions.md`) и вплетает «important parts». Анти-раздутость: не повторяйся, не пиши очевидное/generic, не перечисляй то, что видно в дереве, не выдумывай.

**Новый multi-phase** (`CLAUDE_CODE_NEW_INIT=1`):
- **Phase 0** — дешёвая проверка: существует ли `CLAUDE.md` в корне (только корень, дерево ещё не трогаем).
- **Phase 1** — при существующем файле **спрашивает режим** (один вопрос про набор): `Review and improve` / `Leave it` / `Start fresh (replace)`.
- **Phase 2** — обзор субагентом: манифесты, README, CI, **и все существующие инструкц-источники** (`CLAUDE.md`, `.claude/rules/`, `AGENTS.md`, cursor/copilot/windsurf/cline, `.mcp.json`). Ключевое: *«Note what you could NOT figure out from code alone — these become interview questions.»*
- **Phase 3** — добор пробелов: AskUserQuestion **только про то, чего код не отвечает**.
- **Phase 4** — правка существующего = **дифф, не перезапись**: *«the existing file is the baseline… propose specific additions/removals as diffs with a one-line reason… call AskUserQuestion ("Apply these edits?") before writing anything.»* Критерий на строку: *«Would removing this cause Claude to make mistakes? If no, cut it.»*

**Сквозной принцип** (для CLAUDE.md, rules, skills, local): прочитать существующее → предложить точечные диффы с обоснованием → подтвердить → **никогда молча не перезаписывать**.

## Architecture — единый путь записи

Агент решает и **авторит** финальное содержание (интеллект в скилле, как в `/init`); движок остаётся **атомарным писателем, TOCTOU-защитой и публикатором манифеста**. Один путь записи — не два писателя.

- **Мастер-шаблон** (`content/modules/`, `content/instructions/`) — переосмыслен как **референс-чеклист**: набор дисциплин + формы проектно-заполняемых секций. Не «байты на запись».
- **Переиспользуем нижний слой `apply.mjs`, а не `plan.mjs` как есть.** `apply.mjs:53` (`applyPlan`) контент-агностичен: пишет `entry.content`, кладёт `writtenHash: entry.plannedHash`, TOCTOU-гейт по `expectedCurrentHash`. Bundle-связка живёт только в `plan.mjs` (`buildTargets` берёт plannedHash из шаблона) — для adopt это неверная семантика.
- **Новый builder «authored targets»** — аналог `buildTargets`, но из авторского контента; выдаёт `writes[]`-entries для существующего `applyPlan`: `content` = согласованный оператором текст; `plannedHash = hash(этого текста)`; `expectedCurrentHash` = хеш того, что P2-обзор видел на диске (TOCTOU против правок между обзором и записью).
- `plan.mjs`/`buildTargets` остаются для greenfield-пути и как предохранитель «managed-файл изменился с последнего манифеста».

## Manifest v2

Манифест после adopt фиксирует не «эти файлы равны шаблону», а «эти дисциплины рассмотрены — вот как легли в проект».

```json
{
  "schemaVersion": "2",
  "producer": "glue",
  "deliveryMode": "adopt",
  "status": "complete",
  "engines": ["claude", "codex"],
  "modules": [
    { "id": "review-loop", "decision": "adopted-existing",
      "targetPaths": [".claude/rules/review-loop.md"], "referenceTemplate": "review-loop.md" },
    { "id": "safety", "decision": "tailored-from-template",
      "targetPaths": [".claude/rules/safety.md"], "referenceTemplate": "safety.md" },
    { "id": "retro-loop", "decision": "local",
      "targetPaths": [".claude/rules/retro-loop.md"] }
  ],
  "files": [
    { "producerPack": "glue", "targetPath": ".claude/rules/safety.md",
      "writtenHash": "…", "sourceTemplate": "safety.md" }
  ]
  /* files[] сокращён до одной записи; в реальности — по одному entry на каждый управляемый файл */
}
```

**`modules[].decision` — семантический слой:**
- `added-from-template` — дисциплины не было, добавили из glue **дословно** из шаблона.
- `tailored-from-template` — шаблон проектно заполнен по коду/докам/ответам оператора.
- `adopted-existing` — смысл уже покрыт существующим текстом, не дублируем.
- `merged` — существующий текст и шаблон сведены в один файл.
- `declined` — оператор явно отказался от модуля.
- `local` — правило есть в проекте, но не модуль glue; сохраняется как baseline.

**`files[]` — только целостность** (как сейчас: `producerPack`, `targetPath`, `writtenHash`, `sourceTemplate`). Поля `relation` **нет** — семантика живёт на `modules[]`, дублировать её на files не нужно; связь file→module выводится через `targetPath ∈ module.targetPaths`. Инструкц-файлы (`CLAUDE.md`/`AGENTS.md`) — files без модуля.

**Shared-contract change.** `schemaVersion "1" → "2"` с `modules: string[] → object[]` ломает потребителей: `buildTargets` ждёт `modules` как массив id (`registry[id]`), значит `status.mjs:52` и `init.mjs` требуют `.map(m => m.id)`; `isUsablePrevManifest` (`manifest.mjs:26`) сделает v1-манифесты `unusable` → fallback. Co-update `apply`/`status`/`init`/`gate` в одном шаге + полная статическая проверка (не unit-only), по `subagent-dispatch § shared-контракт`. Если есть отдельный JSON-schema контракт-файл манифеста — его версия бампается (`versioning.md`).

## Status semantics

`status` разделяет две вещи (частично уже в коде — `status.mjs`):
- **Integrity** — файл на диске всё ещё тот, что зафиксировал adopt? `missing`/`changed` (disk vs `writtenHash`, строки 40–44). Для adopt работает верно уже сейчас: сверяет с authored-хешем, а не с шаблоном.
- **Template drift** — отличается ли файл от текущего bundle? (строки 46–60 через `buildTargets`).

**Изменение:** drift-eligibility — **per-module по `decision`**, не по коарс-флагу. Считать bundle-drift **только** там, где файл записан дословно из шаблона (`decision == added-from-template`); для `tailored-from-template`/`adopted-existing`/`merged`/`local` — не считать. Иначе проектная версия (правильная, но не байт-в-байт равная шаблону) даёт **вечный ложный drift**. Смешанный проект (часть добавлена из шаблона дословно, часть заполнена) обрабатывается корректно: `added-from-template` остаётся drift-eligible.

## Skill protocol (P0–P5)

**Протокол скилла** (эволюция `skills/init`):
- **P0** — `.claude/rules/*` + `CLAUDE.md` есть → инвентарь; нет → де-скоуплено (greenfield-init).
- **P1** — **один гейт режима на весь существующий набор**: `улучшить` / `оставить` / `заменить` (дефолт `улучшить`). Per-module accept/reject — не здесь, а в P4 (ближе к `/init`, меньше UX-дробления).
- **P2** — направленный обзор субагентом (источники ниже).
- **P3** — AskUserQuestion только по пробелам, что код не выводит.
- **P4** — дифф-предложение на базлайне, обоснование на строку, **per-module** accept/reject, подтверждение до записи. `--force` как слепая перезапись уходит.
- **P5** — authored-targets → apply-слой → манифест v2 с `decisions`. Карту в `CLAUDE.md`/`AGENTS.md` правим диффом, чтобы ссылалась на финальный набор (включая `local`-правила).

**Источники обзора (P2):** `CLAUDE.md`, `AGENTS.md`, `.claude/rules/*`, `README.md`, `docs/**`, `plugins/glue/src/**`, `plugins/glue/content/**`, `plugins/glue/bin/glue.mjs`, `plugins/glue/test/**`. Гардрейлы: источник правды по архитектуре — **код `src/**`** (не исторические `docs/**` — read-only/контекст); `.env*` не читаем и не эхоим (`secret-hygiene`).

**Правило «вывести из кода» vs «спросить оператора»** (из `/init`: *note what you could NOT figure out → interview*): выводим то, что код доказывает; спрашиваем то, что не доказывает.

| Секция | Выводится из кода | Обязательно спросить оператора |
|---|---|---|
| **architectural-invariants** | границы слоёв (`bin/` = транспорт/CLI → `src/` = движок: чистые `plan/decidePlan/hash/paths/blocks` vs IO `apply/manifest/init` → `content/` = данные), конвенции импортов (ESM `.mjs`, относительные пути) — из графа `src/**` | подтвердить неприменимость разделов «тонкий транспорт»/«изоляция внешних адаптеров» (glue — CLI без внешних сервисов) → пометить N/A, не оставлять TODO |
| **safety** | эвиденс неприменимости: нет обработки ПД, нет consent-потока, нет kill-switch | **решение о неприменимости — оператора** (`safety.md`: «оператор проверяет и утверждает сам»). Код даёт доказательство, оператор владеет утверждением |
| **glossary** | кандидаты неочевидных терминов — из survey `.claude/rules/*` + `docs/**` | какие переводы неочевидны и принятый вариант — суждение оператора; вероятно минимально |

## Dogfood acceptance (первый прогон на репо glue)

1. `architectural-invariants.md`, `safety.md`, `glossary.md` — **больше не generic TODO** (заполнены из кода/ответов **или** явно помечены N/A с обоснованием).
2. `retro-loop.md` сохранён; манифест: `decision=local`.
3. `review-loop.md` **не перетёрт** — репо-версия = baseline (`decision=adopted-existing`).
4. Манифест v2 фиксирует per-module `decisions`.
5. `status` после прогона: **0 ложных drift** по `tailored-from-template`/`adopted-existing`/`merged`/`local`; `integrity` (`missing`/`changed`) работает; bundle-drift считается только по `added-from-template`.

## Migration / test plan

- **v1 → v2.** Старые v1-манифесты становятся `unusable` → `status` деградирует в fallback (приемлемо: у dogfood-репо манифеста ещё нет). Co-update потребителей контракта (`apply`/`status`/`init`/`gate`) + полная статическая проверка в одном шаге.
- **Тесты.** Запуск строго glob-формой: `node --test "plugins/glue/test/*.test.mjs"` (directory-форма падает на Node 24/Windows). Новые кейсы: authored-targets в apply-слое; манифест v2 (round-trip build/read, `isUsablePrevManifest`); status drift-eligibility по `decision`; adopt-поток (existing-baseline не перетёрт, `local` сохранён).
- **Дисциплина среза.** Код плагина (`content/`, `src/`, `skills/`, `bin/`) — только worktree + PR. Merge-гейт: локальные тесты зелёные + ревью + оператор «мержь».
