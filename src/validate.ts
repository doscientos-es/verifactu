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
import { XMLValidator } from 'fast-xml-parser'

import type { VatLine, VerifactuCancellationInput, VerifactuSubmitInput } from './client'
import type { VerifactuSoftware } from './types'

/** Outcome of {@link validateVerifactuXml}. Never thrown — always returned. */
export type XmlValidationResult =
  | { valid: true }
  | { valid: false; message: string; line?: number; column?: number }

/**
 * Validate that `xml` is well-formed. Pure and side-effect free; safe to call
 * on every submission. Returns a discriminated result instead of throwing so
 * callers can map failures to a typed error without try/catch.
 */
export function validateVerifactuXml(xml: string): XmlValidationResult {
  const result = XMLValidator.validate(xml)
  if (result === true) return { valid: true }
  const err = result.err
  return {
    valid: false,
    message: err?.msg ?? 'malformed XML',
    line: err?.line,
    column: err?.col,
  }
}

export type FiscalValidationResult = { valid: true } | { valid: false; message: string }

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validReferences(
  refs: Array<{ invoiceNumber: string; issueDate: Date }> | undefined,
): boolean {
  return (
    refs === undefined ||
    (Array.isArray(refs) &&
      refs.length <= 1000 &&
      refs.every(
        (ref) =>
          !!ref &&
          typeof ref === 'object' &&
          hasText(ref.invoiceNumber) &&
          validDate(ref.issueDate),
      ))
  )
}

function hasValidAmounts(lines: VatLine[], taxAmount: number, total: number): boolean {
  if (!Number.isFinite(taxAmount) || !Number.isFinite(total) || taxAmount < 0 || total < 0) {
    return false
  }
  if (!Array.isArray(lines) || lines.length === 0) return false
  const taxFromLines = lines.reduce((sum, line) => {
    if (
      !line ||
      typeof line !== 'object' ||
      !Number.isFinite(line.rate) ||
      !Number.isFinite(line.base) ||
      !Number.isFinite(line.tax) ||
      line.base < 0 ||
      line.tax < 0
    ) {
      return Number.NaN
    }
    return sum + line.tax
  }, 0)
  const baseFromLines = lines.reduce(
    (sum, line) => sum + (Number.isFinite(line?.base) ? line.base : Number.NaN),
    0,
  )
  return (
    Number.isFinite(taxFromLines) &&
    Math.abs(taxFromLines - taxAmount) < 0.005 &&
    Math.abs(baseFromLines + taxAmount - total) < 0.005
  )
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
  if (
    !input ||
    typeof input !== 'object' ||
    !hasText(input.nif) ||
    !hasText(input.emisorName) ||
    !hasText(input.invoiceNumber)
  ) {
    return { valid: false, message: 'Faltan los datos identificativos de la factura' }
  }
  if (!validDate(input.issueDate) || !validDate(input.generatedAt)) {
    return { valid: false, message: 'La fecha fiscal no es válida' }
  }
  if (!hasText(input.descriptionOperacion)) {
    return { valid: false, message: 'La descripción de la operación es obligatoria' }
  }
  if (!hasValidAmounts(input.vatLines, input.taxAmount, input.total)) {
    return { valid: false, message: 'El desglose de IVA no cuadra con los importes de la factura' }
  }
  const supportedTypes = new Set(['F1', 'F2', 'R1', 'R2', 'R3', 'R4', 'R5'])
  if (typeof input.invoiceType !== 'string') {
    return { valid: false, message: 'El tipo de factura no es válido' }
  }
  if (!supportedTypes.has(input.invoiceType)) {
    return {
      valid: false,
      message: `Tipo de factura ${input.invoiceType} no soportado aún por este SIF`,
    }
  }
  const rectificative = input.invoiceType.startsWith('R')
  if (rectificative && input.rectificationType !== 'S' && input.rectificationType !== 'I') {
    return { valid: false, message: 'Una factura rectificativa requiere TipoRectificativa' }
  }
  if (
    input.rectificationAmounts &&
    (!Number.isFinite(input.rectificationAmounts.base) ||
      !Number.isFinite(input.rectificationAmounts.tax) ||
      (input.rectificationAmounts.surcharge !== undefined &&
        !Number.isFinite(input.rectificationAmounts.surcharge)))
  ) {
    return { valid: false, message: 'Los importes de rectificación no son válidos' }
  }
  if (input.subsanacion !== undefined && input.subsanacion !== 'S' && input.subsanacion !== 'N') {
    return { valid: false, message: 'Subsanacion debe ser S o N' }
  }
  if (input.rechazoPrevio !== undefined && !['N', 'S', 'X'].includes(input.rechazoPrevio)) {
    return { valid: false, message: 'RechazoPrevio debe ser N, S o X' }
  }
  if (
    !rectificative &&
    (input.rectificationType ||
      input.rectifiedInvoices?.length ||
      input.substitutedInvoices?.length ||
      input.rectificationAmounts)
  ) {
    return {
      valid: false,
      message: 'Los datos de rectificación solo pueden usarse con una factura rectificativa',
    }
  }
  if (!validReferences(input.rectifiedInvoices) || !validReferences(input.substitutedInvoices)) {
    return { valid: false, message: 'Las referencias de facturas rectificadas no son válidas' }
  }
  if (input.rechazoPrevio === 'X' && input.subsanacion !== 'S') {
    return { valid: false, message: 'RechazoPrevio=X requiere Subsanacion=S' }
  }
  if (
    input.externalReference !== undefined &&
    (typeof input.externalReference !== 'string' ||
      input.externalReference.trim().length === 0 ||
      input.externalReference.length > 60)
  ) {
    return { valid: false, message: 'La referencia externa debe tener entre 1 y 60 caracteres' }
  }
  if (input.invoiceType === 'F1' && (!hasText(input.clientNif) || !hasText(input.clientName))) {
    return { valid: false, message: 'Una factura F1 requiere NIF y razón social del destinatario' }
  }
  const previousComplete =
    hasText(input.previousHash) &&
    hasText(input.previousInvoiceNumber) &&
    input.previousIssueDate !== null &&
    validDate(input.previousIssueDate)
  const previousEmpty =
    !hasText(input.previousHash) &&
    !hasText(input.previousInvoiceNumber) &&
    input.previousIssueDate === null
  if (!previousComplete && !previousEmpty) {
    return { valid: false, message: 'El encadenamiento anterior está incompleto' }
  }
  if (
    !hasText(software.producerName) ||
    !hasText(software.producerNif) ||
    !hasText(software.name) ||
    !/^[A-Z0-9Ñ]{1,2}$/.test(software.id) ||
    !hasText(software.version) ||
    !hasText(software.installationNumber)
  ) {
    return { valid: false, message: 'La identidad del productor o del SIF no está configurada' }
  }
  return { valid: true }
}

