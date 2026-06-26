---
globs: "**/*"
class: discipline
---

# Worktree workflow — изоляция в git worktrees

Worktree — единица изолированной работы над веткой (фича, багфикс, эксперимент). Одна ветка = один worktree = один PR.

## Расположение и именование

- **Расположение:** `.claude/worktrees/<branch>/` (директория в `.gitignore`).
- **Именование веток (ASCII):** `feat-<slug>` — новая фича; `fix-<slug>` — багфикс; `task-<slug>` — мелкая задача; `infra-<slug>` — инфраструктурный срез.
- Ветки от `main`, merge через PR.

## Инварианты (не уезжают в runbook)

- **Teardown — деструктивный класс.** Восстановление при сбое (`git push origin --delete`, удаление директории worktree, `git branch -D`, `reset --hard origin/main`) — report+STOP gate, отдельное подтверждение оператора. Полная процедура (особенности ОС: длинные пути, осиротевшие процессы, блокировка cwd сессии) — в runbook проекта.
- **Subagent в worktree — проверка ветки до коммита.** `git -C "<worktree>" rev-parse --abbrev-ref HEAD` перед любым коммитом; коммит в `main` из worktree запрещён.

## Процедуры (read-on-demand)

Подробности создания (`git worktree add` + `pull --ff-only`), direct-to-main commit ordering, cwd-дисциплина инструмента оболочки, артефакты фичи в worktree, merge через `gh`, teardown с учётом ОС, subagent dispatch внутри worktree — в runbook проекта или вашем planning/worktree skill (или эквиваленте).

## Мелкие правки документов — исключение

Правки в документации, правилах, конфигурации CI без затрагивания кода и чувствительных путей — допустимо коммитить прямо в `main` из основной сессии. Если правка задевает код или чувствительные пути — только через ветку и PR, без исключений.

Когда параллельно активны основная и feature-worktree сессии — перед любой direct-to-main правкой: `git fetch && git pull --ff-only` + повторное чтение целевого файла. Параллельная сессия могла внести правки в рабочее дерево или новый коммит в `origin/main`.
