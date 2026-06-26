# Glue срез 4 — skills + acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подключить готовый движок (`runInit`/`deliveryStatus`) к CLI-подкоманде `init` + skills `/glue:init` и `/glue:status`, доказав поведенческий контракт переписывания сквозным acceptance-тестом на 10 сценариев.

**Architecture:** Срез 4 — только обвязка: ветка `init` в тонком диспетчере `bin/glue.mjs` (обёртка над `runInit`, JSON-контракт), два SKILL.md по образцу `/glue:list`, один интеграционный тест, гоняющий настоящий бинарь через `child_process`. Код `src/` не трогается.

**Tech Stack:** Node.js ESM (`.mjs`), встроенный `node:test` + `node:assert/strict`, `node:child_process` (`spawnSync`).

## Global Constraints

- **Код движка не трогать.** Срез 4 меняет только `bin/glue.mjs` + новые `skills/*/SKILL.md` + новый `test/acceptance.test.mjs`. `src/` (`plan`/`apply`/`init`/`status`/`session-start`/`gate`/`manifest`/`resolve`/`bundle`/`blocks`/`hash`/`paths`) — **read-only**. Если acceptance вскроет regression — STOP, эскалация оператору (`docs: spec sync` + Deviations log), не молчаливый фикс.
- **Запуск тестов — только glob-форма:** `node --test "plugins/glue/test/*.test.mjs"` (directory-форма падает на Node 24/Windows).
- **CLI JSON-контракт:** stdout всегда JSON. success → exit 0; conflicts → exit 0 (`ok:false`, `manifest:null`); ошибка аргументов/движка/модуля → exit 1 (`ok:false`, `error`). `--help`/unknown/no-command → exit 1 JSON error, **никогда** не дефолтит в `session-start`.
- **Skills frontmatter** — паритет с `plugins/glue/skills/list/SKILL.md`: `disable-model-invocation: true`, `allowed-tools: Bash(node:*)`.
- **Имена** (id модулей, флаги, пути) — ASCII; текст документации — русский (glossary).
- **Дефолтные модули:** `operator-gate`, `secret-hygiene` (оба `default:true`, без `dependsOn`). CLI не интерпретирует «defaults» — их вычисляет skill и передаёт explicit `--modules`.

---

### Task 1: CLI `init` subcommand + dispatcher hardening + acceptance suite

**Files:**
- Modify: `plugins/glue/bin/glue.mjs` (добавить ветку `init`, импорт `runInit`, хелперы `flagValue`/`emitUnknown`, ужесточить else-ветку)
- Create: `plugins/glue/test/acceptance.test.mjs`

**Interfaces:**
- Consumes: `runInit({ selected, engines, projectDir, force, now }) → { manifest, conflicts }` из `src/init.mjs` (готов). `conflicts` = `[{targetPath, reason}]`; на unknown engine — throw `Unknown engine: …`; `resolveDependencies` внутри — throw `Unknown module: <id>`. Манифест пишется в `<projectDir>/.glue/manifest.json`, форма `{schemaVersion:'1', deliveryId, completedAt, engines, modules, status:'complete', files:[{producerPack:'glue', packVersion, sourceTemplate, targetPath, writtenHash}]}`. `manifest.engines` = только реально доставленные движки.
- Produces: подкоманда `glue init` с JSON-контрактом (см. Global Constraints); CLI читает `projectDir` из `CLAUDE_PROJECT_DIR || process.cwd()`.

- [ ] **Step 1: Написать acceptance-тест (полный файл, RED)**

