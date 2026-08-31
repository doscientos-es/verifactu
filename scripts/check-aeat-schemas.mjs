import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const schemas = [
  {
    name: 'SuministroLR.xsd',
    url: 'https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroLR.xsd',
  },
  {
    name: 'SuministroInformacion.xsd',
    url: 'https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd',
  },
]

function normalise(value) {
  return value
    .replaceAll('\r\n', '\n')
    .replace('http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd', 'xmldsig-core-schema.xsd')
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

let changed = false
for (const schema of schemas) {
  const response = await fetch(schema.url, { redirect: 'error' })
  if (!response.ok) throw new Error(`${schema.name}: AEAT respondió HTTP ${response.status}`)
  const remote = normalise(await response.text())
  const local = normalise(
    await readFile(
      fileURLToPath(new URL(`../src/schemas/${schema.name}`, import.meta.url)),
      'utf8',
    ),
  )
  const remoteHash = digest(remote)
  const localHash = digest(local)
  console.log(`${schema.name}: local=${localHash} aeat=${remoteHash}`)
  if (remoteHash !== localHash) changed = true
}

if (changed) {
  console.error(
    'Los XSD locales difieren de los publicados por AEAT. Revisar cambios antes de desplegar.',
  )
  process.exitCode = 1
}
