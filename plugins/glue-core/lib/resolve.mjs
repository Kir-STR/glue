// Возвращает selected + дотянутые зависимости в топологическом порядке
// (каждая зависимость стоит раньше зависящего от неё модуля).
export function resolveDependencies(registry, selected) {
  const resolved = []
  const visiting = new Set()
  const done = new Set()

  function visit(id, chain) {
    if (done.has(id)) return
    if (visiting.has(id)) {
      throw new Error(`Dependency cycle: ${[...chain, id].join(' → ')}`)
    }
    if (!registry[id]) {
      throw new Error(`Unknown module: ${id}`)
    }
    visiting.add(id)
    for (const dep of registry[id].dependsOn ?? []) {
      visit(dep, [...chain, id])
    }
    visiting.delete(id)
    done.add(id)
    resolved.push(id)
  }

  for (const id of selected) visit(id, [])
  return resolved
}
