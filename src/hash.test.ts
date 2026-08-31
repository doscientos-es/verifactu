import { describe, expect, it } from 'vitest'

import {
  buildCancellationHashPayload,
  buildHashPayload,
  computeCancellationHash,
  computeInvoiceHash,
} from './hash'
import { buildIdfact } from './idfact'

const baseInput = {
  nif: 'B12345678',
  invoiceNumber: 'A-000001',
  invoiceType: 'F1',
  issueDate: new Date(Date.UTC(2026, 4, 25)),
  taxAmount: 21.0,
  total: 121.0,
  previousHash: null,
  generatedAt: new Date(Date.UTC(2026, 4, 25, 12, 0, 0)),
} as const

describe('verifactu hash', () => {
  it('sends an empty Huella for the first invoice of the chain', () => {
    const payload = buildHashPayload(baseInput)
    expect(payload).toContain('&Huella=&')
  })

  it('formats issue date as DD-MM-YYYY', () => {
    const payload = buildHashPayload(baseInput)
    expect(payload).toContain('FechaExpedicionFactura=25-05-2026')
  })

  // Official AEAT vector (Especificaciones huella v0.1.2, apartado 6.1).
  it('matches the official AEAT RegistroAlta vector', () => {
    const input = {
      nif: '89890001K',
      invoiceNumber: '12345678/G33',
      invoiceType: 'F1',
      issueDate: new Date(Date.UTC(2024, 0, 1)),
      taxAmount: 12.35,
      total: 123.45,
      previousHash: null,
      generatedAt: new Date('2024-01-01T19:20:30+01:00'),
    }
    expect(buildHashPayload(input)).toBe(
      'IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00',
    )
    expect(computeInvoiceHash(input)).toBe(
      '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60',
    )
  })

  it('produces a deterministic SHA-256 uppercase hex hash', () => {
    const h1 = computeInvoiceHash(baseInput)
    const h2 = computeInvoiceHash(baseInput)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[A-F0-9]{64}$/)
  })

  it('chains different hashes for different previous_hash', () => {
    const h1 = computeInvoiceHash(baseInput)
    const h2 = computeInvoiceHash({ ...baseInput, previousHash: h1 })
    expect(h1).not.toBe(h2)
  })

  it('formats amounts with 2 decimals', () => {
    const payload = buildHashPayload({ ...baseInput, taxAmount: 21, total: 121 })
    expect(payload).toContain('CuotaTotal=21.00')
    expect(payload).toContain('ImporteTotal=121.00')
  })

  it('uses the RegistroAnulacion field names and order', () => {
    const input = {
      nif: '89890001K',
      cancelledInvoiceNumber: '12345678/G33',
      cancelledInvoiceIssueDate: new Date(Date.UTC(2024, 0, 1)),
      previousHash: 'PREVIOUSHASH',
      generatedAt: new Date('2024-01-01T19:20:30+01:00'),
    }
    expect(buildCancellationHashPayload(input)).toBe(
      'IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=12345678/G33&FechaExpedicionFacturaAnulada=01-01-2024&Huella=PREVIOUSHASH&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00',
    )
    expect(computeCancellationHash(input)).toMatch(/^[A-F0-9]{64}$/)
  })
})

describe('idfact', () => {
  it('formats as NIF-FULLNUMBER-YYYYMMDD', () => {
    const id = buildIdfact('B12345678', 'A-000001', new Date(Date.UTC(2026, 4, 25)))
    expect(id).toBe('B12345678-A-000001-20260525')
  })
})
