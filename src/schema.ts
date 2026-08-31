import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import type { ValidationError } from '@richhouse83/xsd-validator'

export type XsdValidationResult =
  | { valid: true }
  | {
      valid: false
      errors: Array<{
        message: string
        line: number | null
        column: number | null
        code: number | null
      }>
    }

function schemaFile(name: string): URL {
  return new URL(`./schemas/${name}`, import.meta.url)
}

function readSchema(name: string): string {
  return readFileSync(schemaFile(name), 'utf8')
}

const suministroInformacion = readSchema('SuministroInformacion.xsd')
const suministroLr = readSchema('SuministroLR.xsd')
const xmldsig = readSchema('xmldsig-core-schema.xsd')
const schemasBaseUrl = fileURLToPath(new URL('./schemas/', import.meta.url))
const require = createRequire(import.meta.url)

type XsdValidator = (
  xml: string,
  xsdSchema: string,
  xmlParserOptions?: { nonet?: boolean },
  xsdParserOptions?: { baseUrl?: string; nonet?: boolean },
) => true | ValidationError[]

/**
 * The XSD validator depends on libxmljs2, a native module. Loading it at the
 * package entry point made QR-only and non-fiscal routes fail when the native
 * binding is unavailable. Require it only at the XSD validation boundary.
 */
function loadXsdValidator(): XsdValidator {
  const xsdValidatorModule = require('@richhouse83/xsd-validator') as { default?: unknown }
  return ((xsdValidatorModule.default as { default?: unknown } | undefined)?.default ??
    xsdValidatorModule.default ??
    xsdValidatorModule) as XsdValidator
}

/**
 * Validate a Veri*Factu submission against the schemas published by AEAT.
 * The schemas are packaged with the module; no network call is made here.
 */
export function validateVerifactuXsd(xml: string): XsdValidationResult {
  if (typeof xml !== 'string' || xml.length === 0) {
    return {
      valid: false,
      errors: [{ message: 'XML vacío', line: null, column: null, code: null }],
    }
  }
  try {
    const result = loadXsdValidator()(
      xml,
      suministroLr,
      { nonet: true },
      { baseUrl: schemasBaseUrl, nonet: true },
    )
    if (result === true) return { valid: true }
    return { valid: false, errors: result.map(toValidationError) }
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
          line: null,
          column: null,
          code: null,
        },
      ],
    }
  }
}

function toValidationError(error: ValidationError) {
  return {
    message: error.message,
    line: error.line,
    column: error.column ?? null,
    code: error.code,
  }
}

// Keep these exports available to package-level conformance tests and adapters
// that need to compose the official import graph themselves.
export const officialVerifactuSchemas = {
  suministroLr,
  suministroInformacion,
  xmldsig,
} as const
