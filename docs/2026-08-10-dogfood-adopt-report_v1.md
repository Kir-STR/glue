# Dogfood-отчёт: adopt на репо Glue (фаза E, W0b)

Дата: 2026-08-10; повторная доставка: 2026-08-11. Задание: `docs/2026-08-10-glue-improvements-task_v16.md` § W0b. Прогон в worktree `task-dogfood-adopt` от `7a591ed`; исполнитель записи — кешированный плагин glue 0.4.5 (кеш ≡ `plugins/glue` репо, сверено diff'ом). Этот отчёт — W0b-артефакт, source decision-карточки 2.10 (W1).

## Решения оператора

| Решение | Выбор | Примечание |
|---|---|---|
| P1 — режим adopt | **улучшить** | дефолт протокола; существующие правила — базлайн |
| 2.10 — трекинг `.glue/manifest.json` в репо Glue | **коммитить** (дефолт задания принят) | dogfood-витрина: доставка и drift видны в PR-диффах; манифест правится только glue-командами, вручную не редактируется; конфликт манифеста = повторить apply, не ручной merge. Внешним проектам — выбор с объяснением последствий (README-абзац — W3) |
| Дефолт retro-loop | **подтверждён: local** | правило этого репо, вне поставки; промоция — при пересмотре беклога роадмапа |

## Пять кастом-кейсов — классификации

Все три diverged-файла несли один паттерн: ссылки pre-glue эпохи на секции старого монолитного `CLAUDE.md`, которых в текущем `CLAUDE.md` (карта модулей) нет — то есть битые ссылки; shipped-шаблоны их чинят.

| Кейс | Decision | Обоснование |
|---|---|---|
| `pr-policy.md` (баг: ссылка на несуществующую `CLAUDE.md § «Sensitive paths gate»`) | **added-from-template** + заведена секция «Sensitive paths gate» в `CLAUDE.md` | shipped-деградация сохранена; список (`plugins/glue/**` — публикация при continuous release С4; `.github/workflows/**` — CI-гейты) активирует правило, release-/merge-гейты С4 не заменяет |
| `review-loop.md` (2 строки) | **merged** | шаблонная стр. 8 чинит ссылку; локальная стр. 31 сохраняет проектный перечень gitignored-файлов (`ideas_4_rules.md`, `retro-*.md`) |
| `subagent-dispatch.md` (1 строка) | **added-from-template** | локальной ценности в расхождении нет; shipped-цепочка корректно идёт через `pr-policy` |
| `retro-loop.md` (local-only) | **local** | вне files[] манифеста — status не отслеживает; живёт retro-циклом |
| Строка «Retro loop» в `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` | **сохранена** | proof-кейс кастомного контента: `CLAUDE.md` — авторский write, `AGENTS.md`/`GEMINI.md` — materialized как есть |

Дополнительно (режим «улучшить», по согласию оператора): `architectural-invariants`, `safety`, `glossary` — **tailored-from-template**, заготовки заполнены из кода с двухпроходным advisor-ревью формулировок (исправлены: чтение контента `plan.mjs`-ом, а не только `bundle.mjs`; «fail-transparent» вместо «fail-closed»; манифест-last без переутверждения; SYS_EMPTY-случай presence-gate).

## Прогон

- План: 7 writes + 6 materialized, 11 modules, 3 движка; авторские тексты — только через scratchpad и `adopt --plan` (ноль прямых Write в таргеты; гейты P4/P5 соблюдены).
- TOCTOU-перепроверка диска против P2-обзора перед сборкой плана: 13/13 хешей совпали; сам прогон — без TOCTOU/валидационных ошибок.
- Результат: `ok: true`; манифест v2 `complete`, 13 files, `producerPack@packVersion = glue@0.4.5` на всех записях.
- `glue status` после: **`native`, missing 0 / changed 0 / drift 0 / errors 0, все три движка `ok`**.
- Диффы: 3 файла по 1 строке, `CLAUDE.md` +9, `safety` 12+/14−, `architectural-invariants` 15+/16−, `glossary` 6+/1−, новый `.glue/manifest.json`.
- Повторная доставка (2026-08-11): 2 writes (architectural-invariants, safety) + 11 materialized поверх манифеста первой доставки; результат — native, 13 files, missing / changed / drift / errors 0.
- Третья доставка (simplify, 2026-08-11): 5 writes + 8 materialized; локальные simplify-правки применены через adopt, результат — native, 13 files, missing / changed / drift / errors 0.

## Снятые вопросы

- **Versioning — false positive** (вопрос №9 P2-обзора): `manifest.schema_v2.json` несёт версию контракта в имени (по правилу); `schemaVersion` внутри `.glue/manifest.json` — runtime-дискриминатор экземпляра, не дубль версии документа. Правило `versioning.md` не нарушено и не правилось.

## Беклог-находки (shipped-шаблон, → 2.5б/2.6-shipped, W4)

- `review-loop.md`: «`.claude/rules/safety.md`, инварианты и т.п. описывают **целевое** поведение» — неверно для проектов, где safety заполнен из кода (как здесь). Локально исправлено на нейтральное «сами по себе не доказывают реализацию; реальное состояние проверяется по исходному коду и parent-plan активных PR»; перенести формулировку в шаблон `plugins/glue/content/modules/review-loop.md`.
- `review-loop.md`: «три волатильные точки» при двух буллетах — счётчик битый и в шаблоне. Локально исправлено на «две»; поправить в шаблоне там же.

## Итог

Фаза E выполнена: adopt доказан на заявленном dogfood-профиле (diverged-правила + кастомный контент + local-модуль + инструкц-файлы без module-маркеров); его результат штатно отслеживается `glue status`. R1 роадмапа закрыт; retro-долг (15 файлов `.invoker/retro/` + `ideas_4_rules.md`) — отдельный follow-up, параллельный трек к W2.
