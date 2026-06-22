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
