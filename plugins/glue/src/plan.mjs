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
