#!/usr/bin/env node
// glue — core-команда (MVP 0.1.0).
//
// Задача среза: из core-плагина в рантайме хука собрать видимость правил,
// которые лежат в ОТДЕЛЬНЫХ установленных контент-паках (glue-*). Это и есть
// проверка несущего риска: судья/команда в core читает контент чужого пака.
//
// Каналы (контракт формы): stdout = ответ (SessionStart additionalContext, JSON),
// stderr = только диагностика, exit-code = итог. Плюс трасса последнего прогона
// в .glue/last-run.json проекта (last-known-good + доказательство чтения).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = process.env.HOME || process.env.USERPROFILE || homedir();
const REGISTRY = join(HOME, '.claude', 'plugins', 'installed_plugins.json');
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const diag = (msg) => process.stderr.write(`[glue] ${msg}\n`);

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
      const text = readFileSync(full, 'utf8');
      out.push({ file: f, title: extractTitle(text, f), bytes: Buffer.byteLength(text, 'utf8') });
    } catch (e) {
      diag(`не прочитал ${full}: ${e.message}`);
    }
  }
  return out;
}

// title: frontmatter name -> первый markdown-заголовок -> имя файла
function extractTitle(text, fallbackFile) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const m = fm[1].match(/^name:\s*(.+)$/m);
    if (m) return m[1].trim();
  }
  const h = text.match(/^#\s+(.+)$/m);
  if (h) return h[1].trim();
  return fallbackFile.replace(/\.md$/, '');
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
  writeFileSync(
    join(glueDir, 'last-run.json'),
    JSON.stringify(
      { ranAt: new Date().toISOString(), registry: REGISTRY, projectDir: PROJECT_DIR, packs: collected },
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
  const lines = [];
  for (const p of collected) {
    for (const r of p.rules) lines.push(`- [${p.pack}] ${r.title} (${r.file})`);
  }
  context =
    '<glue>\nАктивные правила проекта (Glue собрал из установленных контент-паков):\n' +
    lines.join('\n') +
    '\n</glue>';
}

// SessionStart на Claude Code: единственная корректная форма ответа.
const payload = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };

process.stdout.write(JSON.stringify(payload));
process.exit(0);
