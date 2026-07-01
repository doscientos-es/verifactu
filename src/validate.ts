/**
 * XML well-formedness validation for the Verifactu package (public API).
 *
 * A fast, dependency-light safety net that runs BEFORE any network call so we
 * never ship a malformed payload to AEAT. It guarantees the XML we generated is
 * well-formed (balanced tags, escaped entities, single root), catching breakage
 * introduced by future changes to the XML builder.
 *
 * This is intentionally NOT full XSD validation against the official AEAT
 * schema — that needs the schema files and is a separate, heavier step. This
 * check eliminates the most common class of malformed-payload rejections at
 * zero extra dependency cost (`fast-xml-parser` is already used to parse the
 * SOAP response).
 */
import { XMLValidator } from "fast-xml-parser";

/** Outcome of {@link validateVerifactuXml}. Never thrown — always returned. */
export type XmlValidationResult =
  | { valid: true }
  | { valid: false; message: string; line?: number; column?: number };

/**
 * Validate that `xml` is well-formed. Pure and side-effect free; safe to call
 * on every submission. Returns a discriminated result instead of throwing so
 * callers can map failures to a typed error without try/catch.
 */
export function validateVerifactuXml(xml: string): XmlValidationResult {
  const result = XMLValidator.validate(xml);
  if (result === true) return { valid: true };
  const err = result.err;
  return {
    valid: false,
    message: err?.msg ?? "malformed XML",
    line: err?.line,
    column: err?.col,
  };
}
