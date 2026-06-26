---
name: list
description: Показать доступные модули правил Glue (id, заголовок, группа, дефолтность, заметка, зависимости) из встроенного bundle.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Покажи доступные модули Glue, выполнив CLI плагина:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" list
```

Команда возвращает JSON-массив объектов `{ id, title, group, default, note, dependsOn }`. Разбери его и покажи оператору модули по группам (поле `group`), отметив дефолтные (`default: true`), заметку (`note`) и зависимости (`dependsOn`).
