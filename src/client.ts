import https from 'node:https'

import { XMLParser } from 'fast-xml-parser'

import { AEAT_SOAP_ACTION_REG_FACTU, AEAT_SOAP_ENDPOINT } from './constants'
import { computeCancellationHash, computeInvoiceHash, spanishDate, spanishTimestamp } from './hash'
import { buildIdfact } from './idfact'
import { type VerifactuLogger, noopLogger } from './logger'
import { validateVerifactuXsd } from './schema'
import { decodeP12Base64, loadP12Cert } from './sign'
import type { VerifactuConfig, VerifactuSoftware } from './types'
import {
  validateVerifactuCancellation,
  validateVerifactuSubmission,
  validateVerifactuXml,
} from './validate'

export type VatLine = { rate: number; base: number; tax: number }
export type InvoiceReference = { invoiceNumber: string; issueDate: Date }

export type VerifactuSubmitInput = {
  nif: string
  invoiceNumber: string
  invoiceType: string
  /** Optional AEAT reference for idempotency/audit correlation. */
  externalReference?: string
  /** Required for rectificative invoices and optional for other correction flows. */
  rectificationType?: 'S' | 'I'
  rectifiedInvoices?: InvoiceReference[]
  substitutedInvoices?: InvoiceReference[]
  rectificationAmounts?: { base: number; tax: number; surcharge?: number }
  operationDate?: Date
  /** S for a correcting registration; N is omitted from the XML. */
  subsanacion?: 'S' | 'N'
  /** N, S or X according to the AEAT previous-rejection flow. */
  rechazoPrevio?: 'N' | 'S' | 'X'
  issueDate: Date
  taxAmount: number
  total: number
  previousHash: string | null
  generatedAt: Date
  emisorName: string
  clientNif: string | null
  clientName: string | null
  descriptionOperacion: string
  vatLines: VatLine[]
  /** Required for Encadenamiento.RegistroAnterior (non-first invoices). */
  previousInvoiceNumber: string | null
  previousIssueDate: Date | null
  /** Set only when retrying after an AEAT or connectivity incident. */
  incidence?: boolean
}

/** Data needed to generate and submit a RegistroAnulacion. */
export type VerifactuCancellationInput = {
  /** NIF of the issuer and of the invoice being annulled. */
  nif: string
  /** Series and number of the invoice identified by the annulment. */
  cancelledInvoiceNumber: string
  /** Issue date of the invoice identified by the annulment. */
  cancelledInvoiceIssueDate: Date
  /** Hash of the immediately preceding record in this SIF chain. */
  previousHash: string | null
  generatedAt: Date
  emisorName: string
  /** Required with previousHash for Encadenamiento.RegistroAnterior. */
  previousInvoiceNumber: string | null
  previousIssueDate: Date | null
  /** Whether the annulled registration is absent from AEAT (defaults to N). */
  sinRegistroPrevio?: 'S' | 'N'
  /** Whether AEAT previously rejected this annulment (defaults to N). */
  rechazoPrevio?: 'S' | 'N'
  externalReference?: string
  /** Set only when retrying after an AEAT or connectivity incident. */
  incidence?: boolean
}

/**
 * Stable, typed classification of why a submission did not succeed. Consumers
 * can `switch` on this instead of parsing free-text messages:
 *  - `cert_missing`  → no P12 certificate/password configured
 *  - `cert_invalid`  → the P12 failed to load (bad file or password)
 *  - `xml_invalid`   → the payload we generated is not well-formed XML
 *  - `xsd_invalid`   → the payload is well-formed but fails the official AEAT XSD
 *  - `configuration_invalid` → unsupported or incomplete local fiscal data
 *  - `network_error` → transport failure reaching AEAT
 *  - `http_error`    → AEAT responded with HTTP >= 400
 *  - `response_invalid` → AEAT's response was malformed or incomplete
 *  - `aeat_rejected` → AEAT parsed the request but rejected the record
 */
export type VerifactuErrorCode =
  | 'cert_missing'
  | 'cert_invalid'
  | 'xml_invalid'
  | 'xsd_invalid'
  | 'configuration_invalid'
  | 'network_error'
  | 'http_error'
  | 'response_invalid'
  | 'aeat_rejected'

