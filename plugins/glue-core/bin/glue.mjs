#!/usr/bin/env node
// glue — core-команда (MVP 0.1.1).
//
// Задача среза: из core-плагина в рантайме хука собрать видимость правил,
// которые лежат в ОТДЕЛЬНЫХ установленных контент-паках (glue-*). Это и есть
// проверка несущего риска: судья/команда в core читает контент чужого пака.
//
// 0.1.1: инжектим ТЕЛО правил (не только имена) — чтобы агент знал, чему
// следовать, без отдельного чтения файлов (вывод dogfooding'а 0.1.0).
//
// Каналы (контракт формы): stdout = ответ (SessionStart additionalContext, JSON),
// stderr = только диагностика, exit-code = итог. Плюс трасса последнего прогона
// в .glue/last-run.json проекта (last-known-good + доказательство чтения).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { nativeDeliveryValid } from '../lib/init.mjs';
import { discoverPacks } from '../lib/discovery.mjs';

const HOME = process.env.HOME || process.env.USERPROFILE || homedir();
const REGISTRY = join(HOME, '.claude', 'plugins', 'installed_plugins.json');
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const diag = (msg) => process.stderr.write(`[glue] ${msg}\n`);

// --- Dispatch on subcommand --------------------------------------------------
const [cmd] = process.argv.slice(2);

if (cmd === 'init') {
  // glue init --modules a,b --engines claude[,agents,gemini] [--force]
  await runInitCmd();
} else {
  // session-start (default / legacy): runs SessionStart hook logic.
  // Preserved verbatim for backward compatibility; Task 2.8 may modify it.
  runSessionStart();
}

// ── init subcommand ──────────────────────────────────────────────────────────
async function runInitCmd() {
  const { runInit } = await import('../lib/init.mjs');

  const args = process.argv.slice(3);
  let modulesArg = '';
  let enginesArg = 'claude';
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--modules' && args[i + 1]) { modulesArg = args[++i]; }
    else if (args[i] === '--engines' && args[i + 1]) { enginesArg = args[++i]; }
    else if (args[i] === '--force') { force = true; }
  }

  const selected = modulesArg ? modulesArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const rawEngines = enginesArg.split(',').map((s) => s.trim()).filter(Boolean);
  const engines = rawEngines.includes('claude') ? rawEngines : ['claude', ...rawEngines];

  const { manifest, conflicts } = runInit({
    selected,
    engines,
    projectDir: PROJECT_DIR,
    force,
    now: new Date().toISOString(),
    registryPath: REGISTRY,
  });

  process.stdout.write(JSON.stringify({ manifest, conflicts }, null, 2) + '\n');
  if (manifest === null) {
    process.exit(1);
  }
  process.exit(0);
}

