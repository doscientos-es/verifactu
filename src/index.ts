/**
 * Public API surface for the Verifactu package (`@doscientos/verifactu`).
 *
 * Import everything a consuming app needs from this barrel — the individual
 * modules are implementation detail and may be reorganised. The recommended
 * entry point is {@link createVerifactuClient}.
 *
 * Deliberately NOT exported: `verifactuConfigFromEnv()` (in `config.ts`). That
 * adapter reads this app's environment and is the one file that stays behind in
 * each consuming project when the package is extracted. Consumers build their
 * own `VerifactuConfig` and pass it to {@link createVerifactuClient}.
 */

// ── Billing-record submission (inputs/outputs + free functions) ──────────────
export {
  buildVerifactuCancellationXml,
  buildVerifactuXml,
  cancelInVerifactu,
  submitToVerifactu
} from "./client";
export type {
  InvoiceReference, VatLine, VerifactuCancellationInput,
  VerifactuErrorCode,
  VerifactuSubmitInput,
  VerifactuSubmitResult
} from "./client";

// ── High-level facade (recommended entry point) ──────────────────────────────
export { createVerifactuClient } from "./facade";
export type { VerifactuClient } from "./facade";

// ── Hash-chain verification ───────────────────────────────────────────────────
export {
  buildCancellationHashPayload,
  buildHashPayload,
  computeCancellationHash,
  computeInvoiceHash,
  spanishTimestamp
} from "./hash";
export type { CancellationHashInput, HashInput } from "./hash";

// ── Logging port ─────────────────────────────────────────────────────────────
export { noopLogger, type VerifactuLogger } from "./logger";

// ── QR generation ────────────────────────────────────────────────────────────
export { buildQrDataUrl, buildQrUrl } from "./qr";
export type { QrParams } from "./qr";

// ── Configuration contract (inputs) ─────────────────────────────────────────
export type {
  VerifactuCertificate,
  VerifactuConfig,
  VerifactuEnvironment,
  VerifactuQrConfig,
  VerifactuSoftware
} from "./types";

// ── Local XML and fiscal validation ──────────────────────────────────────────
export {
  validateVerifactuCancellation,
  validateVerifactuSubmission,
  validateVerifactuXml
} from "./validate";
export type { FiscalValidationResult, XmlValidationResult } from "./validate";

export { validateVerifactuXsd } from "./schema";
export type { XsdValidationResult } from "./schema";

// ── Durable ledger/outbox engine (storage agnostic) ───────────────────────────
export {
  formatVerifactuDeliveryError,
  isRetryableVerifactuDelivery,
  normalizeAltaRechazoPrevio,
  parseDurableAltaPayload,
  parseDurableCancellationPayload,
  prepareDurableVerifactuRecord,
  resolveVerifactuSoftwareSnapshot,
  sanitizeVerifactuResponse,
  verifactuWaitSeconds
} from "./durable";
export type {
  DurableVerifactuRecord,
  PreparedDurableVerifactuRecord
} from "./durable";
export { deliverDurableVerifactuRecord } from "./durable-client";

// ── AEAT operational helpers ─────────────────────────────────────────────────
export {
  AEAT_VERIFACTU_ERROR_CATALOG_URL,
  extractAeatErrorCode,
  getAeatErrorMetadata
} from "./aeat-errors";
export type { AeatErrorEffect, AeatErrorMetadata } from "./aeat-errors";
export {
  AEAT_NIF_ENDPOINTS,
  buildAeatNifEnvelope,
  interpretAeatNifResponse,
  validateSpanishFiscalIdentity
} from "./nif-validation";
export type {
  AeatFiscalIdentity,
  AeatNifValidation,
  AeatNifValidationOptions
} from "./nif-validation";

/** Runtime contract marker used by consuming applications during deployment. */
export const VERIFACTU_PACKAGE_VERSION = "0.1.21" as const;

