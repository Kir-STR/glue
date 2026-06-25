---
name: init
description: Разложить правила Glue в текущий проект (glue init) из установленных контент-паков. Создаёт .claude/rules, инструкц-файлы и манифест доставки.
argument-hint: --modules a,b,c --engines claude,codex,gemini [--force]
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Разложи правила Glue в текущий проект, выполнив CLI пака `glue-core`.

## Шаг 1 — если аргументы не переданы

Если `$ARGUMENTS` пуст, сначала получи список доступных модулей:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" list --json
```

Команда возвращает JSON-массив объектов `{ id, title, group, default, dependsOn }`. Разбери его и предложи оператору выбор: перечисли модули по группам (поле `group`), отметь дефолтные (`default: true`), укажи зависимости (`dependsOn`). Дождись ответа оператора — он указывает `--modules` и, при необходимости, `--engines` (допустимые значения: `claude`, `codex`, `gemini`; по умолчанию `claude`). Только после этого переходи к шагу 2.

## Шаг 2 — запустить init

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" init $ARGUMENTS
```

Бинарь пишет в каталог проекта (`CLAUDE_PROJECT_DIR`, по умолчанию cwd): `.claude/rules/<модуль>.md`, инструкц-файлы (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md` по выбранным engine'ам), `.glue/manifest.json`. Вывод команды — JSON `{ manifest, conflicts }`.

Разбери результат:

- **Успех** (`manifest.status == "complete"`, `conflicts: []`): подтверди раскладку, перечисли записанные `targetPath` из `manifest.files`.
- **Конфликты** (`manifest: null`, непустой `conflicts`): НЕ перезапускай с `--force` автоматически. Покажи каждый конфликт (`targetPath` + `reason`) и спроси оператора: повтор с `--force` перезапишет правленные/непровенансные файлы — это его решение.
- **Ошибка запуска** (ненулевой exit, текст в stderr): покажи stderr и диагностируй (например, не выбран ни один модуль, или пак `glue-rules` не установлен).

## Шаг 3 — автоматически проверить доставку (только при успехе)

Если init завершился успешно, сразу выполни:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" status
```

Разбери JSON `{ mode, missing[], changed[], stale[], packs[], summary }` и доложи вердикт:

- **`mode: 'native'`**: «Native delivery подтверждена — все файлы на месте.» Напомни оператору: полная активация нативного режима хука произойдёт на следующем старте сеанса — выполни `/clear` или открой новый чат.
- **`mode: 'fallback'`**: укажи конкретную причину из поля `summary` и перечисли проблемные файлы (`missing`/`changed`/`stale`), если есть.
