const OPEN = /^\s*<!--\s*module:([\w-]+)\s*-->\s*$/
const CLOSE = /^\s*<!--\s*\/module\s*-->\s*$/

// Оставляет содержимое блоков из keepIds (снимая маркеры),
// удаляет блоки модулей не из keepIds целиком. Маркеры в выводе не остаются.
export function filterModuleBlocks(text, keepIds) {
  const keep = new Set(keepIds)
  const out = []
  let openId = null   // id текущего открытого блока, либо null
  let skipping = false

  for (const line of text.split('\n')) {
    const open = line.match(OPEN)
    if (open) {
      if (openId !== null) {
        throw new Error(`nested module block: ${open[1]} inside ${openId}`)
      }
      openId = open[1]
      skipping = !keep.has(openId)
      continue // маркер не пишем
    }
    if (CLOSE.test(line)) {
      if (openId === null) throw new Error('stray <!-- /module --> with no open block')
      openId = null
      skipping = false
      continue // маркер не пишем
    }
    if (skipping) continue
    out.push(line)
  }

  if (openId !== null) throw new Error(`unclosed module block: ${openId}`)
  return out.join('\n')
}
