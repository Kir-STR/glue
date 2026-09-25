import { createHash } from 'node:crypto'

// CRLF → LF: checkout с core.autocrlf=true не должен давать ложный changed.
export function hashContent(data) {
  return createHash('sha256').update(data.replace(/\r\n/g, '\n')).digest('hex')
}
