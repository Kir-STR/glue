---
name: init
description: Разложить правила Glue в текущий проект (glue init) из установленных контент-паков. Создаёт .claude/rules, инструкц-файлы и манифест доставки.
argument-hint: --modules a,b,c --engines claude [--force]
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Разложи правила Glue в текущий проект, выполнив CLI пака `glue-core`.

Запусти в Bash ровно эту команду — путь к бинарю даёт платформа через `${CLAUDE_PLUGIN_ROOT}`, аргументы пользователя подставляются как есть:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" init $ARGUMENTS
```

Бинарь пишет в каталог проекта (`CLAUDE_PROJECT_DIR`, по умолчанию cwd): `.claude/rules/<модуль>.md`, инструкц-файлы (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md` по выбранным engine'ам), `.glue/manifest.json`. Вывод команды — JSON `{ manifest, conflicts }`.

Разбери результат и сообщи оператору:

- **Успех** (`manifest.status == "complete"`, `conflicts: []`): подтверди раскладку, перечисли записанные `targetPath` из `manifest.files`, и подскажи `/clear` (или новый сеанс) — на следующем старте хук увидит валидный манифест и активирует нативную доставку (инъекция тел правил снимется).
- **Конфликты** (`manifest: null`, непустой `conflicts`): НЕ перезапускай с `--force` автоматически. Покажи каждый конфликт (`targetPath` + `reason`) и спроси оператора: повтор с `--force` перезапишет правленные/непровенансные файлы — это его решение.
- **Ошибка запуска** (ненулевой exit, текст в stderr): покажи stderr и диагностируй (например, не выбран ни один модуль, или пак `glue-rules` не установлен).

Если аргументы не переданы (`$ARGUMENTS` пуст) — спроси у оператора список модулей (`--modules`) и engine'ы (`--engines`, по умолчанию `claude`) до запуска: пустой `--modules` разложит ноль правил.
