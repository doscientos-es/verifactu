import { XMLParser } from "fast-xml-parser";
import { AEAT_SOAP_ACTION_ALTA, AEAT_SOAP_ENDPOINT } from "./constants";
import { computeInvoiceHash, spanishTimestamp } from "./hash";
import { buildIdfact } from "./idfact";
import { type VerifactuLogger, noopLogger } from "./logger";
import { loadP12Cert } from "./sign";
import type { VerifactuConfig, VerifactuSoftware } from "./types";
import { validateVerifactuXml } from "./validate";

export type VatLine = { rate: number; base: number; tax: number };

export type VerifactuSubmitInput = {
  nif: string;
  invoiceNumber: string;
  invoiceType: string;
  issueDate: Date;
  taxAmount: number;
  total: number;
  previousHash: string | null;
  generatedAt: Date;
  emisorName: string;
  clientNif: string | null;
  clientName: string | null;
  descriptionOperacion: string;
  vatLines: VatLine[];
  /** Required for Encadenamiento.RegistroAnterior (non-first invoices). */
  previousInvoiceNumber: string | null;
  previousIssueDate: Date | null;
};

/**
 * Stable, typed classification of why a submission did not succeed. Consumers
 * can `switch` on this instead of parsing free-text messages:
 *  - `cert_missing`  → no P12 certificate/password configured
 *  - `cert_invalid`  → the P12 failed to load (bad file or password)
 *  - `xml_invalid`   → the payload we generated is not well-formed XML
 *  - `network_error` → transport failure reaching AEAT
 *  - `http_error`    → AEAT responded with HTTP >= 400
 *  - `aeat_rejected` → AEAT parsed the request but rejected the record
 */
export type VerifactuErrorCode =
  | "cert_missing"
  | "cert_invalid"
  | "xml_invalid"
  | "network_error"
  | "http_error"
  | "aeat_rejected";

