# Инструкции для AI-агента — роль: оператор

## Дисциплина

Правила проекта живут в `.claude/rules/*.md` (с frontmatter `globs`/`class`). Ниже — карта активных модулей.

- **Operator gate** — подтверждай деструктивные/наружу-направленные действия. См. `.claude/rules/operator-gate.md`.
- **Retro loop** — цикл эволюции правил. См. `.claude/rules/retro-loop.md`.
- **Secret hygiene** — не выводить секреты целиком, маскировать значения. См. `.claude/rules/secret-hygiene.md`.
- **Worktree workflow** — изоляция работы в git worktrees. См. `.claude/rules/worktree-workflow.md`.
- **PR policy** — политика веток/PR. См. `.claude/rules/pr-policy.md`.
- **Review loop** — цикл ревью. См. `.claude/rules/review-loop.md`.
- **Subagent dispatch** — диспетчеризация субагентов. См. `.claude/rules/subagent-dispatch.md`.
- **Safety** — safety-инварианты проекта. См. `.claude/rules/safety.md`.
- **Architectural invariants** — границы слоёв и модулей проекта. См. `.claude/rules/architectural-invariants.md`.
- **Versioning** — версионирование контрактов и документов. См. `.claude/rules/versioning.md`.
- **Glossary** — канон терминов. См. `.claude/rules/glossary.md`.

## Sensitive paths gate

Чувствительные зоны — PR в них требует отдельного согласования с оператором (см. `.claude/rules/pr-policy.md § «Sensitive paths gate»`):

- `plugins/glue/**` — пока действует continuous release (решение С4, см. `docs/2026-08-10-glue-improvements-task_v16.md § «7. Принятые решения»`), merge в main публикует новую версию плагина;
- `.github/workflows/**` — управляет CI-гейтами.

Список активирует правило; отдельные release- и merge-гейты С4 он не заменяет.