export type VerifactuSubmitResult = {
  status: 'accepted' | 'rejected' | 'error'
  /** Normalised AEAT per-record status when a SOAP response was received. */
  aeatStatus: 'correcto' | 'aceptadoconerrores' | 'incorrecto' | null
  csv: string | null
  hash: string
  idfact: string
  response: Record<string, unknown>
  errorMessage: string | null
  /** Typed error category for programmatic handling; `null` when accepted. */
  errorCode: VerifactuErrorCode | null
  /** Raw AEAT `CodigoErrorRegistro` when the registry rejected the record. */
  aeatCode: string | null
  /** Non-blocking AEAT warnings, especially for `AceptadoConErrores`. */
  warnings: Array<{ code: string | null; message: string }>
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInvoiceReferences(
  tag: string,
  refs: InvoiceReference[] | undefined,
  nif: string,
): string | null {
  if (!refs?.length) return null
  return [
    `      <sf:${tag}>`,
    ...refs.flatMap((ref) => [
      `        <sf:${tag === 'FacturasRectificadas' ? 'IDFacturaRectificada' : 'IDFacturaSustituida'}>`,
      `          <sf:IDEmisorFactura>${esc(nif)}</sf:IDEmisorFactura>`,
      `          <sf:NumSerieFactura>${esc(ref.invoiceNumber)}</sf:NumSerieFactura>`,
      `          <sf:FechaExpedicionFactura>${spanishDate(ref.issueDate)}</sf:FechaExpedicionFactura>`,
      `        </sf:${tag === 'FacturasRectificadas' ? 'IDFacturaRectificada' : 'IDFacturaSustituida'}>`,
    ]),
    `      </sf:${tag}>`,
  ].join('\n')
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
  const SUM_LR =
    'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd'
  const SUM =
    'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd'

  // Encadenamiento: first invoice → PrimerRegistro; subsequent → full previous ID.
  // RegistroAnterior is an EncadenamientoFacturaAnteriorType: its children are
  // IDEmisorFactura / NumSerieFactura / FechaExpedicionFactura (no "Anterior"
  // suffix) per SuministroInformacion.xsd.
  const encadenamiento =
    input.previousHash && input.previousInvoiceNumber && input.previousIssueDate
      ? [
          '      <sf:Encadenamiento>',
          '        <sf:RegistroAnterior>',
          `          <sf:IDEmisorFactura>${esc(input.nif)}</sf:IDEmisorFactura>`,
          `          <sf:NumSerieFactura>${esc(input.previousInvoiceNumber)}</sf:NumSerieFactura>`,
          `          <sf:FechaExpedicionFactura>${spanishDate(input.previousIssueDate)}</sf:FechaExpedicionFactura>`,
          `          <sf:Huella>${esc(input.previousHash)}</sf:Huella>`,
          '        </sf:RegistroAnterior>',
          '      </sf:Encadenamiento>',
        ].join('\n')
      : '      <sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>'

  // Destinatarios: required for F1 (full invoice) when client NIF is known
  const destinatarios =
    input.invoiceType === 'F1' && input.clientNif
      ? [
          '      <sf:Destinatarios>',
          '        <sf:IDDestinatario>',
          `          <sf:NombreRazon>${esc(input.clientName ?? '')}</sf:NombreRazon>`,
          `          <sf:NIF>${esc(input.clientNif)}</sf:NIF>`,
          '        </sf:IDDestinatario>',
          '      </sf:Destinatarios>',
        ].join('\n')
      : null

  // Desglose: one DetalleDesglose per distinct VAT rate
  const desgloseLines = input.vatLines
    .map((l) =>
      [
        '        <sf:DetalleDesglose>',
        '          <sf:ClaveRegimen>01</sf:ClaveRegimen>',
        '          <sf:CalificacionOperacion>S1</sf:CalificacionOperacion>',
        `          <sf:TipoImpositivo>${l.rate.toFixed(2)}</sf:TipoImpositivo>`,
        `          <sf:BaseImponibleOimporteNoSujeto>${l.base.toFixed(2)}</sf:BaseImponibleOimporteNoSujeto>`,
        `          <sf:CuotaRepercutida>${l.tax.toFixed(2)}</sf:CuotaRepercutida>`,
        '        </sf:DetalleDesglose>',
      ].join('\n'),
    )
    .join('\n')

  return [
    `<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="${SUM_LR}" xmlns:sf="${SUM}">`,
    '  <sfLR:Cabecera>',
    '    <sf:ObligadoEmision>',
    `      <sf:NombreRazon>${esc(input.emisorName)}</sf:NombreRazon>`,
    `      <sf:NIF>${esc(input.nif)}</sf:NIF>`,
    '    </sf:ObligadoEmision>',
    input.incidence
      ? '    <sf:RemisionVoluntaria><sf:Incidencia>S</sf:Incidencia></sf:RemisionVoluntaria>'
      : null,
    '  </sfLR:Cabecera>',
    '  <sfLR:RegistroFactura>',
    '    <sf:RegistroAlta>',
    '      <sf:IDVersion>1.0</sf:IDVersion>',
    '      <sf:IDFactura>',
    `        <sf:IDEmisorFactura>${esc(input.nif)}</sf:IDEmisorFactura>`,
    `        <sf:NumSerieFactura>${esc(input.invoiceNumber)}</sf:NumSerieFactura>`,
    `        <sf:FechaExpedicionFactura>${spanishDate(input.issueDate)}</sf:FechaExpedicionFactura>`,
    '      </sf:IDFactura>',
    input.externalReference
      ? `      <sf:RefExterna>${esc(input.externalReference.slice(0, 60))}</sf:RefExterna>`
      : null,
    `      <sf:NombreRazonEmisor>${esc(input.emisorName)}</sf:NombreRazonEmisor>`,
    input.subsanacion === 'S' ? '      <sf:Subsanacion>S</sf:Subsanacion>' : null,
    input.rechazoPrevio && input.rechazoPrevio !== 'N'
      ? `      <sf:RechazoPrevio>${input.rechazoPrevio}</sf:RechazoPrevio>`
      : null,
    `      <sf:TipoFactura>${esc(input.invoiceType)}</sf:TipoFactura>`,
    input.rectificationType
      ? `      <sf:TipoRectificativa>${input.rectificationType}</sf:TipoRectificativa>`
      : null,
    renderInvoiceReferences('FacturasRectificadas', input.rectifiedInvoices, input.nif),
    renderInvoiceReferences('FacturasSustituidas', input.substitutedInvoices, input.nif),
    input.rectificationAmounts
      ? [
          '      <sf:ImporteRectificacion>',
          `        <sf:BaseRectificada>${input.rectificationAmounts.base.toFixed(2)}</sf:BaseRectificada>`,
          `        <sf:CuotaRectificada>${input.rectificationAmounts.tax.toFixed(2)}</sf:CuotaRectificada>`,
          input.rectificationAmounts.surcharge === undefined ||
          input.rectificationAmounts.surcharge === null
            ? null
            : `        <sf:CuotaRecargoRectificado>${input.rectificationAmounts.surcharge.toFixed(2)}</sf:CuotaRecargoRectificado>`,
          '      </sf:ImporteRectificacion>',
        ]
          .filter((line) => line !== null)
          .join('\n')
      : null,
    input.operationDate
      ? `      <sf:FechaOperacion>${spanishDate(input.operationDate)}</sf:FechaOperacion>`
      : null,
    `      <sf:DescripcionOperacion>${esc(input.descriptionOperacion.slice(0, 250))}</sf:DescripcionOperacion>`,
    destinatarios,
    '      <sf:Desglose>',
    desgloseLines,
    '      </sf:Desglose>',
    `      <sf:CuotaTotal>${input.taxAmount.toFixed(2)}</sf:CuotaTotal>`,
    `      <sf:ImporteTotal>${input.total.toFixed(2)}</sf:ImporteTotal>`,
    encadenamiento,
    '      <sf:SistemaInformatico>',
    `        <sf:NombreRazon>${esc(software.producerName)}</sf:NombreRazon>`,
    `        <sf:NIF>${esc(software.producerNif)}</sf:NIF>`,
    `        <sf:NombreSistemaInformatico>${esc(software.name)}</sf:NombreSistemaInformatico>`,
    `        <sf:IdSistemaInformatico>${esc(software.id)}</sf:IdSistemaInformatico>`,
    `        <sf:Version>${esc(software.version)}</sf:Version>`,
    `        <sf:NumeroInstalacion>${esc(software.installationNumber)}</sf:NumeroInstalacion>`,
    `        <sf:TipoUsoPosibleSoloVerifactu>${software.onlyVerifactu ? 'S' : 'N'}</sf:TipoUsoPosibleSoloVerifactu>`,
    `        <sf:TipoUsoPosibleMultiOT>${software.multipleTaxpayers ? 'S' : 'N'}</sf:TipoUsoPosibleMultiOT>`,
    `        <sf:IndicadorMultiplesOT>${software.multipleTaxpayers ? 'S' : 'N'}</sf:IndicadorMultiplesOT>`,
    '      </sf:SistemaInformatico>',
    `      <sf:FechaHoraHusoGenRegistro>${spanishTimestamp(input.generatedAt)}</sf:FechaHoraHusoGenRegistro>`,
    '      <sf:TipoHuella>01</sf:TipoHuella>',
    `      <sf:Huella>${esc(hash)}</sf:Huella>`,
    '    </sf:RegistroAlta>',
    '  </sfLR:RegistroFactura>',
    '</sfLR:RegFactuSistemaFacturacion>',
  ]
    .filter((l) => l !== null)
    .join('\n')
}

/** Build a RegistroAnulacion payload per Anexo I/II, HAC/1177/2024. */
export function buildVerifactuCancellationXml(
  input: VerifactuCancellationInput,
  hash: string,
  software: VerifactuSoftware,
): string {
  const SUM_LR =
    'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd'
  const SUM =
    'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd'
  const encadenamiento =
    input.previousHash && input.previousInvoiceNumber && input.previousIssueDate
      ? [
          '      <sf:Encadenamiento>',
          '        <sf:RegistroAnterior>',
          `          <sf:IDEmisorFactura>${esc(input.nif)}</sf:IDEmisorFactura>`,
          `          <sf:NumSerieFactura>${esc(input.previousInvoiceNumber)}</sf:NumSerieFactura>`,
          `          <sf:FechaExpedicionFactura>${spanishDate(input.previousIssueDate)}</sf:FechaExpedicionFactura>`,
          `          <sf:Huella>${esc(input.previousHash)}</sf:Huella>`,
          '        </sf:RegistroAnterior>',
          '      </sf:Encadenamiento>',
        ].join('\n')
      : '      <sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>'

  return [
    `<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="${SUM_LR}" xmlns:sf="${SUM}">`,
    '  <sfLR:Cabecera>',
    '    <sf:ObligadoEmision>',
    `      <sf:NombreRazon>${esc(input.emisorName)}</sf:NombreRazon>`,
    `      <sf:NIF>${esc(input.nif)}</sf:NIF>`,
    '    </sf:ObligadoEmision>',
    input.incidence
      ? '    <sf:RemisionVoluntaria><sf:Incidencia>S</sf:Incidencia></sf:RemisionVoluntaria>'
      : null,
    '  </sfLR:Cabecera>',
    '  <sfLR:RegistroFactura>',
    '    <sf:RegistroAnulacion>',
    '      <sf:IDVersion>1.0</sf:IDVersion>',
    '      <sf:IDFactura>',
    `        <sf:IDEmisorFacturaAnulada>${esc(input.nif)}</sf:IDEmisorFacturaAnulada>`,
    `        <sf:NumSerieFacturaAnulada>${esc(input.cancelledInvoiceNumber)}</sf:NumSerieFacturaAnulada>`,
    `        <sf:FechaExpedicionFacturaAnulada>${spanishDate(input.cancelledInvoiceIssueDate)}</sf:FechaExpedicionFacturaAnulada>`,
    '      </sf:IDFactura>',
    input.externalReference
      ? `      <sf:RefExterna>${esc(input.externalReference.slice(0, 60))}</sf:RefExterna>`
      : null,
    `      <sf:SinRegistroPrevio>${input.sinRegistroPrevio ?? 'N'}</sf:SinRegistroPrevio>`,
    `      <sf:RechazoPrevio>${input.rechazoPrevio ?? 'N'}</sf:RechazoPrevio>`,
    encadenamiento,
    '      <sf:SistemaInformatico>',
    `        <sf:NombreRazon>${esc(software.producerName)}</sf:NombreRazon>`,
    `        <sf:NIF>${esc(software.producerNif)}</sf:NIF>`,
    `        <sf:NombreSistemaInformatico>${esc(software.name)}</sf:NombreSistemaInformatico>`,
    `        <sf:IdSistemaInformatico>${esc(software.id)}</sf:IdSistemaInformatico>`,
    `        <sf:Version>${esc(software.version)}</sf:Version>`,
    `        <sf:NumeroInstalacion>${esc(software.installationNumber)}</sf:NumeroInstalacion>`,
    `        <sf:TipoUsoPosibleSoloVerifactu>${software.onlyVerifactu ? 'S' : 'N'}</sf:TipoUsoPosibleSoloVerifactu>`,
    `        <sf:TipoUsoPosibleMultiOT>${software.multipleTaxpayers ? 'S' : 'N'}</sf:TipoUsoPosibleMultiOT>`,
    `        <sf:IndicadorMultiplesOT>${software.multipleTaxpayers ? 'S' : 'N'}</sf:IndicadorMultiplesOT>`,
    '      </sf:SistemaInformatico>',
    `      <sf:FechaHoraHusoGenRegistro>${spanishTimestamp(input.generatedAt)}</sf:FechaHoraHusoGenRegistro>`,
    '      <sf:TipoHuella>01</sf:TipoHuella>',
    `      <sf:Huella>${esc(hash)}</sf:Huella>`,
    '    </sf:RegistroAnulacion>',
    '  </sfLR:RegistroFactura>',
    '</sfLR:RegFactuSistemaFacturacion>',
  ].join('\n')
}

/** Wrap the (signed) registration document in a SOAP 1.1 envelope. */
function buildSoapEnvelope(innerXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body>${innerXml}</soapenv:Body></soapenv:Envelope>`
}

/** Parse the AEAT SOAP response and extract CSV, status and any registry error. */
export function parseSoapResponse(body: string): {
  valid: boolean
  csv: string | null
  status: 'accepted' | 'rejected'
  aeatStatus: 'correcto' | 'aceptadoconerrores' | 'incorrecto' | null
  aeatCode: string | null
  aeatDescription: string | null
  duplicateStatus: 'correcta' | 'aceptadoconerrores' | 'anulada' | null
  duplicateCode: string | null
  duplicateDescription: string | null
  soapFault: string | null
  waitSeconds: number | null
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
  })
  let obj: Record<string, unknown>
  try {
    obj = parser.parse(body) as Record<string, unknown>
  } catch {
    return {
      valid: false,
      csv: null,
      status: 'rejected',
      aeatStatus: null,
      aeatCode: null,
      aeatDescription: null,
      duplicateStatus: null,
      duplicateCode: null,
      duplicateDescription: null,
      soapFault: null,
      waitSeconds: null,
    }
  }
  // Traverse: Envelope > Body > RespuestaRegFactuSistemaFacturacion
  const envelope = obj.Envelope as Record<string, unknown> | undefined
  const soapBody = envelope?.Body as Record<string, unknown> | undefined
  const resp = soapBody?.RespuestaRegFactuSistemaFacturacion as Record<string, unknown> | undefined
  const fault = soapBody?.Fault as Record<string, unknown> | undefined
  const soapFault = fault?.faultstring ? String(fault.faultstring) : null

  if (!resp && !soapFault) {
    return {
      valid: false,
      csv: null,
      status: 'rejected',
      aeatStatus: null,
      aeatCode: null,
      aeatDescription: null,
      duplicateStatus: null,
      duplicateCode: null,
      duplicateDescription: null,
      soapFault: null,
      waitSeconds: null,
    }
  }

  const estadoEnvio = String(resp?.EstadoEnvio ?? '')
    .trim()
    .toLowerCase()
  const csv = resp?.CSV ? String(resp.CSV) : null
  const waitCandidate = Number(resp?.TiempoEsperaEnvio)
  const waitSeconds = Number.isInteger(waitCandidate) && waitCandidate >= 0 ? waitCandidate : null

  // Per-record registry state/errors: AEAT returns one RespuestaLinea per
  // record, which fast-xml-parser yields as a single object or an array.
  const lineas = resp?.RespuestaLinea
  const firstLinea = (Array.isArray(lineas) ? lineas[0] : lineas) as
    | Record<string, unknown>
    | undefined
  const estadoRegistro = String(firstLinea?.EstadoRegistro ?? '')
    .trim()
    .toLowerCase()
  const aeatCode =
    firstLinea?.CodigoErrorRegistro !== undefined && firstLinea.CodigoErrorRegistro !== null
      ? String(firstLinea.CodigoErrorRegistro)
      : null
  const aeatDescription =
    firstLinea?.DescripcionErrorRegistro !== undefined &&
    firstLinea.DescripcionErrorRegistro !== null
      ? String(firstLinea.DescripcionErrorRegistro)
      : null
  const duplicate = firstLinea?.RegistroDuplicado as Record<string, unknown> | undefined
  const rawDuplicateStatus = String(duplicate?.EstadoRegistroDuplicado ?? '')
    .trim()
    .toLowerCase()
  const duplicateStatus =
    rawDuplicateStatus === 'correcta' ||
    rawDuplicateStatus === 'aceptadoconerrores' ||
    rawDuplicateStatus === 'anulada'
      ? rawDuplicateStatus
      : null
  const duplicateCode =
    duplicate?.CodigoErrorRegistro !== undefined && duplicate.CodigoErrorRegistro !== null
      ? String(duplicate.CodigoErrorRegistro)
      : null
  const duplicateDescription =
    duplicate?.DescripcionErrorRegistro !== undefined && duplicate.DescripcionErrorRegistro !== null
      ? String(duplicate.DescripcionErrorRegistro)
      : null

  // The per-record EstadoRegistro is authoritative: "AceptadoConErrores" means
  // AEAT did register the record. Exact comparisons are required because
  // "Incorrecto" and "ParcialmenteCorrecto" both contain "correcto". A
  // duplicate whose stored record is Correcta/AceptadaConErrores is also a
  // successful idempotent retry after a response may have been lost.
  const effectiveStatus =
    duplicateStatus === 'correcta'
      ? 'correcto'
      : duplicateStatus === 'aceptadoconerrores'
        ? 'aceptadoconerrores'
        : estadoRegistro
  const status = effectiveStatus
    ? effectiveStatus === 'correcto' || effectiveStatus === 'aceptadoconerrores'
      ? 'accepted'
      : 'rejected'
    : estadoEnvio === 'correcto'
      ? 'accepted'
      : 'rejected'

  const aeatStatus =
    effectiveStatus === 'correcto' ||
    effectiveStatus === 'aceptadoconerrores' ||
    effectiveStatus === 'incorrecto'
      ? effectiveStatus
      : null
  return {
    valid: true,
    csv,
    status,
    aeatStatus,
    aeatCode,
    aeatDescription,
    duplicateStatus,
    duplicateCode,
    duplicateDescription,
    soapFault,
    waitSeconds,
  }
}

function mockCsv(hash: string): string {
  return hash.slice(0, 16).toUpperCase()
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
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint)
    const bodyBuf = Buffer.from(body, 'utf8')
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': bodyBuf.length,
          SOAPAction: soapAction,
        },
        pfx: pfxBuf,
        passphrase,
        rejectUnauthorized: true,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        let bytes = 0
        res.on('data', (c: Buffer) => {
          bytes += c.length
          if (bytes > maxResponseBytes) {
            req.destroy(new Error('VERIFACTU_RESPONSE_TOO_LARGE'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('VERIFACTU_REQUEST_TIMEOUT')))
    req.write(bodyBuf)
    req.end()
  })
}

type SubmissionPayload = {
  reference: string
  hash: string
  idfact: string
  xml: string
}

/**
 * Sends a prepared billing record to Verifactu. Dispatches by `VERIFACTU_ENV`:
 *  - `mock`  → no network call (hash + QR only; used for MVP and CI)
 *  - `test`  → AEAT pre-production SOAP endpoint (mTLS with P12 cert)
 *  - `prod`  → AEAT production SOAP endpoint (mTLS with P12 cert)
 *
 * No XAdES signature is applied: VERI*FACTU uses mTLS + hash chain for
 * integrity. Switching test↔prod is a one-variable change (VERIFACTU_ENV).
 */
async function submitPayloadToVerifactu(
  payload: SubmissionPayload,
  config: VerifactuConfig,
  logger: VerifactuLogger = noopLogger,
): Promise<VerifactuSubmitResult> {
  logger.info(
    {
      mode: config.environment,
      record: payload.reference,
      hash: payload.hash,
      idfact: payload.idfact,
      xmlBytes: payload.xml.length,
    },
    'verifactu_submit_start',
  )

  // ── Well-formedness gate ──────────────────────────────────────────────────
  // Never ship a malformed payload (even in mock/CI): catches builder breakage.
  const validation = validateVerifactuXml(payload.xml)
  if (!validation.valid) {
    logger.error(
      {
        record: payload.reference,
        reason: validation.message,
        line: validation.line,
      },
      'verifactu_xml_invalid',
    )
    return {
      status: 'error',
      aeatStatus: null,
      csv: null,
      hash: payload.hash,
      idfact: payload.idfact,
      response: { error: 'malformed XML', detail: validation.message },
      errorMessage: `XML mal formado: ${validation.message}`,
      errorCode: 'xml_invalid',
      aeatCode: null,
      warnings: [],
    }
  }

  if (config.validateAgainstXsd !== false) {
    const xsdValidation = validateVerifactuXsd(payload.xml)
    if (!xsdValidation.valid) {
      const first = xsdValidation.errors[0]
      logger.error(
        { record: payload.reference, reason: first?.message, line: first?.line },
        'verifactu_xsd_invalid',
      )
      return {
        status: 'error',
        aeatStatus: null,
        csv: null,
        hash: payload.hash,
        idfact: payload.idfact,
        response: { error: 'XSD validation failed', errors: xsdValidation.errors },
        errorMessage: `XML no conforme al esquema AEAT: ${first?.message ?? 'error desconocido'}`,
        errorCode: 'xsd_invalid',
        aeatCode: null,
        warnings: [],
      }
    }
  }

  // ── Mock mode ────────────────────────────────────────────────────────────
  if (config.environment === 'mock') {
    const csv = mockCsv(payload.hash)
    logger.info({ record: payload.reference, csv }, 'verifactu_submit_mock_ok')
    return {
      status: 'accepted',
      aeatStatus: null,
      csv,
      hash: payload.hash,
      idfact: payload.idfact,
      response: { mock: true, csv, acceptedAt: new Date().toISOString() },
      errorMessage: null,
      errorCode: null,
      aeatCode: null,
      warnings: [],
    }
  }

  // ── Real SOAP submission (test / prod) ────────────────────────────────────
  if (!config.certificate.p12Base64 || !config.certificate.password) {
    logger.error({ mode: config.environment }, 'verifactu_cert_missing')
    return {
      status: 'error',
      aeatStatus: null,
      csv: null,
      hash: payload.hash,
      idfact: payload.idfact,
      response: { kind: 'certificate_missing' },
      errorMessage:
        'Certificado P12 no configurado (VERIFACTU_CERT_P12_BASE64 / VERIFACTU_CERT_PASSWORD)',
      errorCode: 'cert_missing',
      aeatCode: null,
      warnings: [],
    }
  }

  // Validate cert + password before making any network call
  try {
    loadP12Cert(config.certificate.p12Base64, config.certificate.password)
  } catch (err) {
    logger.error({ err }, 'verifactu_cert_load_error')
    return {
      status: 'error',
      aeatStatus: null,
      csv: null,
      hash: payload.hash,
      idfact: payload.idfact,
      response: { kind: 'certificate_error' },
      errorMessage: `Error cargando certificado: ${String(err)}`,
      errorCode: 'cert_invalid',
      aeatCode: null,
      warnings: [],
    }
  }

  // Use the same strict decoder as the preflight check. Buffer.from(...)
  // silently discards invalid Base64 characters, which can turn a damaged
  // environment variable into a different/truncated certificate at TLS time.
  const pfxBuf = decodeP12Base64(config.certificate.p12Base64)
  const soapBody = buildSoapEnvelope(payload.xml)
  const endpoint = AEAT_SOAP_ENDPOINT[config.environment]

  let rawResponse: string
  let httpStatus: number
  try {
    const res = await soapPost(
      endpoint,
      soapBody,
      AEAT_SOAP_ACTION_REG_FACTU,
      pfxBuf,
      config.certificate.password,
      Math.max(1_000, config.requestTimeoutMs ?? 30_000),
      Math.max(1_024, config.maxResponseBytes ?? 1_048_576),
    )
    rawResponse = res.text
    httpStatus = res.status
  } catch (err) {
    logger.error({ err, endpoint }, 'verifactu_network_error')
    const detail = String(err)
    const certificateHint = /asn(?:\.1|1)|pfx|pkcs.?12|certificate|certificado|tls|openssl/i.test(
      detail,
    )
      ? ' (revisar VERIFACTU_CERT_P12_BASE64, contraseña y certificado cliente)'
      : ''
    const responseInvalid = /VERIFACTU_RESPONSE_TOO_LARGE/i.test(detail)
    return {
      status: 'error',
      aeatStatus: null,
      csv: null,
      hash: payload.hash,
      idfact: payload.idfact,
      response: { kind: responseInvalid ? 'response_too_large' : 'network_error' },
      errorMessage: `Error de conexión${certificateHint}: ${detail}`,
      errorCode: responseInvalid ? 'response_invalid' : 'network_error',
      aeatCode: null,
      warnings: [],
    }
  }

  if (httpStatus >= 400) {
    // AEAT returns schema/validation errors as a SOAP Fault with HTTP 500;
    // the faultstring carries the actionable message (e.g. code 4102).
    const { soapFault, aeatCode, aeatDescription, aeatStatus } = parseSoapResponse(rawResponse)
    logger.warn({ status: httpStatus, endpoint, soapFault }, 'verifactu_http_error')
    return {
      status: 'error',
      aeatStatus: null,
      csv: null,
      hash: payload.hash,
      idfact: payload.idfact,
      response: {
        kind: 'http_error',
        httpStatus,
        soapFault,
        aeatCode,
        aeatDescription,
        aeatStatus,
      },
      errorMessage: soapFault ? `AEAT HTTP ${httpStatus}: ${soapFault}` : `AEAT HTTP ${httpStatus}`,
      errorCode: 'http_error',
      aeatCode,
      warnings: [],
    }
  }

  const {
    valid,
    csv,
    status,
    aeatStatus,
    aeatCode,
    aeatDescription,
    duplicateStatus,
    duplicateCode,
    duplicateDescription,
    soapFault,
    waitSeconds,
  } = parseSoapResponse(rawResponse)
  if (!valid) {
    return {
      status: 'error',
      aeatStatus: null,
      csv: null,
      hash: payload.hash,
      idfact: payload.idfact,
      response: { kind: 'response_invalid', httpStatus },
      errorMessage: 'La respuesta de AEAT no contiene un SOAP de VERI*FACTU válido',
      errorCode: 'response_invalid',
      aeatCode: null,
      warnings: [],
    }
  }
  logger.info({ record: payload.reference, csv, status, aeatCode }, 'verifactu_submit_ok')
  return {
    status,
    aeatStatus,
    csv,
    hash: payload.hash,
    idfact: payload.idfact,
    response: {
      kind: 'aeat_response',
      httpStatus,
      csv,
      aeatCode,
      aeatDescription,
      duplicateStatus,
      duplicateCode,
      duplicateDescription,
      soapFault,
      waitSeconds,
    },
    errorMessage:
      status === 'rejected' ? (aeatDescription ?? soapFault ?? 'AEAT rechazó el registro') : null,
    errorCode: status === 'rejected' ? 'aeat_rejected' : null,
    // Preserve the code even for AceptadoConErrores; consumers need the
    // warning identifier to decide whether an operational follow-up is needed.
    aeatCode,
    warnings:
      status === 'accepted' &&
      aeatStatus === 'aceptadoconerrores' &&
      (duplicateDescription ?? aeatDescription)
        ? [
            {
              code: duplicateCode ?? aeatCode,
              message: duplicateDescription ?? (aeatDescription as string),
            },
          ]
        : [],
  }
}

/** Submit a RegistroAlta invoice record to AEAT. Never throws. */
export function submitToVerifactu(
  input: VerifactuSubmitInput,
  config: VerifactuConfig,
  logger: VerifactuLogger = noopLogger,
): Promise<VerifactuSubmitResult> {
  const fiscalValidation = validateVerifactuSubmission(input, config.software)
  const hash = computeInvoiceHash(input)
  if (!fiscalValidation.valid) {
    return Promise.resolve({
      status: 'error',
      aeatStatus: null,
      csv: null,
      hash,
      idfact: buildIdfact(input.nif, input.invoiceNumber, input.issueDate),
      response: { kind: 'configuration_invalid' },
      errorMessage: fiscalValidation.message,
      errorCode: 'configuration_invalid',
      aeatCode: null,
      warnings: [],
    })
  }
  return submitPayloadToVerifactu(
    {
      reference: input.invoiceNumber,
      hash,
      idfact: buildIdfact(input.nif, input.invoiceNumber, input.issueDate),
      xml: buildVerifactuXml(input, hash, config.software),
    },
    config,
    logger,
  )
}

/** Submit a RegistroAnulacion record to AEAT. Never throws. */
export function cancelInVerifactu(
  input: VerifactuCancellationInput,
  config: VerifactuConfig,
  logger: VerifactuLogger = noopLogger,
): Promise<VerifactuSubmitResult> {
  const fiscalValidation = validateVerifactuCancellation(input, config.software)
  const hash = computeCancellationHash(input)
  if (!fiscalValidation.valid) {
    return Promise.resolve({
      status: 'error',
      aeatStatus: null,
      csv: null,
      hash,
      idfact: buildIdfact(input.nif, input.cancelledInvoiceNumber, input.cancelledInvoiceIssueDate),
      response: { kind: 'configuration_invalid' },
      errorMessage: fiscalValidation.message,
      errorCode: 'configuration_invalid',
      aeatCode: null,
      warnings: [],
    })
  }
  return submitPayloadToVerifactu(
    {
      reference: input.cancelledInvoiceNumber,
      hash,
      idfact: buildIdfact(input.nif, input.cancelledInvoiceNumber, input.cancelledInvoiceIssueDate),
      xml: buildVerifactuCancellationXml(input, hash, config.software),
    },
    config,
    logger,
  )
}