export type VerifactuSubmitResult = {
  status: "accepted" | "rejected" | "error";
  csv: string | null;
  hash: string;
  idfact: string;
  response: Record<string, unknown>;
  errorMessage: string | null;
  /** Typed error category for programmatic handling; `null` when accepted. */
  errorCode: VerifactuErrorCode | null;
  /** Raw AEAT `CodigoErrorRegistro` when the registry rejected the record. */
  aeatCode: string | null;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ddmmyyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

/**
 * Build the VERI*FACTU XML payload per Anexo I/II, HAC/1177/2024.
 *
 * All mandatory XSD elements are included: IDVersion, ObligadoEmision/NombreRazon,
 * NombreRazonEmisor, Destinatarios (F1), DescripcionOperacion, Desglose (per-rate),
 * SistemaInformatico, TipoHuella.
 *
 * No XAdES signature — VERI*FACTU uses mTLS + hash chain for integrity.
 * XAdES is only required in offline (non-verifactu) mode.
 */
export function buildVerifactuXml(
  input: VerifactuSubmitInput,
  hash: string,
  software: VerifactuSoftware,
): string {
  const SUM =
    "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";

  // Encadenamiento: first invoice → PrimerRegistro; subsequent → full previous ID
  const encadenamiento =
    input.previousHash && input.previousInvoiceNumber && input.previousIssueDate
      ? [
          "      <sum:Encadenamiento>",
          "        <sum:RegistroAnterior>",
          `          <sum:IDEmisorFacturaAnterior>${esc(input.nif)}</sum:IDEmisorFacturaAnterior>`,
          `          <sum:NumSerieFacturaAnterior>${esc(input.previousInvoiceNumber)}</sum:NumSerieFacturaAnterior>`,
          `          <sum:FechaExpedicionFacturaAnterior>${ddmmyyyy(input.previousIssueDate)}</sum:FechaExpedicionFacturaAnterior>`,
          `          <sum:Huella>${esc(input.previousHash)}</sum:Huella>`,
          "        </sum:RegistroAnterior>",
          "      </sum:Encadenamiento>",
        ].join("\n")
      : "      <sum:Encadenamiento><sum:PrimerRegistro>S</sum:PrimerRegistro></sum:Encadenamiento>";

  // Destinatarios: required for F1 (full invoice) when client NIF is known
  const destinatarios =
    input.invoiceType === "F1" && input.clientNif
      ? [
          "      <sum:Destinatarios>",
          "        <sum:IDDestinatario>",
          `          <sum:NombreRazon>${esc(input.clientName ?? "")}</sum:NombreRazon>`,
          `          <sum:NIF>${esc(input.clientNif)}</sum:NIF>`,
          "        </sum:IDDestinatario>",
          "      </sum:Destinatarios>",
        ].join("\n")
      : null;

  // Desglose: one DetalleDesglose per distinct VAT rate
  const desgloseLines = input.vatLines
    .map((l) =>
      [
        "        <sum:DetalleDesglose>",
        "          <sum:ClaveRegimen>01</sum:ClaveRegimen>",
        "          <sum:CalificacionOperacion>S1</sum:CalificacionOperacion>",
        `          <sum:TipoImpositivo>${l.rate.toFixed(2)}</sum:TipoImpositivo>`,
        `          <sum:BaseImponibleOImporteNoSujeto>${l.base.toFixed(2)}</sum:BaseImponibleOImporteNoSujeto>`,
        `          <sum:CuotaRepercutida>${l.tax.toFixed(2)}</sum:CuotaRepercutida>`,
        "        </sum:DetalleDesglose>",
      ].join("\n"),
    )
    .join("\n");

  return [
    `<sum:RegFactuSistemaFacturacion xmlns:sum="${SUM}">`,
    "  <sum:Cabecera>",
    "    <sum:ObligadoEmision>",
    `      <sum:NombreRazon>${esc(input.emisorName)}</sum:NombreRazon>`,
    `      <sum:NIF>${esc(input.nif)}</sum:NIF>`,
    "    </sum:ObligadoEmision>",
    "  </sum:Cabecera>",
    "  <sum:RegistroFactura>",
    "    <sum:RegistroAlta>",
    "      <sum:IDVersion>1.0</sum:IDVersion>",
    "      <sum:IDFactura>",
    `        <sum:IDEmisorFactura>${esc(input.nif)}</sum:IDEmisorFactura>`,
    `        <sum:NumSerieFactura>${esc(input.invoiceNumber)}</sum:NumSerieFactura>`,
    `        <sum:FechaExpedicionFactura>${ddmmyyyy(input.issueDate)}</sum:FechaExpedicionFactura>`,
    "      </sum:IDFactura>",
    `      <sum:NombreRazonEmisor>${esc(input.emisorName)}</sum:NombreRazonEmisor>`,
    `      <sum:TipoFactura>${esc(input.invoiceType)}</sum:TipoFactura>`,
    `      <sum:DescripcionOperacion>${esc(input.descriptionOperacion.slice(0, 250))}</sum:DescripcionOperacion>`,
    destinatarios,
    "      <sum:Desglose>",
    desgloseLines,
    "      </sum:Desglose>",
    `      <sum:CuotaTotal>${input.taxAmount.toFixed(2)}</sum:CuotaTotal>`,
    `      <sum:ImporteTotal>${input.total.toFixed(2)}</sum:ImporteTotal>`,
    encadenamiento,
    "      <sum:SistemaInformatico>",
    `        <sum:NombreRazon>${esc(input.emisorName)}</sum:NombreRazon>`,
    `        <sum:NIF>${esc(input.nif)}</sum:NIF>`,
    `        <sum:NombreSistemaInformatico>${esc(software.name)}</sum:NombreSistemaInformatico>`,
    `        <sum:IdSistemaInformatico>${esc(software.id)}</sum:IdSistemaInformatico>`,
    `        <sum:Version>${esc(software.version)}</sum:Version>`,
    `        <sum:NumeroInstalacion>${esc(software.installationNumber)}</sum:NumeroInstalacion>`,
    "        <sum:TipoUsoPosibleSoloVerifactu>S</sum:TipoUsoPosibleSoloVerifactu>",
    "        <sum:TipoUsoPosibleMultiOT>N</sum:TipoUsoPosibleMultiOT>",
    "        <sum:IndicadorMultiples>N</sum:IndicadorMultiples>",
    "      </sum:SistemaInformatico>",
    `      <sum:FechaHoraHusoGenRegistro>${spanishTimestamp(input.generatedAt)}</sum:FechaHoraHusoGenRegistro>`,
    "      <sum:TipoHuella>01</sum:TipoHuella>",
    `      <sum:Huella>${esc(hash)}</sum:Huella>`,
    "    </sum:RegistroAlta>",
    "  </sum:RegistroFactura>",
    "</sum:RegFactuSistemaFacturacion>",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** Wrap the (signed) registration document in a SOAP 1.1 envelope. */
function buildSoapEnvelope(innerXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body>${innerXml}</soapenv:Body></soapenv:Envelope>`;
}

/** Parse the AEAT SOAP response and extract CSV, status and any registry error. */
function parseSoapResponse(body: string): {
  csv: string | null;
  status: "accepted" | "rejected";
  aeatCode: string | null;
  aeatDescription: string | null;
} {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const obj = parser.parse(body) as Record<string, unknown>;
  // Traverse: Envelope > Body > RespuestaRegFactuSistemaFacturacion
  const envelope = obj.Envelope as Record<string, unknown> | undefined;
  const soapBody = envelope?.Body as Record<string, unknown> | undefined;
  const resp = soapBody?.RespuestaRegFactuSistemaFacturacion as Record<string, unknown> | undefined;

  const estadoEnvio = String(resp?.EstadoEnvio ?? "");
  const csv = resp?.CSV ? String(resp.CSV) : null;
  const status = estadoEnvio.toLowerCase().includes("correcto") ? "accepted" : "rejected";

  // Per-record registry errors: AEAT returns one RespuestaLinea per record,
  // which fast-xml-parser yields as a single object or an array. Surface the
  // first CodigoErrorRegistro/DescripcionErrorRegistro found.
  const lineas = resp?.RespuestaLinea;
  const firstLinea = (Array.isArray(lineas) ? lineas[0] : lineas) as
    | Record<string, unknown>
    | undefined;
  const aeatCode =
    firstLinea?.CodigoErrorRegistro != null ? String(firstLinea.CodigoErrorRegistro) : null;
  const aeatDescription =
    firstLinea?.DescripcionErrorRegistro != null
      ? String(firstLinea.DescripcionErrorRegistro)
      : null;

  return { csv, status, aeatCode, aeatDescription };
}

function mockCsv(hash: string): string {
  return hash.slice(0, 16).toUpperCase();
}

/**
 * SOAP POST with mutual TLS — presents the P12 client certificate during the
 * TLS handshake, which is required by all AEAT VERI*FACTU web services.
 */
async function soapPost(
  endpoint: string,
  body: string,
  soapAction: string,
  pfxBuf: Buffer,
  passphrase: string,
): Promise<{ status: number; text: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const https = require("node:https") as typeof import("node:https");
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint);
    const bodyBuf = Buffer.from(body, "utf8");
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "Content-Length": bodyBuf.length,
          SOAPAction: soapAction,
        },
        pfx: pfxBuf,
        passphrase,
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

/**
 * Sends an invoice record to Verifactu. Dispatches by `VERIFACTU_ENV`:
 *  - `mock`  → no network call (hash + QR only; used for MVP and CI)
 *  - `test`  → AEAT pre-production SOAP endpoint (mTLS with P12 cert)
 *  - `prod`  → AEAT production SOAP endpoint (mTLS with P12 cert)
 *
 * No XAdES signature is applied: VERI*FACTU uses mTLS + hash chain for
 * integrity. Switching test↔prod is a one-variable change (VERIFACTU_ENV).
 */
export async function submitToVerifactu(
  input: VerifactuSubmitInput,
  config: VerifactuConfig,
  logger: VerifactuLogger = noopLogger,
): Promise<VerifactuSubmitResult> {
  const hash = computeInvoiceHash(input);
  const idfact = buildIdfact(input.nif, input.invoiceNumber, input.issueDate);
  const xml = buildVerifactuXml(input, hash, config.software);

  logger.info(
    { mode: config.environment, invoice: input.invoiceNumber, hash, idfact, xmlBytes: xml.length },
    "verifactu_submit_start",
  );

  // ── Well-formedness gate ──────────────────────────────────────────────────
  // Never ship a malformed payload (even in mock/CI): catches builder breakage.
  const validation = validateVerifactuXml(xml);
  if (!validation.valid) {
    logger.error(
      { invoice: input.invoiceNumber, reason: validation.message, line: validation.line },
      "verifactu_xml_invalid",
    );
    return {
      status: "error",
      csv: null,
      hash,
      idfact,
      response: { error: "malformed XML", detail: validation.message },
      errorMessage: `XML mal formado: ${validation.message}`,
      errorCode: "xml_invalid",
      aeatCode: null,
    };
  }

  // ── Mock mode ────────────────────────────────────────────────────────────
  if (config.environment === "mock") {
    const csv = mockCsv(hash);
    logger.info({ invoice: input.invoiceNumber, csv }, "verifactu_submit_mock_ok");
    return {
      status: "accepted",
      csv,
      hash,
      idfact,
      response: { mock: true, csv, acceptedAt: new Date().toISOString() },
      errorMessage: null,
      errorCode: null,
      aeatCode: null,
    };
  }

  // ── Real SOAP submission (test / prod) ────────────────────────────────────
  if (!config.certificate.p12Base64 || !config.certificate.password) {
    logger.error({ mode: config.environment }, "verifactu_cert_missing");
    return {
      status: "error",
      csv: null,
      hash,
      idfact,
      response: { error: "certificate not configured" },
      errorMessage:
        "Certificado P12 no configurado (VERIFACTU_CERT_P12_BASE64 / VERIFACTU_CERT_PASSWORD)",
      errorCode: "cert_missing",
      aeatCode: null,
    };
  }

  // Validate cert + password before making any network call
  try {
    loadP12Cert(config.certificate.p12Base64, config.certificate.password);
  } catch (err) {
    logger.error({ err }, "verifactu_cert_load_error");
    return {
      status: "error",
      csv: null,
      hash,
      idfact,
      response: { error: String(err) },
      errorMessage: `Error cargando certificado: ${String(err)}`,
      errorCode: "cert_invalid",
      aeatCode: null,
    };
  }

  const pfxBuf = Buffer.from(config.certificate.p12Base64, "base64");
  const soapBody = buildSoapEnvelope(xml);
  const endpoint = AEAT_SOAP_ENDPOINT[config.environment];

  let rawResponse: string;
  let httpStatus: number;
  try {
    const res = await soapPost(
      endpoint,
      soapBody,
      AEAT_SOAP_ACTION_ALTA,
      pfxBuf,
      config.certificate.password,
    );
    rawResponse = res.text;
    httpStatus = res.status;
  } catch (err) {
    logger.error({ err, endpoint }, "verifactu_network_error");
    return {
      status: "error",
      csv: null,
      hash,
      idfact,
      response: { error: String(err) },
      errorMessage: `Error de red: ${String(err)}`,
      errorCode: "network_error",
      aeatCode: null,
    };
  }

  if (httpStatus >= 400) {
    logger.warn({ status: httpStatus, endpoint }, "verifactu_http_error");
    return {
      status: "error",
      csv: null,
      hash,
      idfact,
      response: { httpStatus, body: rawResponse },
      errorMessage: `AEAT HTTP ${httpStatus}`,
      errorCode: "http_error",
      aeatCode: null,
    };
  }

  const { csv, status, aeatCode, aeatDescription } = parseSoapResponse(rawResponse);
  logger.info({ invoice: input.invoiceNumber, csv, status, aeatCode }, "verifactu_submit_ok");
  return {
    status,
    csv,
    hash,
    idfact,
    response: { rawResponse, aeatCode, aeatDescription },
    errorMessage: status === "rejected" ? (aeatDescription ?? "AEAT rechazó el registro") : null,
    errorCode: status === "rejected" ? "aeat_rejected" : null,
    aeatCode: status === "rejected" ? aeatCode : null,
  };
}
