---
globs: "**/*"
class: discipline
---

# Architectural invariants — инварианты проекта

Операционная выжимка по архитектурным границам проекта: что где лежит и что куда импортировать нельзя. Источник правды — исходный код и спека; при переименовании / добавлении модулей — обновлять и здесь.

## Границы слоёв / модулей

- **CLI-диспетчер** `plugins/glue/bin/glue.mjs` — единственная точка входа команд (`list` / `status` / `session-start` / `init` / `adopt`).
- **Командные модули** `plugins/glue/src/{init,adopt,status,session-start}.mjs` — оркестрация сценариев: `status` и `session-start` — read-only; `init` и `adopt` делегируют все низкоуровневые мутации `plugins/glue/src/apply.mjs`.
- **Движок доставки** `plugins/glue/src/{plan,apply,gate,manifest,bundle}.mjs` — планирование, применение, гейт native↔fallback, манифест, чтение бандла.
- **Общие модули** `plugins/glue/src/{hash,paths,blocks,resolve}.mjs` — вспомогательные функции без записи на диск.
- **Контент** (`plugins/glue/content/bundle.json`, `plugins/glue/content/modules/*.md`, `plugins/glue/content/instructions/*.tmpl`) — данные, не код. Пути контента задаёт `plugins/glue/glue.contract_v1.json`; контракт и реестр загружает `plugins/glue/src/bundle.mjs`, тела модулей и инструкций читает `plugins/glue/src/plan.mjs`.
- **Тесты** `plugins/glue/test/*.test.mjs` — один файл на модуль `plugins/glue/src` (`node --test`, Node ≥ 22).

Направление импортов однонаправленное: командные модули → движок → общие модули; обратных импортов нет.

## Тонкий транспортный слой

`plugins/glue/bin/glue.mjs` — только парсинг argv, диспетчеризация, сериализация JSON в stdout и коды выхода; планирование, хеширование и запись в диспетчере запрещены (из fs — только чтение файлов-аргументов, напр. `--plan`). Второй транспорт — hook-энтрипоинт `plugins/glue/hooks/hooks.json` → команда `session-start`: тот же принцип, вся логика в `plugins/glue/src/session-start.mjs`.

## Изоляция внешних адаптеров

Внешних сервис-адаптеров сейчас нет; единственная внешняя граница — файловая система. **Мутации проекта локализованы в `plugins/glue/src/apply.mjs` и `plugins/glue/src/manifest.mjs`** — только они пишут на диск (атомарно, tmp + rename); остальной код читает. Новый модуль не получает право записи — расширение мутаций проходит через apply.

Будущие внешние провайдеры (DecisionProvider / JudgeProvider — см. `docs/product-boundary_v1.md`) не импортируют друг друга; координация живёт уровнем выше, не в адаптерах. [target]

## Общие модули — без бизнес-логики

`plugins/glue/src/hash.mjs`, `plugins/glue/src/paths.mjs`, `plugins/glue/src/blocks.mjs`, `plugins/glue/src/resolve.mjs` — чистые функции: без записи на диск, без импортов из командных модулей и движка. Бизнес-решения (конфликт-политика, decision-классы, правила доставки) живут в движке и командных модулях, не в общих.

## Конвенции импортов / зоны

- ESM `.mjs`; относительные импорты с явным расширением (`./hash.mjs`); node-билтины только с префиксом `node:`.
- Runtime-зависимостей нет (`package.json` без `dependencies`) — новый сторонний пакет — архитектурное решение с ревью, не рутина.
- Зоны записи в проект ограничены `plugins/glue/src/paths.mjs`: каталоги `.claude/`, `.glue/` и ровно три корневых файла `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`; всё остальное `safeTargetPath` отвергает. Расширение списка зон — осознанное решение с ревью, не рутинная правка.
