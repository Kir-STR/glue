import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..')
const OPEN = /<!--\s*module:([\w-]+)\s*-->/g

test('each instruction template carries blocks for all 10 modules and no retro-loop', () => {
  const reg = JSON.parse(readFileSync(join(PACK, 'rules', 'registry.json'), 'utf8'))
  const want = new Set(Object.values(reg).map((m) => m.instructionBlock))
  for (const f of ['CLAUDE.md.tmpl', 'AGENTS.md.tmpl', 'GEMINI.md.tmpl']) {
    const text = readFileSync(join(PACK, 'rules', 'instructions', f), 'utf8')
    const ids = new Set([...text.matchAll(OPEN)].map((m) => m[1]))
    for (const id of want) assert.ok(ids.has(id), `${f} missing block ${id}`)
    assert.ok(!ids.has('retro-loop'), `${f} must not carry retro-loop`)
  }
})
