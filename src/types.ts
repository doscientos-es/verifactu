/**
 * Public configuration contract for the Verifactu package.
 *
 * These are the concrete "inputs" every consumer must provide, expressed as
 * plain, serialisable data — no env access, no framework coupling. This file is
 * part of the extractable package: it moves with `@doscientos/verifactu`.
 *
 * The app-specific adapter that reads environment variables lives separately in
 * `config.ts` (which stays in each consuming app). Keeping the contract here and
 * the adapter there is what makes the module portable across projects.
 */

/** Target AEAT environment. Switching test↔prod is a single-field change. */
export type VerifactuEnvironment = 'mock' | 'test' | 'prod'

/** PKCS#12 client certificate used for the mutual-TLS handshake with AEAT. */
export type VerifactuCertificate = {
  /** PKCS#12 (.p12) client certificate, base64-encoded. */
  p12Base64: string
  /** Passphrase for the .p12 certificate. */
  password: string
}

/**
 * `SistemaInformatico` block — the values AEAT assigns when the software is
 * registered. Every consuming project supplies its own registration data.
 */
export type VerifactuSoftware = {
  /** Legal name of the producer/developer of this SIF. */
  producerName: string
  /** Spanish tax identifier of the SIF producer/developer. */
  producerNif: string
  name: string
  id: string
  version: string
  installationNumber: string
  /** True only when the product cannot operate outside VERI*FACTU mode. */
  onlyVerifactu: boolean
  /** Whether this installation can serve multiple taxpayers. */
  multipleTaxpayers: boolean
}

/**
 * Everything the client needs to operate for a given issuer/project. Build one
 * per project (see the app's `verifactuConfigFromEnv()` adapter) and reuse it.
 */
export type VerifactuConfig = {
  environment: VerifactuEnvironment
  certificate: VerifactuCertificate
  software: VerifactuSoftware
  /** Base URL of the consuming app — used to build the mock QR verify route. */
  appUrl: string
  /** Upper bound for one AEAT SOAP request. Defaults to 30 seconds. */
  requestTimeoutMs?: number
  /** Upper bound for an AEAT SOAP response body. Defaults to 1 MiB. */
  maxResponseBytes?: number
  /** Validate generated submissions against the bundled AEAT XSDs. Defaults to true. */
  validateAgainstXsd?: boolean
}

/** Minimal config subset needed to build the tributary QR URL. */
export type VerifactuQrConfig = Pick<VerifactuConfig, 'environment' | 'appUrl'>
