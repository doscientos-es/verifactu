import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(resolve(root, 'dist/schemas'), { recursive: true })
cpSync(resolve(root, 'src/schemas'), resolve(root, 'dist/schemas'), { recursive: true })