export function validateVerifactuCancellation(
  input: VerifactuCancellationInput,
  software: VerifactuSoftware,
): FiscalValidationResult {
  if (
    !input ||
    typeof input !== 'object' ||
    !hasText(input.nif) ||
    !hasText(input.emisorName) ||
    !hasText(input.cancelledInvoiceNumber) ||
    !validDate(input.cancelledInvoiceIssueDate) ||
    !validDate(input.generatedAt)
  ) {
    return { valid: false, message: 'Los datos de anulación no son válidos' }
  }
  if (input.sinRegistroPrevio !== undefined && !['S', 'N'].includes(input.sinRegistroPrevio)) {
    return { valid: false, message: 'SinRegistroPrevio debe ser S o N' }
  }
  if (input.rechazoPrevio !== undefined && !['S', 'N'].includes(input.rechazoPrevio)) {
    return { valid: false, message: 'RechazoPrevio debe ser S o N' }
  }
  if (
    input.externalReference !== undefined &&
    (typeof input.externalReference !== 'string' ||
      input.externalReference.trim().length === 0 ||
      input.externalReference.length > 60)
  ) {
    return { valid: false, message: 'La referencia externa debe tener entre 1 y 60 caracteres' }
  }
  const previousComplete =
    hasText(input.previousHash) &&
    hasText(input.previousInvoiceNumber) &&
    input.previousIssueDate !== null &&
    validDate(input.previousIssueDate)
  const previousEmpty =
    !hasText(input.previousHash) &&
    !hasText(input.previousInvoiceNumber) &&
    input.previousIssueDate === null
  if (!previousComplete && !previousEmpty) {
    return { valid: false, message: 'El encadenamiento anterior de la anulación está incompleto' }
  }
  if (!hasText(software.producerName) || !hasText(software.producerNif)) {
    return { valid: false, message: 'La identidad del productor del SIF no está configurada' }
  }
  return { valid: true }
}
