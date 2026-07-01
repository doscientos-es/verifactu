/**
 * IDFACT — Identificador Único de Registro de Facturación.
 * Format: NIF-INVOICE_NUMBER-YYYYMMDD
 * Must appear on the invoice PDF and public portal (RD 1007/2023).
 */
export function buildIdfact(nif: string, fullNumber: string, issueDate: Date): string {
  const yyyy = issueDate.getUTCFullYear();
  const mm = String(issueDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(issueDate.getUTCDate()).padStart(2, "0");
  return `${nif}-${fullNumber}-${yyyy}${mm}${dd}`;
}
