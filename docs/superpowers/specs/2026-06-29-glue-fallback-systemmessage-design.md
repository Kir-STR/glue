# Glue — fallback `systemMessage` пользователю (design)

**Дата:** 2026-06-29. **Статус:** мини-срез. Уточняет (не замещает) `2026-06-25-glue-single-plugin-collapse-design.md` (§ «Fallback-семантика R1») и `2026-06-26-glue-slice3-status-hook-design.md` (SessionStart-хук).

## Проблема

Fallback-ветка SessionStart-хука писала диагностику непокрытия в **stderr** (`[glue] native delivery inactive — запусти /glue:init`). Но Claude Code при `exit 0` для SessionStart **stderr игнорирует** (показывает пользователю только при `exit 2`; хук не блокирующий и выходит 0). Значит диагностика, заложенная как «честное предупреждение», пользователю **не видна** — он не знает, что плагин в деградированном режиме и что нужен `init`.

## Решение (лёгкая ревизия R1)

Fallback дополнительно отдаёт поле `systemMessage` в JSON-выводе хука. Claude Code показывает `systemMessage` пользователю на экран (отдельно от `additionalContext`, который идёт в контекст модели). То есть в одном `exit 0`-ответе: модели — guardrails (`additionalContext`), человеку — статус + рекомендация (`systemMessage`).

- **fallback с модулями** → `⚠️ Glue плагин не инициализирован — в контекст введены временные guardrails-инструкции. Прочитать — попроси агента: «процитируй блок <glue>». Инициализация плагина Glue: /glue:init`
- **fallback пустой** (`modules: []`, инжектировать нечего) → `⚠️ Glue плагин не инициализирован, модули не выбраны — контроль не применяется. Инициализация плагина Glue: /glue:init`
- **native** (хук молчит, `{}`) → без `systemMessage`.

«Прочитать» адресует тонкость: в fallback правила живут в контексте модели, файла на диске нет — единственный честный способ их увидеть — попросить агента процитировать блок `<glue>`.

Мёртвый stderr из fallback-ветки убираем (его роль забрал `systemMessage`). В error-ветке stderr остаётся как debug-лог сбоя.

## Объём

`session-start.mjs`: `payload()` принимает опциональный `systemMessage`; fallback-ветки выбирают текст по `bodies.length`. `session-start.test`: ассертить наличие `systemMessage` в обеих fallback-ветках (+ `/glue:init`), его отсутствие в native, и пустой stderr в fallback.
