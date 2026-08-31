import { describe, expect, it } from 'vitest'

import { buildVerifactuXml } from './client'
import { validateVerifactuXsd } from './schema'
import type { VerifactuSoftware } from './types'

const software: VerifactuSoftware = {
  producerName: 'Test Company S.L.',
  producerNif: 'B12345678',
  name: 'TestApp',
  id: 'D1',
  version: '1.0.0',
  installationNumber: '00000001',
  onlyVerifactu: true,
  multipleTaxpayers: false,
}

const input = {
  nif: 'B12345678',
  invoiceNumber: 'A-000001',
  invoiceType: 'F1',
  issueDate: new Date('2026-03-15T00:00:00.000Z'),
  taxAmount: 21,
  total: 121,
  previousHash: null,
  generatedAt: new Date('2026-03-15T12:00:00.000Z'),
  emisorName: 'Test Company S.L.',
  clientNif: '12345678A',
  clientName: 'Test Client',
  descriptionOperacion: 'Servicios de prueba',
  vatLines: [{ rate: 21, base: 100, tax: 21 }],
  previousInvoiceNumber: null,
  previousIssueDate: null,
}

describe('AEAT XSD validation', () => {
  it('accepts the generated RegistroAlta', () => {
    expect(validateVerifactuXsd(buildVerifactuXml(input, 'A'.repeat(64), software))).toEqual({
      valid: true,
    })
  })

  it('rejects structurally invalid XML even when it is well formed', () => {
    const xml = buildVerifactuXml(input, 'A'.repeat(64), software).replace(
      '<sf:TipoHuella>01</sf:TipoHuella>',
      '<sf:TipoHuella>99</sf:TipoHuella>',
    )
    const result = validateVerifactuXsd(xml)
    expect(result.valid).toBe(false)
  })

  it('rejects the old invalid Incidencia placement', () => {
    const xml = buildVerifactuXml({ ...input, incidence: true }, 'A'.repeat(64), software).replace(
      '<sf:RemisionVoluntaria><sf:Incidencia>S</sf:Incidencia></sf:RemisionVoluntaria>',
      '<sf:Incidencia>S</sf:Incidencia>',
    )
    expect(validateVerifactuXsd(xml).valid).toBe(false)
  })

  it('accepts a rectificative RegistroAlta with its references', () => {
    const xml = buildVerifactuXml(
      {
        ...input,
        invoiceType: 'R1',
        rectificationType: 'S',
        rectifiedInvoices: [
          { invoiceNumber: 'A-000000', issueDate: new Date('2026-03-01T00:00:00.000Z') },
        ],
        rectificationAmounts: { base: 90, tax: 18 },
      },
      'A'.repeat(64),
      software,
    )
    expect(validateVerifactuXsd(xml)).toEqual({ valid: true })
  })
})
