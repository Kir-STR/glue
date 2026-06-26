import { createHash } from 'node:crypto'

export function hashContent(data) {
  return createHash('sha256').update(data).digest('hex')
}