Create `plugins/glue/test/acceptance.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'glue.mjs')

// Гоняет настоящий бинарь как пользовательский путь. projectDir — через
// CLAUDE_PROJECT_DIR (механизм, который реально использует CLI).
function runCli(args, projectDir) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
  })
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status }
}

function tmpProject(t) {
  const dir = mkdtempSync(join(tmpdir(), 'glue-acc-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const rulePath = (dir, file) => join(dir, '.claude', 'rules', file)

test('1: list — JSON-массив модулей с ожидаемой формой', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['list'], dir)
  assert.equal(r.exitCode, 0)
  const mods = JSON.parse(r.stdout)
  assert.ok(Array.isArray(mods))
  const og = mods.find((m) => m.id === 'operator-gate')
  assert.ok(og, 'operator-gate присутствует')
  assert.equal(og.default, true)
  assert.deepEqual(Object.keys(og).sort(), ['default', 'dependsOn', 'group', 'id', 'note', 'title'])
})

test('2: init — материализует rule + инструкц-файл + манифест', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['init', '--modules', 'operator-gate'], dir)
  assert.equal(r.exitCode, 0)
  const out = JSON.parse(r.stdout)
  assert.equal(out.ok, true)
  assert.deepEqual(out.conflicts, [])
  assert.ok(existsSync(rulePath(dir, 'operator-gate.md')))
  assert.ok(existsSync(join(dir, 'CLAUDE.md')))
  assert.ok(existsSync(join(dir, '.glue', 'manifest.json')))
  assert.equal(out.manifest.status, 'complete')
})

test('3: status — после init mode native, движки покрыты', (t) => {
  const dir = tmpProject(t)
  runCli(['init', '--modules', 'operator-gate'], dir)
  const r = runCli(['status'], dir)
  assert.equal(r.exitCode, 0)
  const st = JSON.parse(r.stdout)
  assert.equal(st.mode, 'native')
  assert.equal(st.engines.claude.status, 'ok')
})

test('4: session-start — native {}; после сноса target — fallback-инъекция', (t) => {
  const dir = tmpProject(t)
  runCli(['init', '--modules', 'operator-gate'], dir)

  const native = runCli(['session-start'], dir)
  assert.equal(native.exitCode, 0)
  assert.equal(native.stdout.trim(), '{}')

  unlinkSync(join(dir, 'CLAUDE.md')) // обязательный Claude-target → native невалиден
  const fb = runCli(['session-start'], dir)
  assert.equal(fb.exitCode, 0)
  assert.ok(fb.stdout.includes('hookSpecificOutput'))
  assert.ok(fb.stdout.includes('<glue>'))
  assert.ok(fb.stderr.includes('native delivery inactive'))
})

test('5: повторный init — идемпотентен, не конфликт', (t) => {
  const dir = tmpProject(t)
  runCli(['init', '--modules', 'operator-gate'], dir)
  const r = runCli(['init', '--modules', 'operator-gate'], dir)
  assert.equal(r.exitCode, 0)
  const out = JSON.parse(r.stdout)
  assert.equal(out.ok, true)
  assert.deepEqual(out.conflicts, [])
})

test('6: правленный файл — конфликт без force; --force перезаписывает', (t) => {
  const dir = tmpProject(t)
  runCli(['init', '--modules', 'operator-gate'], dir)
  const target = rulePath(dir, 'operator-gate.md')
  const planned = readFileSync(target, 'utf8')
  writeFileSync(target, 'tampered by hand\n', 'utf8')

  const conflict = runCli(['init', '--modules', 'operator-gate'], dir)
  assert.equal(conflict.exitCode, 0)
  const co = JSON.parse(conflict.stdout)
  assert.equal(co.ok, false)
  assert.equal(co.manifest, null)
  assert.ok(co.conflicts.some((c) => c.targetPath === '.claude/rules/operator-gate.md'))

  const forced = runCli(['init', '--force', '--modules', 'operator-gate'], dir)
  assert.equal(forced.exitCode, 0)
  assert.equal(JSON.parse(forced.stdout).ok, true)
  assert.equal(readFileSync(target, 'utf8'), planned)
})

test('7: снятый модуль — неизменённый удалён; правленный — конфликт', (t) => {
  const dir = tmpProject(t)
  runCli(['init', '--modules', 'operator-gate,secret-hygiene'], dir)
  assert.ok(existsSync(rulePath(dir, 'secret-hygiene.md')))

  // снятие неизменённого модуля → безопасное удаление его файла
  const drop = runCli(['init', '--modules', 'operator-gate'], dir)
  assert.equal(JSON.parse(drop.stdout).ok, true)
  assert.ok(!existsSync(rulePath(dir, 'secret-hygiene.md')))
  assert.ok(existsSync(rulePath(dir, 'operator-gate.md')))

  // правленный снятый файл → конфликт, не молчаливое удаление
  runCli(['init', '--modules', 'operator-gate,secret-hygiene'], dir)
  writeFileSync(rulePath(dir, 'secret-hygiene.md'), 'hand-edited\n', 'utf8')
  const conflict = runCli(['init', '--modules', 'operator-gate'], dir)
  const co = JSON.parse(conflict.stdout)
  assert.equal(co.ok, false)
  assert.ok(co.conflicts.some((c) => c.targetPath === '.claude/rules/secret-hygiene.md'))
})

test('8: codex в движках — создаётся AGENTS.md', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['init', '--modules', 'operator-gate', '--engines', 'claude,codex'], dir)
  assert.equal(JSON.parse(r.stdout).ok, true)
  assert.ok(existsSync(join(dir, 'AGENTS.md')))
})

test('9: неизвестный движок — ok:false, error, exit 1', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['init', '--modules', 'operator-gate', '--engines', 'borg'], dir)
  assert.equal(r.exitCode, 1)
  const out = JSON.parse(r.stdout)
  assert.equal(out.ok, false)
  assert.match(out.error, /Unknown engine/)
})

test('9b: неизвестный модуль — ok:false, error, exit 1', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['init', '--modules', 'no-such-module'], dir)
  assert.equal(r.exitCode, 1)
  assert.match(JSON.parse(r.stdout).error, /Unknown module/)
})

test('10: честный манифест — engines только реально доставленные', (t) => {
  const dir = tmpProject(t)
  const r = runCli(['init', '--modules', 'operator-gate', '--engines', 'claude'], dir)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(out.manifest.engines, ['claude'])
})

test('regression: --help/no-command — JSON error exit 1, не session-start', (t) => {
  const dir = tmpProject(t)
  for (const args of [['--help'], []]) {
    const r = runCli(args, dir)
    assert.equal(r.exitCode, 1)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, false)
    assert.match(out.error, /unknown command/)
    assert.ok(!r.stdout.includes('hookSpecificOutput'), 'не дефолтит в session-start')
  }
})
```