// ── session-start (hook) ─────────────────────────────────────────────────────
function runSessionStart() {
  // --- 0. Условный переход native ↔ fallback (Task 2.8) ---------------------
  // Если нативная раскладка правил полностью валидна (.claude/rules + CLAUDE.md
  // совпадают с манифестом, версии паков актуальны) — тело правил НЕ инжектим:
  // правила уже лежат нативно. Иначе — fallback на инъекцию тела (ниже).
  // Инвариант: false ВСЕГДА ведёт в fallback — третьего пути нет, оба канала
  // доставки одновременно не выключены.
  let nativePacks = [];
  try {
    nativePacks = discoverPacks().map((p) => ({ name: p.name, version: p.version }));
  } catch (e) {
    diag(`дискавери паков для native-проверки не удалось: ${e.message} — fallback`);
    nativePacks = [];
  }
  if (nativeDeliveryValid(PROJECT_DIR, nativePacks)) {
    diag('native delivery active');
    const context =
      '<glue>\nGlue: нативная раскладка правил активна (.claude/rules). ' +
      'Тело правил не инжектится.\n</glue>';
    const payload = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  }
  diag('fallback: native delivery not validated');

  // --- 1. Резолв установленных контент-паков из реестра ---------------------
  // Формат реестра (v2): { version, plugins: { "name@marketplace": [ {installPath, version, lastUpdated, ...} ] } }
  // Контент-пак = ключ, чьё имя начинается на "glue-" и != "glue-core".
  function resolveContentPacks() {
    if (!existsSync(REGISTRY)) {
      diag(`реестр не найден: ${REGISTRY} — нечего собирать (честно сообщаю)`);
      return [];
    }
    let reg;
    try {
      reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));
    } catch (e) {
      diag(`реестр нечитаем/невалиден: ${e.message} — нечего собирать`);
      return [];
    }
    const plugins = reg && reg.plugins ? reg.plugins : {};
    const packs = [];
    for (const [key, installs] of Object.entries(plugins)) {
      const name = key.split('@')[0];
      if (!name.startsWith('glue-') || name === 'glue-core') continue;
      // выбрать установку: существующий installPath, самая свежая по lastUpdated
      const usable = (Array.isArray(installs) ? installs : [])
        .filter((i) => i && i.installPath && existsSync(i.installPath))
        .sort((a, b) => String(b.lastUpdated || '').localeCompare(String(a.lastUpdated || '')));
      if (usable.length === 0) {
        diag(`пак ${key}: записи есть, но installPath не найден на диске — пропускаю`);
        continue;
      }
      packs.push({ key, name, ...usable[0] });
    }
    return packs;
  }

  // --- 2. Чтение rules/*.md из пака (чтение ЧУЖОЙ кэш-папки) -----------------
  function readPackRules(pack) {
    const dir = join(pack.installPath, 'rules');
    if (!existsSync(dir)) return [];
    const out = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const full = join(dir, f);
      try {
        if (!statSync(full).isFile()) continue;
        const raw = readFileSync(full, 'utf8');
        // Нормализуем CRLF → LF: frontmatter-regex в parseRule завязан на \n,
        // а правило могло быть авторено на Windows с \r\n.
        const text = raw.replace(/\r\n/g, '\n');
        out.push({ file: f, ...parseRule(text, f), bytes: Buffer.byteLength(raw, 'utf8') });
      } catch (e) {
        diag(`не прочитал ${full}: ${e.message}`);
      }
    }
    return out;
  }

  // Разбор правила за один проход: title, class (из frontmatter), body (без frontmatter).
  // title: frontmatter name -> первый markdown-заголовок -> имя файла.
  function parseRule(text, fallbackFile) {
    const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const fm = m ? m[1] : '';
    const body = (m ? m[2] : text).trim();
    const nameM = fm.match(/^name:\s*(.+)$/m);
    const classM = fm.match(/^class:\s*(.+)$/m);
    const headM = body.match(/^#\s+(.+)$/m);
    const title = (nameM && nameM[1].trim()) || (headM && headM[1].trim()) || fallbackFile.replace(/\.md$/, '');
    return { title, ruleClass: classM ? classM[1].trim() : null, body };
  }

  // --- 3. Сборка + вывод ----------------------------------------------------
  const packs = resolveContentPacks();
  const collected = packs.map((p) => ({
    pack: p.name,
    version: p.version,
    installPath: p.installPath,
    rules: readPackRules(p),
  }));

  const totalRules = collected.reduce((n, p) => n + p.rules.length, 0);
  diag(`собрано паков: ${collected.length}; правил: ${totalRules}`);

  // Трасса последнего прогона (last-known-good + доказательство чтения чужих папок)
  try {
    const glueDir = join(PROJECT_DIR, '.glue');
    mkdirSync(glueDir, { recursive: true });
    // Трасса — метаданные правил без тела (тело идёт в контекст, не дублируем).
    const tracePacks = collected.map((p) => ({
      ...p,
      rules: p.rules.map(({ file, title, ruleClass, bytes }) => ({ file, title, ruleClass, bytes })),
    }));
    writeFileSync(
      join(glueDir, 'last-run.json'),
      JSON.stringify(
        { ranAt: new Date().toISOString(), registry: REGISTRY, projectDir: PROJECT_DIR, packs: tracePacks },
        null,
        2,
      ),
    );
  } catch (e) {
    diag(`трассу записать не удалось: ${e.message}`);
  }

  // Контекст для агента — видимость правил (П1: structure & visibility, без вето)
  let context;
  if (totalRules === 0) {
    context =
      '<glue>\nGlue: установленных контент-паков с правилами не найдено. ' +
      'Контроль не применяется — сообщаю честно, иллюзии покрытия нет.\n</glue>';
  } else {
    const blocks = [];
    for (const p of collected) {
      for (const r of p.rules) {
        const cls = r.ruleClass ? ` _(${r.ruleClass})_` : '';
        blocks.push(`## [${p.pack}] ${r.title}${cls}\n${r.body}`);
      }
    }
    context =
      '<glue>\nАктивные правила проекта (Glue, из установленных контент-паков). Соблюдай их:\n\n' +
      blocks.join('\n\n') +
      '\n</glue>';
  }

  // SessionStart на Claude Code: единственная корректная форма ответа.
  const payload = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };

  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}
