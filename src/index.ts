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

// ── Configuration contract (inputs) ─────────────────────────────────────────
export type {
  VerifactuEnvironment,
  VerifactuCertificate,
  VerifactuSoftware,
  VerifactuConfig,
  VerifactuQrConfig,
} from "./types";

// ── Invoice submission (inputs/outputs + free functions) ─────────────────────
export type {
  VatLine,
  VerifactuSubmitInput,
  VerifactuSubmitResult,
  VerifactuErrorCode,
} from "./client";
export { buildVerifactuXml, submitToVerifactu } from "./client";

// ── QR generation ────────────────────────────────────────────────────────────
export type { QrParams } from "./qr";
export { buildQrDataUrl, buildQrUrl } from "./qr";

// ── XML well-formedness validation ───────────────────────────────────────────
export type { XmlValidationResult } from "./validate";
export { validateVerifactuXml } from "./validate";

// ── Logging port ─────────────────────────────────────────────────────────────
export { type VerifactuLogger, noopLogger } from "./logger";

// ── High-level facade (recommended entry point) ──────────────────────────────
export type { VerifactuClient } from "./facade";
export { createVerifactuClient } from "./facade";