- [ ] **Step 2: Запустить — убедиться, что падает (RED)**

Run: `node --test "plugins/glue/test/*.test.mjs"`
Expected: тесты 2–10/9b/regression падают (нет ветки `init`; `--help`/no-command сейчас уходят в старую else-ветку без JSON, а `session-start` без init даёт fallback). Тест 1 (`list`) проходит.

- [ ] **Step 3: Переписать `bin/glue.mjs` (init + hardening)**

Заменить весь файл `plugins/glue/bin/glue.mjs` на:

```js
#!/usr/bin/env node
// glue — единый плагин. Тонкий диспетчер подкоманд над src/.
// Реализованы: list (срез 1), status + session-start (срез 3), init (срез 4).

import { loadBundle, listModules } from '../src/bundle.mjs'
import { deliveryStatus } from '../src/status.mjs'
import { runSessionStart } from '../src/session-start.mjs'
import { runInit } from '../src/init.mjs'

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const [cmd] = process.argv.slice(2)

// Значение флага, требующего аргумент; throw, если значение отсутствует или
// похоже на следующий флаг (--modules без значения и т.п.).
function flagValue(flags, i, name) {
  const v = flags[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error(`Missing value for ${name}`)
  return v
}

// Нераспознанный ввод (--help / unknown / нет команды): JSON error + exit 1.
// Никогда не дефолтит в session-start.
function emitUnknown(label) {
  const error = `unknown command: ${label ?? '(none)'}`
  process.stdout.write(JSON.stringify({ ok: false, error }, null, 2) + '\n')
  process.stderr.write(`[glue] ${error}\n`)
  process.exit(1)
}

if (cmd === 'list') {
  // glue list → плоский список модулей встроенного bundle (JSON)
  const registry = loadBundle()
  process.stdout.write(JSON.stringify(listModules(registry), null, 2) + '\n')
} else if (cmd === 'status') {
  // glue status → отчёт о состоянии доставки (JSON)
  process.stdout.write(JSON.stringify(deliveryStatus(PROJECT_DIR), null, 2) + '\n')
} else if (cmd === 'session-start') {
  // SessionStart-хук: native → {}; иначе fallback-инъекция тел правил
  const r = runSessionStart(PROJECT_DIR)
  process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  process.exit(r.exitCode)
} else if (cmd === 'init') {
  // glue init --modules a,b[,c] [--engines claude,codex] [--force]
  // JSON всегда: success/conflicts → exit 0; ошибка аргументов/движка/модуля → exit 1.
  try {
    const flags = process.argv.slice(3)
    let modulesArg = null
    let enginesArg = null
    let force = false
    for (let i = 0; i < flags.length; i++) {
      const a = flags[i]
      if (a === '--force') force = true
      else if (a === '--modules') { modulesArg = flagValue(flags, i, '--modules'); i++ }
      else if (a === '--engines') { enginesArg = flagValue(flags, i, '--engines'); i++ }
      else throw new Error(`Unknown argument: ${a}`)
    }
    if (modulesArg === null) throw new Error('Missing required --modules')
    const selected = modulesArg.split(',').map((s) => s.trim()).filter(Boolean)
    const engines = enginesArg === null ? undefined : enginesArg.split(',').map((s) => s.trim()).filter(Boolean)
    const { manifest, conflicts } = runInit({
      selected,
      engines,
      projectDir: PROJECT_DIR,
      force,
      now: new Date().toISOString(),
    })
    const ok = conflicts.length === 0
    process.stdout.write(JSON.stringify({ ok, manifest: ok ? manifest : null, conflicts }, null, 2) + '\n')
    process.exit(0)
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + '\n')
    process.stderr.write(`[glue] init: ${e.message}\n`)
    process.exit(1)
  }
} else {
  emitUnknown(cmd)
}
```

