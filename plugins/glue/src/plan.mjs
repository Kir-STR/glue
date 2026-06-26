import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { hashContent } from './hash.mjs'
import { filterModuleBlocks } from './blocks.mjs'
import { safeTargetPath } from './paths.mjs'
import { readManifest, isUsablePrevManifest } from './manifest.mjs'

// engine → [instruction template filename, target relative path]
const ENGINE_INSTRUCTIONS = {
  claude: ['CLAUDE.md.tmpl', 'CLAUDE.md'],
  codex: ['AGENTS.md.tmpl', 'AGENTS.md'],
  gemini: ['GEMINI.md.tmpl', 'GEMINI.md'],
}
export const KNOWN_ENGINES = Object.keys(ENGINE_INSTRUCTIONS)

// Instruction-targetPath движка (claude→CLAUDE.md, codex→AGENTS.md, gemini→GEMINI.md); null для неизвестного.
export function engineTarget(engine) {
  return ENGINE_INSTRUCTIONS[engine]?.[1] ?? null
}

// Чистый конфликт-алгоритм: решает writes/materialized/deletes/conflicts по
// targets + prevManifest + diskHashFn. Не читает bundle, не знает про движки.
export function decidePlan({ targets, prevManifest, diskHashFn, force = false }) {
  const prevFiles = new Map((prevManifest?.files ?? []).map((f) => [f.targetPath, f]))
  const writes = []
  const materialized = []
  const deletes = []
  const conflicts = []
  const newTargetPaths = new Set(targets.map((t) => t.targetPath))

  for (const t of targets) {
    const current = diskHashFn(t.targetPath)
    const writtenHash = prevFiles.get(t.targetPath)?.writtenHash ?? null

    const writeEntry = (expectedCurrentHash) =>
      writes.push({
        targetPath: t.targetPath,
        plannedHash: t.plannedHash,
        content: t.content,
        sourceTemplate: t.sourceTemplate,
        kind: t.kind,
        expectedCurrentHash,
      })

    if (current === null) {
      writeEntry(null)
    } else if (current === t.plannedHash) {
      materialized.push({
        targetPath: t.targetPath,
        plannedHash: t.plannedHash,
        sourceTemplate: t.sourceTemplate,
        kind: t.kind,
      })
    } else if (writtenHash !== null && current === writtenHash) {
      writeEntry(writtenHash)
    } else if (force) {
      writeEntry(current)
    } else {
      conflicts.push({ targetPath: t.targetPath, reason: 'hash mismatch' })
    }
  }

  for (const [targetPath, f] of prevFiles) {
    if (newTargetPaths.has(targetPath)) continue
    const current = diskHashFn(targetPath)
    if (current === null) continue
    if (current === f.writtenHash) {
      deletes.push({ targetPath, expectedCurrentHash: f.writtenHash })
    } else if (force) {
      deletes.push({ targetPath, expectedCurrentHash: current })
    } else {
      conflicts.push({ targetPath, reason: 'dropped file hand-edited' })
    }
  }

  return { writes, materialized, deletes, conflicts }
}

// Строит планируемые targets из встроенного контента. Источник доверенный
// (свой bundle) — path-safety источника не применяется.
export function buildTargets({ registry, modules, engines, contract, pluginRoot }) {
  // fail-fast на неизвестный движок ДО любого чтения
  for (const engine of engines) {
    if (!ENGINE_INSTRUCTIONS[engine]) throw new Error(`Unknown engine: ${engine}`)
  }

  const targets = []
  const deliveredEngines = []

  // 1. Rule-файлы — по одному на имя из templates[] каждого модуля (в порядке modules).
  for (const id of modules) {
    const mod = registry[id]
    for (const file of mod.templates) {
      const content = readFileSync(join(pluginRoot, contract.modulesDir, file), 'utf8')
      targets.push({
        targetPath: '.claude/rules/' + file,
        plannedHash: hashContent(content),
        content,
        sourceTemplate: file,
        kind: 'rule',
      })
    }
  }

  // 2. Instruction-файлы — по одному на движок; .tmpl обязан существовать.
  for (const engine of engines) {
    const [tmpl, targetFile] = ENGINE_INSTRUCTIONS[engine]
    const src = join(pluginRoot, contract.instructionsDir, tmpl)
    if (!existsSync(src)) {
      throw new Error(`bundle missing instruction template for engine '${engine}': ${tmpl}`)
    }
    const filtered = filterModuleBlocks(readFileSync(src, 'utf8'), modules)
    targets.push({
      targetPath: targetFile,
      plannedHash: hashContent(filtered),
      content: filtered,
      sourceTemplate: tmpl,
      kind: 'instruction',
    })
    deliveredEngines.push(engine)
  }

  return { targets, deliveredEngines }
}

// Тонкая композиция: buildTargets + prevManifest-гейт + diskHashFn + decidePlan.
export function plan({ registry, modules, engines, contract, pluginRoot, projectDir, force = false }) {
  const { targets, deliveredEngines } = buildTargets({ registry, modules, engines, contract, pluginRoot })

  const raw = readManifest(projectDir)
  const prevManifest = isUsablePrevManifest(raw) ? raw : null

  const diskHashFn = (rel) => {
    const abs = safeTargetPath(projectDir, rel)
    if (!existsSync(abs)) return null
    return hashContent(readFileSync(abs, 'utf8'))
  }

  const { writes, materialized, deletes, conflicts } = decidePlan({ targets, prevManifest, diskHashFn, force })
  return { writes, materialized, deletes, conflicts, deliveredEngines }
}
