---
name: status
description: Показать состояние доставки правил Glue по всем заявленным движкам — что записано, совпадает ли с диском, есть ли расхождение с текущим контентом.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Покажи состояние доставки Glue, выполнив CLI плагина:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" status
```

Команда возвращает JSON-объект `deliveryStatus`. Разбери его (читай только JSON) и покажи оператору:
- `mode` (`native`/`fallback`) и `summary` / `reason`;
- списки `missing` / `changed` / `drift`, если непусты;
- покрытие по `engines` — статус каждого заявленного движка (`ok` / `missing` / `changed` / `drift`) и его `targetPath`;
- `errors`, если есть.

Read-only: ничего не пишет, гейт не нужен.
