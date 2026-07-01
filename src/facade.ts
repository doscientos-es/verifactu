/**
 * High-level facade for the Verifactu package (public API).
 *
 * `createVerifactuClient` binds a single {@link VerifactuConfig} (and optional
 * logger) once and returns a small, stateless client whose methods no longer
 * require the caller to thread `config`/`logger` on every call. This is the
 * recommended entry point for consumers: build one client per issuer/project
 * and reuse it.
 *
 * The underlying free functions (`submitToVerifactu`, `buildQrUrl`, …) remain
 * exported for advanced/functional usage, but the facade is the ergonomic
 * surface intended for other apps once this module is extracted to
 * `@doscientos/verifactu`.
 */
import {
  type VerifactuSubmitInput,
  type VerifactuSubmitResult,
  submitToVerifactu,
} from "./client";
import { type VerifactuLogger, noopLogger } from "./logger";
import { type QrParams, buildQrDataUrl, buildQrUrl } from "./qr";
import type { VerifactuConfig } from "./types";

/**
 * Stateless client bound to one {@link VerifactuConfig}. All methods are pure
 * with respect to the client (they hold no mutable state), so a single instance
 * is safe to share and reuse across requests.
 */
export type VerifactuClient = {
  /**
   * Register (`RegistroAlta`) an invoice with AEAT. Computes the hash-chain
   * entry, builds the payload, validates it, and submits it. Never throws:
   * failures are returned as a typed {@link VerifactuSubmitResult}.
   */
  registerInvoice(input: VerifactuSubmitInput): Promise<VerifactuSubmitResult>;
  /** Build the tributary QR URL (AEAT cotejo endpoint, or the mock verify route). */
  buildQrUrl(params: QrParams): string;
  /** Convenience: build the QR URL and encode it as a PNG data URL in one step. */
  buildQrDataUrl(params: QrParams): Promise<string>;
};

/**
 * Create a {@link VerifactuClient} bound to `config`. Supply a logger to capture
 * the emitted lifecycle events; defaults to a no-op logger otherwise.
 */
export function createVerifactuClient(
  config: VerifactuConfig,
  logger: VerifactuLogger = noopLogger,
): VerifactuClient {
  return {
    registerInvoice: (input) => submitToVerifactu(input, config, logger),
    buildQrUrl: (params) => buildQrUrl(params, config),
    buildQrDataUrl: (params) => buildQrDataUrl(buildQrUrl(params, config)),
  };
}
