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
import type { VatLine, VerifactuCancellationInput, VerifactuSubmitInput } from "./client";
import type { VerifactuSoftware } from "./types";

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

export type FiscalValidationResult = { valid: true } | { valid: false; message: string };

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValidAmounts(lines: VatLine[], taxAmount: number, total: number): boolean {
  if (!Number.isFinite(taxAmount) || !Number.isFinite(total) || taxAmount < 0 || total < 0) {
    return false;
  }
  if (lines.length === 0) return false;
  const taxFromLines = lines.reduce((sum, line) => {
    if (
      !Number.isFinite(line.rate) ||
      !Number.isFinite(line.base) ||
      !Number.isFinite(line.tax) ||
      line.base < 0 ||
      line.tax < 0
    ) {
      return Number.NaN;
    }
    return sum + line.tax;
  }, 0);
  const baseFromLines = lines.reduce((sum, line) => sum + line.base, 0);
  return (
    Number.isFinite(taxFromLines) &&
    Math.abs(taxFromLines - taxAmount) < 0.005 &&
    Math.abs(baseFromLines + taxAmount - total) < 0.005
  );
}

/**
 * Local, fail-closed checks for the deliberately supported VERI*FACTU subset.
 * XSD validation remains an additional boundary, not a replacement for these
 * cross-field fiscal rules.
 */
export function validateVerifactuSubmission(
  input: VerifactuSubmitInput,
  software: VerifactuSoftware,
): FiscalValidationResult {
  if (!hasText(input.nif) || !hasText(input.emisorName) || !hasText(input.invoiceNumber)) {
    return { valid: false, message: "Faltan los datos identificativos de la factura" };
  }
  if (!validDate(input.issueDate) || !validDate(input.generatedAt)) {
    return { valid: false, message: "La fecha fiscal no es válida" };
  }
  if (!hasText(input.descriptionOperacion)) {
    return { valid: false, message: "La descripción de la operación es obligatoria" };
  }
  if (!hasValidAmounts(input.vatLines, input.taxAmount, input.total)) {
    return { valid: false, message: "El desglose de IVA no cuadra con los importes de la factura" };
  }
  if (input.invoiceType !== "F1" && input.invoiceType !== "F2") {
    return {
      valid: false,
      message: `Tipo de factura ${input.invoiceType} no soportado aún por este SIF`,
    };
  }
  if (input.invoiceType === "F1" && (!hasText(input.clientNif) || !hasText(input.clientName))) {
    return { valid: false, message: "Una factura F1 requiere NIF y razón social del destinatario" };
  }
  const previousComplete =
    hasText(input.previousHash) &&
    hasText(input.previousInvoiceNumber) &&
    input.previousIssueDate !== null &&
    validDate(input.previousIssueDate);
  const previousEmpty =
    !hasText(input.previousHash) && !hasText(input.previousInvoiceNumber) && input.previousIssueDate === null;
  if (!previousComplete && !previousEmpty) {
    return { valid: false, message: "El encadenamiento anterior está incompleto" };
  }
  if (
    !hasText(software.producerName) ||
    !hasText(software.producerNif) ||
    !hasText(software.name) ||
    !/^[A-Z0-9Ñ]{1,2}$/.test(software.id) ||
    !hasText(software.version) ||
    !hasText(software.installationNumber)
  ) {
    return { valid: false, message: "La identidad del productor o del SIF no está configurada" };
  }
  return { valid: true };
}

export function validateVerifactuCancellation(
  input: VerifactuCancellationInput,
  software: VerifactuSoftware,
): FiscalValidationResult {
  if (
    !hasText(input.nif) ||
    !hasText(input.emisorName) ||
    !hasText(input.cancelledInvoiceNumber) ||
    !validDate(input.cancelledInvoiceIssueDate) ||
    !validDate(input.generatedAt)
  ) {
    return { valid: false, message: "Los datos de anulación no son válidos" };
  }
  const previousComplete =
    hasText(input.previousHash) &&
    hasText(input.previousInvoiceNumber) &&
    input.previousIssueDate !== null &&
    validDate(input.previousIssueDate);
  const previousEmpty =
    !hasText(input.previousHash) && !hasText(input.previousInvoiceNumber) && input.previousIssueDate === null;
  if (!previousComplete && !previousEmpty) {
    return { valid: false, message: "El encadenamiento anterior de la anulación está incompleto" };
  }
  if (!hasText(software.producerName) || !hasText(software.producerNif)) {
    return { valid: false, message: "La identidad del productor del SIF no está configurada" };
  }
  return { valid: true };
}