- [ ] **Step 4: Запустить acceptance — зелено (GREEN)**

Run: `node --test "plugins/glue/test/*.test.mjs"`
Expected: все acceptance-тесты PASS + существующие юнит-тесты PASS.

- [ ] **Step 5: Полный прогон — acceptance + 72 юнита зелёные**

Run: `node --test "plugins/glue/test/*.test.mjs"`
Expected: `# pass` = 72 + 12 (10 сценариев + 9b + regression) = 84, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add plugins/glue/bin/glue.mjs plugins/glue/test/acceptance.test.mjs
git commit -m "feat(glue): init subcommand + сквозной acceptance"
```

---

### Task 2: Skills `/glue:init` + `/glue:status`

**Files:**
- Create: `plugins/glue/skills/status/SKILL.md`
- Create: `plugins/glue/skills/init/SKILL.md`

**Interfaces:**
- Consumes: подкоманды `glue status` и `glue init` из Task 1 (JSON-контракт). Образец frontmatter — `plugins/glue/skills/list/SKILL.md`.
- Produces: оператор-вызываемые `/glue:status` (read-only) и `/glue:init` (мультишаговый, держит operator-gate).

- [ ] **Step 1: Создать `skills/status/SKILL.md`**

Create `plugins/glue/skills/status/SKILL.md`:

```markdown
---
name: status
description: Показать состояние доставки правил Glue по всем заявленным движкам — что записано, совпадает ли с диском, есть ли расхождение с текущим контентом.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Покажи состояние доставки Glue, выполнив CLI плагина:

\```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" status
\```

Команда возвращает JSON-объект `deliveryStatus`. Разбери его (читай только JSON) и покажи оператору:
- `mode` (`native`/`fallback`) и `summary` / `reason`;
- списки `missing` / `changed` / `drift`, если непусты;
- покрытие по `engines` — статус каждого заявленного движка (`ok` / `missing` / `changed` / `drift`) и его `targetPath`;
- `errors`, если есть.

Read-only: ничего не пишет, гейт не нужен.
```

- [ ] **Step 2: Создать `skills/init/SKILL.md`**

Create `plugins/glue/skills/init/SKILL.md`:

