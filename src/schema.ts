import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as xsdValidatorModule from "@richhouse83/xsd-validator";
import type { ValidationError } from "@richhouse83/xsd-validator";

export type XsdValidationResult =
  | { valid: true }
  | { valid: false; errors: Array<{ message: string; line: number | null; column: number | null; code: number | null }> };

function schemaFile(name: string): URL {
  return new URL(`./schemas/${name}`, import.meta.url);
}

function readSchema(name: string): string {
  return readFileSync(schemaFile(name), "utf8");
}

const suministroInformacion = readSchema("SuministroInformacion.xsd").replace(
  'schemaLocation="http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd"',
  `schemaLocation="${pathToFileURL(fileURLToPath(schemaFile("xmldsig-core-schema.xsd"))).href}"`,
);
const suministroLr = readSchema("SuministroLR.xsd").replace(
  'schemaLocation="SuministroInformacion.xsd"',
  `schemaLocation="${pathToFileURL(fileURLToPath(schemaFile("SuministroInformacion.xsd"))).href}"`,
);
const xmldsig = readSchema("xmldsig-core-schema.xsd");
const validateSchema = (((xsdValidatorModule as unknown as { default?: unknown }).default as { default?: unknown } | undefined)?.default ??
  (xsdValidatorModule as unknown as { default?: unknown }).default ??
  xsdValidatorModule) as (
  xml: string,
  xsdSchema: string,
) => true | ValidationError[];

/**
 * Validate a Veri*Factu submission against the schemas published by AEAT.
 * The schemas are packaged with the module; no network call is made here.
 */
export function validateVerifactuXsd(xml: string): XsdValidationResult {
  try {
    const result = validateSchema(xml, suministroLr);
    if (result === true) return { valid: true };
    return { valid: false, errors: result.map(toValidationError) };
  } catch (error) {
    return {
      valid: false,
      errors: [{ message: error instanceof Error ? error.message : String(error), line: null, column: null, code: null }],
    };
  }
}

function toValidationError(error: ValidationError) {
  return {
    message: error.message,
    line: error.line,
    column: error.column ?? null,
    code: error.code,
  };
}

// Keep these exports available to package-level conformance tests and adapters
// that need to compose the official import graph themselves.
export const officialVerifactuSchemas = {
  suministroLr,
  suministroInformacion,
  xmldsig,
} as const;
