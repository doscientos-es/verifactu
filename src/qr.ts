import QRCode from 'qrcode'

import { AEAT_VALIDATE_QR_URL } from './constants'
import { spanishDate } from './hash'
import type { VerifactuQrConfig } from './types'

/**
 * Build the QR payload URL pointing to the AEAT cotejo endpoint (or the mock).
 * In `mock` mode, points to a local route that mirrors the same query params.
 */
export type QrParams = {
  nif: string
  invoiceNumber: string
  issueDate: Date
  total: number
}

export function buildQrUrl(p: QrParams, config: VerifactuQrConfig): string {
  const qs = new URLSearchParams({
    nif: p.nif,
    numserie: p.invoiceNumber,
    fecha: spanishDate(p.issueDate),
    importe: p.total.toFixed(2),
  })
  if (config.environment === 'prod') return `${AEAT_VALIDATE_QR_URL.prod}?${qs.toString()}`
  if (config.environment === 'test') return `${AEAT_VALIDATE_QR_URL.test}?${qs.toString()}`
  return `${config.appUrl}/p/verify?${qs.toString()}`
}

export async function buildQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
}
