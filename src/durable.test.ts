import { describe, expect, it } from 'vitest'

import {
  formatVerifactuDeliveryError,
  isRetryableVerifactuDelivery,
  parseDurableAltaPayload,
  parseDurableCancellationPayload,
  prepareDurableVerifactuRecord,
  resolveVerifactuSoftwareSnapshot,
  sanitizeVerifactuResponse,
  verifactuWaitSeconds,
} from './durable'
import { computeCancellationHash, computeInvoiceHash } from './hash'
import type { VerifactuSoftware } from './types'

const software: VerifactuSoftware = {
  producerName: 'Doscientos',
  producerNif: 'B12345678',
  name: 'Backoffice',
  id: 'D1',
  version: '1.0.0',
  installationNumber: '00000001',
  onlyVerifactu: true,
  multipleTaxpayers: false,
}

const altaPayload = {
  recordType: 'alta',
  nif: 'B12345678',
  invoiceNumber: '2026-000009',
  invoiceType: 'F1',
  issueDate: '2026-08-23',
  taxAmount: 21,
  total: 121,
  previousHash: null,
  generatedAt: '2026-08-23T10:00:00.000Z',
  emisorName: 'Doscientos SL',
  clientNif: '12345678Z',
  clientName: 'Cliente SL',
  descriptionOperacion: 'Servicios',
  vatLines: [{ rate: 21, base: 100, tax: 21 }],
  previousInvoiceNumber: null,
  previousIssueDate: null,
  subsanacion: 'S',
  rechazoPrevio: 'X',
  software,
}

describe('durable VERI*FACTU engine', () => {
  it('decodes Alta por rechazo without changing its immutable values', () => {
    const input = parseDurableAltaPayload(altaPayload)
    expect(input).toMatchObject({
      invoiceNumber: '2026-000009',
      subsanacion: 'S',
      rechazoPrevio: 'X',
    })
    expect(input.issueDate).toBeInstanceOf(Date)
  })

  it('verifies the stored Alta hash before preparing delivery', () => {
    const input = parseDurableAltaPayload(altaPayload)
    const prepared = prepareDurableVerifactuRecord(
      {
        recordType: 'alta',
        payload: altaPayload,
        currentHash: computeInvoiceHash(input),
        incidence: true,
      },
      software,
    )
    expect(prepared).toMatchObject({ recordType: 'alta', software, input: { incidence: true } })
    expect(() =>
      prepareDurableVerifactuRecord(
        {
          recordType: 'alta',
          payload: altaPayload,
          currentHash: 'A'.repeat(64),
        },
        software,
      ),
    ).toThrow('La huella del ledger no coincide')
  })

  it('decodes and verifies cancellation payloads', () => {
    const payload = {
      recordType: 'anulacion',
      nif: 'B12345678',
      cancelledInvoiceNumber: '2026-000009',
      cancelledInvoiceIssueDate: '2026-08-23',
      previousHash: null,
      generatedAt: '2026-08-24T10:00:00.000Z',
      emisorName: 'Doscientos SL',
      previousInvoiceNumber: null,
      previousIssueDate: null,
      software,
    }
    const input = parseDurableCancellationPayload(payload)
    expect(input).toMatchObject({ sinRegistroPrevio: 'N', rechazoPrevio: 'N' })
    expect(
      prepareDurableVerifactuRecord(
        {
          recordType: 'anulacion',
          payload,
          currentHash: computeCancellationHash(input),
        },
        software,
      ).recordType,
    ).toBe('anulacion')
  })

  it('fails closed for malformed snapshots and cancellation markers', () => {
    expect(() => resolveVerifactuSoftwareSnapshot({ software: {} }, software)).toThrow(
      'Payload fiscal inválido: producerName',
    )
    expect(() =>
      parseDurableCancellationPayload({
        nif: 'B12345678',
        cancelledInvoiceNumber: '1',
        cancelledInvoiceIssueDate: '2026-08-23',
        previousHash: null,
        generatedAt: '2026-08-24T10:00:00.000Z',
        emisorName: 'Doscientos SL',
        previousInvoiceNumber: null,
        previousIssueDate: null,
        rechazoPrevio: 'X',
      }),
    ).toThrow('Payload fiscal inválido: rechazoPrevio')
  })

  it('centralizes retry policy, wait time, error format and response minimization', () => {
    const result = {
      status: 'error' as const,
      aeatStatus: null,
      csv: null,
      hash: 'A'.repeat(64),
      idfact: 'test',
      response: { httpStatus: 503, waitSeconds: 30, rawSoap: 'secret' },
      errorMessage: 'Servicio no disponible',
      errorCode: 'http_error' as const,
      aeatCode: '4102',
      warnings: [],
    }
    expect(isRetryableVerifactuDelivery(result)).toBe(true)
    expect(verifactuWaitSeconds(result)).toBe(30)
    expect(formatVerifactuDeliveryError(null, result)).toBe('AEAT 4102: Servicio no disponible')
    expect(sanitizeVerifactuResponse(result.response)).toEqual({ httpStatus: 503, waitSeconds: 30 })
  })
})