```markdown
---
name: init
description: Материализовать выбранные модули правил Glue в проект (.claude/rules/* + инструкц-файлы движков) и опубликовать манифест доставки. Спрашивает движки и модули, подтверждает запись.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Подключи правила Glue в проект. CLI неинтерактивный — UX и operator-gate держишь сам.

1. **Показать модули.** Выполни и разбери JSON:
   \```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" list
   \```
   Покажи оператору модули по группам (`group`), отметив дефолтные (`default: true`), `note`, `dependsOn`.

2. **Спросить выбор.** Узнай у оператора:
   - движки: `claude` (по умолчанию), `codex` (→ `AGENTS.md`), `gemini` (→ `GEMINI.md`) — один или несколько;
   - модули: предложи дефолты (`default: true`) явным списком; оператор подтверждает/меняет. Зависимости (`dependsOn`) дотянутся автоматически — упомяни это.

3. **Гейт (подтверждение выбора).** Покажи итог: выбранные движки + модули и что Glue создаст/обновит управляемые файлы (`.claude/rules/*.md`, инструкц-файлы движков, `.glue/manifest.json`). Дождись подтверждения (UX-подтверждение, не строгое «да» — запись обратима).

4. **Выполнить init.** Передай выбор явными флагами (без `--force`):
   \```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" init --engines claude,codex --modules operator-gate,secret-hygiene
   \```
   Разбери JSON stdout (читай только JSON, не прозу/stderr).

5. **Обработать результат.**
   - `ok: true` → доставка выполнена. Покажи `manifest` (доставленные движки, файлы).
   - `conflicts.length > 0` (`ok: false`, exit 0) → покажи каждый конфликт (`targetPath`, `reason` — напр. файл правлён вручную). **Отдельным гейтом** спроси строгое буквальное «да» на повтор с `--force` (перезапись ручных правок — деструктивно). `--force` добавляй только после этого «да»:
     \```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/glue.mjs" init --force --engines claude,codex --modules operator-gate,secret-hygiene
     \```
   - `ok: false` с полем `error` (exit 1) → покажи диагностику (неизвестный движок/модуль/аргумент); не повторяй вслепую, уточни у оператора.
```

- [ ] **Step 3: Проверить frontmatter-паритет и работу обёрнутых команд**

Run: `node "plugins/glue/bin/glue.mjs" list` и `node "plugins/glue/bin/glue.mjs" status`
Expected: `list` → JSON-массив (exit 0); `status` → JSON `deliveryStatus` (exit 0). Frontmatter обоих SKILL.md совпадает по ключам с `skills/list/SKILL.md` (`name`, `description`, `disable-model-invocation: true`, `allowed-tools: Bash(node:*)`).

- [ ] **Step 4: Commit**

```bash
git add plugins/glue/skills/init/SKILL.md plugins/glue/skills/status/SKILL.md
git commit -m "feat(glue): /glue:init + /glue:status skills"
```

---

## Self-Review

**Spec coverage:** Секция 1 (CLI `init` + `--help`) → Task 1 (bin + Step 3, acceptance #9/#9b/regression). Секция 2 (skills) → Task 2. Секция 3 (10 acceptance + `--help`) → Task 1 Step 1 (тесты 1–10, 9b, regression). Сценарий 7 (delete/conflict) → тест 7. Fallback-семантика #4 → тест 4. Честный манифест #10 → тест 10. Все секции покрыты.

**Placeholder scan:** код приведён полностью в каждом шаге (полный `bin/glue.mjs`, полный `acceptance.test.mjs`, оба SKILL.md). Плейсхолдеров нет.

**Type consistency:** `runInit({selected, engines, projectDir, force, now})` совпадает с `src/init.mjs:7`. `conflicts` = `[{targetPath, reason}]` (сверено `plan.mjs:59,72`). Манифест-форма сверена с `manifest.mjs:8-9`. `manifest.engines` = `deliveredEngines` (сверено `init.mjs:41` → `applyPlan` `engines: planResult.deliveredEngines`). Имена флагов (`--modules`/`--engines`/`--force`) консистентны между bin, тестом и SKILL.md.

## Deviations log

(пусто — заполняется при отклонениях по ходу исполнения)
