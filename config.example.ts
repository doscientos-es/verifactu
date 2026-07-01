/**
 * Example app-specific adapter for `@doscientos/verifactu`.
 *
 * This file is NOT part of the published package: the package intentionally
 * ships no environment access. Copy this file into your app (e.g.
 * `lib/verifactu-config.ts`) and map your own env/secrets into a
 * `VerifactuConfig`. This is the single bridge between your app and the
 * (portable) Verifactu package.
 */
import type { VerifactuConfig } from "@doscientos/verifactu";

/**
 * Builds a `VerifactuConfig` from your app's environment.
 *
 * Replace `process.env.*` with your own validated env layer (zod, t3-env, …).
 * All values are plain, serialisable data — no framework coupling.
 */
export function verifactuConfigFromEnv(): VerifactuConfig {
  return {
    // "mock" (local QR route), "test" (AEAT preproduction) or "prod".
    environment: (process.env.VERIFACTU_ENV as VerifactuConfig["environment"]) ?? "mock",
    certificate: {
      // PKCS#12 (.p12) client certificate, base64-encoded, + its passphrase.
      p12Base64: process.env.VERIFACTU_CERT_P12_BASE64 ?? "",
      password: process.env.VERIFACTU_CERT_PASSWORD ?? "",
    },
    software: {
      // SistemaInformatico values assigned by AEAT when your software registers.
      name: process.env.VERIFACTU_SOFTWARE_NAME ?? "",
      id: process.env.VERIFACTU_SOFTWARE_ID ?? "",
      version: process.env.VERIFACTU_SOFTWARE_VERSION ?? "",
      installationNumber: process.env.VERIFACTU_INSTALLATION_NUMBER ?? "",
    },
    // Base URL of your app — used to build the mock QR verify route.
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };
}
