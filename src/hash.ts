import { createHash } from "node:crypto";
import { format } from "date-fns-tz";

/**
 * Verifactu / SIF hash chain (Anexo I, Orden HAC/1177/2024).
 *
 * Each invoice's `current_hash` is SHA-256 of the concatenated fiscal fields
 * separated by `&`, returned as UPPERCASE hex (64 chars).
 * The first invoice of the chain uses '0' as `previous_hash`.
 *
 * Field order (Anexo I):
 *   NIF & NumSerie & FechaExpedicion & TipoFactura & CuotaTotal &
 *   ImporteTotal & HuellaAnterior & FechaHoraHusoHorarioFirma
 */
export type HashInput = {
  nif: string;
  invoiceNumber: string;
  invoiceType: string;
  issueDate: Date;
  taxAmount: number;
  total: number;
  previousHash: string | null;
  generatedAt: Date;
};

const MADRID_TZ = "Europe/Madrid";

function ddmmyyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

function n2(x: number): string {
  return x.toFixed(2);
}

/**
 * Returns DD-MM-YYYYTHH:MM:SS+HH:MM in Europe/Madrid local time,
 * as required by FechaHoraHusoHorarioFirma (Anexo I, HAC/1177/2024).
 */
export function spanishTimestamp(d: Date): string {
  return format(d, "dd-MM-yyyy'T'HH:mm:ssxxx", { timeZone: MADRID_TZ });
}

export function buildHashPayload(input: HashInput): string {
  const previous = input.previousHash && input.previousHash.length > 0 ? input.previousHash : "0";
  return [
    input.nif,
    input.invoiceNumber,
    ddmmyyyy(input.issueDate), // FechaExpedicion — position 3 per Anexo I
    input.invoiceType, // TipoFactura — position 4 per Anexo I
    n2(input.taxAmount),
    n2(input.total),
    previous,
    spanishTimestamp(input.generatedAt),
  ].join("&"); // separator is `&` per Anexo I
}

export function computeInvoiceHash(input: HashInput): string {
  return createHash("sha256").update(buildHashPayload(input), "utf8").digest("hex").toUpperCase();
}
