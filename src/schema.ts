import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import validateSchema, { type ValidationError } from "@richhouse83/xsd-validator";

export type XsdValidationResult =
  | { valid: true }
  | { valid: false; errors: Array<{ message: string; line: number | null; column: number | null; code: number | null }> };

function readSchema(name: string): string {
  return readFileSync(new URL(`./schemas/${name}`, import.meta.url), "utf8");
}

const suministroLr = readSchema("SuministroLR.xsd");
const suministroInformacion = readSchema("SuministroInformacion.xsd");
const xmldsig = readSchema("xmldsig-core-schema.xsd");

/**
 * Validate a Veri*Factu submission against the schemas published by AEAT.
 * The schemas are packaged with the module; no network call is made here.
 */
export function validateVerifactuXsd(xml: string): XsdValidationResult {
  try {
    const result = validateSchema(xml, suministroLr, undefined, {
      baseUrl: fileURLToPath(new URL("./schemas/", import.meta.url)),
    } as never);
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
