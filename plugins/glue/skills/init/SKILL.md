---
name: init
description: Материализовать выбранные модули правил Glue в проект (.claude/rules/* + инструкц-файлы движков) и опубликовать манифест доставки. Спрашивает движки и модули, подтверждает запись.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Подключи правила Glue в проект. CLI неинтерактивный — UX и operator-gate держишь сам.

1. **Показать модули.** Выполни и разбери JSON:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" list
   ```
   Покажи оператору модули по группам (`group`), отметив дефолтные (`default: true`), `note`, `dependsOn`.

2. **Спросить выбор.** Узнай у оператора:
   - движки: `claude` (по умолчанию), `codex` (→ `AGENTS.md`), `gemini` (→ `GEMINI.md`) — один или несколько;
   - модули: предложи дефолты (`default: true`) явным списком; оператор подтверждает/меняет. Зависимости (`dependsOn`) дотянутся автоматически — упомяни это.

3. **Гейт (подтверждение выбора).** Покажи итог: выбранные движки + модули и что Glue создаст/обновит управляемые файлы (`.claude/rules/*.md`, инструкц-файлы движков, `.glue/manifest.json`). Дождись подтверждения (UX-подтверждение, не строгое «да» — запись обратима).

4. **Выполнить init.** Передай выбор явными флагами (без `--force`):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" init --engines claude,codex --modules operator-gate,secret-hygiene
   ```
   Разбери JSON stdout (читай только JSON, не прозу/stderr).

5. **Обработать результат.**
   - `ok: true` → доставка выполнена. Покажи `manifest` (доставленные движки, файлы).
   - `conflicts.length > 0` (`ok: false`, exit 0) → покажи каждый конфликт (`targetPath`, `reason` — напр. файл правлён вручную). **Отдельным гейтом** спроси строгое буквальное «да» на повтор с `--force` (перезапись ручных правок — деструктивно). `--force` добавляй только после этого «да»:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" init --force --engines claude,codex --modules operator-gate,secret-hygiene
     ```
   - `ok: false` с полем `error` (exit 1) → покажи диагностику (неизвестный движок/модуль/аргумент); не повторяй вслепую, уточни у оператора.
