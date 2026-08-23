# @doscientos/verifactu

Framework-agnostic **Verifactu (AEAT)** toolkit for Node.js: billing-record
registration (`RegistroAlta` and `RegistroAnulacion`), official AEAT XSD
validation, the SIF SHA-256 hash chain, and tributary QR generation.

- **Server-first.** The root, `/durable` and `/nif` entry points use Node APIs.
  Run them from Server Actions / Route Handlers or a Node server. The isolated
  `/errors` entry point is browser-safe for operational UI.
- **No env access.** Configuration is injected as plain data (`VerifactuConfig`),
  so the package is portable across apps. Each app keeps its own adapter that maps
  its env into a `VerifactuConfig` (see [`config.example.ts`](./config.example.ts)).
- **Dual ESM/CJS** build with type declarations.

## Install

```bash
pnpm add @doscientos/verifactu
# or: npm i @doscientos/verifactu / yarn add @doscientos/verifactu
```

## Usage

The recommended entry point is `createVerifactuClient`: bind a config once and
reuse the returned client across requests.

```ts
import { createVerifactuClient } from "@doscientos/verifactu";
import { verifactuConfigFromEnv } from "./verifactu-config"; // your adapter

const client = createVerifactuClient(verifactuConfigFromEnv());

const result = await client.registerInvoice({
  nif: "B12345678",
  invoiceNumber: "FAC-2026-001",
  invoiceType: "F1",
  issueDate: new Date("2026-03-15"),
  taxAmount: 21,
  total: 121,
  previousHash: null, // first invoice of the chain
  generatedAt: new Date(),
  emisorName: "Acme S.L.",
  clientNif: "12345678Z",
  clientName: "Cliente Ejemplo",
  descriptionOperacion: "Servicios de consultoría",
  vatLines: [{ rate: 21, base: 100, tax: 21 }],
  previousInvoiceNumber: null,
  previousIssueDate: null,
});

// Never throws — inspect the typed result:
if (result.status === "accepted") {
  console.log("CSV:", result.csv, "hash:", result.hash);
} else {
  console.error(result.errorCode, result.aeatCode, result.errorMessage);
}
```

### QR code

```ts
const qrUrl = client.buildQrUrl({
  nif: "B12345678",
  invoiceNumber: "FAC-2026-001",
  issueDate: new Date("2026-03-15"),
  total: 121,
});

const pngDataUrl = await client.buildQrDataUrl({
  nif: "B12345678",
  invoiceNumber: "FAC-2026-001",
  issueDate: new Date("2026-03-15"),
  total: 121,
}); // "data:image/png;base64,…"
```

## Configuration

`VerifactuConfig` is plain, serialisable data — build it however you like. A
reference adapter that reads environment variables is provided in
[`config.example.ts`](./config.example.ts).

```ts
type VerifactuConfig = {
  environment: "mock" | "test" | "prod";
  certificate: { p12Base64: string; password: string };
  software: {
    producerName: string; producerNif: string;
    name: string; id: string; version: string; installationNumber: string;
    onlyVerifactu: boolean; multipleTaxpayers: boolean;
  };
  appUrl: string; // used to build the mock QR verify route
};
```

- `mock` — no AEAT call; QR points to `${appUrl}/p/verify`. Ideal for local/dev.
- `test` — AEAT **preproduction** endpoints (requires a valid test certificate).
- `prod` — AEAT production endpoints.

## Public API

| Export | Description |
| --- | --- |
| `createVerifactuClient(config, logger?)` | Recommended facade → `registerInvoice`, `cancelInvoice`, QR helpers. |
| `submitToVerifactu(input, config, logger?)` | Free function behind `registerInvoice`. |
| `cancelInVerifactu(input, config, logger?)` | Free function behind `cancelInvoice`; creates a `RegistroAnulacion`. |
| `buildVerifactuXml(input, hash, software)` | Build the `RegistroAlta` XML payload. |
| `buildQrUrl(params, config)` / `buildQrDataUrl(url)` | QR helpers. |
| `validateVerifactuXml(xml)` | XML well-formedness check. |
| `validateVerifactuXsd(xml)` | Validation against the bundled AEAT `SuministroLR`/`SuministroInformacion` schemas. |
| `prepareDurableVerifactuRecord(record, legacySoftware)` | Decode and verify an immutable Alta/Anulación ledger record before delivery. |
| `isRetryableVerifactuDelivery(result)` | Storage-agnostic retry classification for AEAT delivery results. |
| `validateSpanishFiscalIdentity(identity, certificate, options?)` | Read-only VNif census validation with official endpoint fallback. |
| `getAeatErrorMetadata(code, detail?)` | Classify official AEAT errors by operational effect. |
| `noopLogger` / `VerifactuLogger` | Optional logging port (pino-compatible). |

Use `@doscientos/verifactu/errors` from browser bundles. Server integrations can
use `@doscientos/verifactu`, `/durable` and `/nif` without pulling those modules
into client code.

Types: `VerifactuConfig`, `VerifactuCertificate`, `VerifactuSoftware`,
`VerifactuEnvironment`, `VerifactuQrConfig`, `VerifactuSubmitInput`,
`VerifactuSubmitResult`, `VerifactuErrorCode`, `VatLine`, `QrParams`,
`XmlValidationResult`, `VerifactuClient`, `DurableVerifactuRecord`,
`PreparedDurableVerifactuRecord`, `AeatNifValidation`, `AeatErrorMetadata`.

## Scripts

```bash
pnpm build      # dual ESM/CJS bundle + .d.ts (tsup)
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest run
```

## Releases

Cada push directo a `main` valida el paquete, incrementa automáticamente la
versión de parche, crea el commit y tag `vX.Y.Z`, y publica ese artefacto en npm
con Trusted Publishing y provenance. No modifiques `version` manualmente.

El trusted publisher de npm debe estar asociado al repositorio y al workflow
`.github/workflows/publish.yml`; no se almacena un token de npm en GitHub.
Proteged `main` para exigir CI. El commit de versión se realiza con
`github-actions[bot]` y el workflow lo ignora para evitar un ciclo de publicación.

## License

MIT
