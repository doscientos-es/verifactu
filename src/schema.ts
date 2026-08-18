import type { ValidationError } from "@richhouse83/xsd-validator";
import * as xsdValidatorModule from "@richhouse83/xsd-validator";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type XsdValidationResult =
  | { valid: true }
  | { valid: false; errors: Array<{ message: string; line: number | null; column: number | null; code: number | null }> };

function schemaFile(name: string): URL {
  return new URL(`./schemas/${name}`, import.meta.url);
}

function readSchema(name: string): string {
  return readFileSync(schemaFile(name), "utf8");
}

const suministroInformacion = readSchema("SuministroInformacion.xsd");
const suministroLr = readSchema("SuministroLR.xsd");
const xmldsig = readSchema("xmldsig-core-schema.xsd");
const schemasBaseUrl = fileURLToPath(new URL("./schemas/", import.meta.url));
const validateSchema = (((xsdValidatorModule as unknown as { default?: unknown }).default as { default?: unknown } | undefined)?.default ??
  (xsdValidatorModule as unknown as { default?: unknown }).default ??
  xsdValidatorModule) as (
    xml: string,
    xsdSchema: string,
    xmlParserOptions?: { nonet?: boolean },
    xsdParserOptions?: { baseUrl?: string; nonet?: boolean },
  ) => true | ValidationError[];

/**
 * Validate a Veri*Factu submission against the schemas published by AEAT.
 * The schemas are packaged with the module; no network call is made here.
 */
export function validateVerifactuXsd(xml: string): XsdValidationResult {
  if (typeof xml !== "string" || xml.length === 0) {
    return { valid: false, errors: [{ message: "XML vacío", line: null, column: null, code: null }] };
  }
  try {
    const result = validateSchema(
      xml,
      suministroLr,
      { nonet: true },
      { baseUrl: schemasBaseUrl, nonet: true },
    );
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
