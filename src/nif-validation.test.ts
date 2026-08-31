import { describe, expect, it } from 'vitest'

import {
  AEAT_NIF_ENDPOINTS,
  buildAeatNifEnvelope,
  interpretAeatNifResponse,
} from './nif-validation'

const response = (result: string, name = 'ACME SL') =>
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><VNifV2Sal><Contribuyente><Nif>B12345678</Nif><Nombre>${name}</Nombre><Resultado>${result}</Resultado></Contribuyente></VNifV2Sal></soapenv:Body></soapenv:Envelope>`

describe('AEAT NIF census validation', () => {
  it('contains all official Internet fallback endpoints', () => {
    expect(AEAT_NIF_ENDPOINTS).toEqual([
      'https://ws.ia.aeat.es/wlpl/SUWS-JDIT/ws/valnifws/VALNIFV3SOAP',
      'https://www1.agenciatributaria.gob.es/wlpl/BURT-JDIT/ws/VNifV2SOAP',
      'https://www10.agenciatributaria.gob.es/wlpl/BURT-JDIT/ws/VNifV2SOAP',
    ])
  })

  it('accepts only the exact Identificado result', () => {
    expect(interpretAeatNifResponse(response('Identificado'))).toMatchObject({
      status: 'verified',
      aeatName: 'ACME SL',
    })
    expect(interpretAeatNifResponse(response('Identificado-similar'))).toMatchObject({
      status: 'mismatch',
    })
  })

  it('distinguishes an unprocessed consultation from a census mismatch', () => {
    expect(interpretAeatNifResponse(response('No procesado'))).toMatchObject({
      status: 'unavailable',
    })
  })

  it('escapes user-controlled fiscal input in the SOAP envelope', () => {
    expect(buildAeatNifEnvelope({ nif: 'B12345678', name: 'A & B <SL>' })).toContain(
      'A &amp; B &lt;SL&gt;',
    )
  })
})
