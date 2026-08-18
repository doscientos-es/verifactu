import { spanishDate } from "./hash";

/**
 * IDFACT — Identificador Único de Registro de Facturación.
 * Format: NIF-INVOICE_NUMBER-YYYYMMDD
 * Must appear on the invoice PDF and public portal (RD 1007/2023).
 */
export function buildIdfact(nif: string, fullNumber: string, issueDate: Date): string {
  const [dd, mm, yyyy] = spanishDate(issueDate).split("-");
  return `${nif}-${fullNumber}-${yyyy}${mm}${dd}`;
}
