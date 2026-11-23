import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

import forge from 'node-forge'
import { beforeAll, describe, expect, it } from 'vitest'
import { SignedXml } from 'xml-crypto'

import { loadP12Cert, signXml, type P12Cert } from './sign'

let cert: P12Cert
let publicPem: string
let testP12: string

beforeAll(() => {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 })
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = keys.publicKey
  certificate.serialNumber = '01'
  certificate.validity.notBefore = new Date('2025-01-01T00:00:00Z')
  certificate.validity.notAfter = new Date('2030-01-01T00:00:00Z')
  certificate.setSubject([{ name: 'commonName', value: 'Test issuer' }])
  certificate.setIssuer([{ name: 'commonName', value: 'Test issuer' }])
  certificate.sign(keys.privateKey, forge.md.sha256.create())
  const der = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(),
    'binary',
  )
  publicPem = forge.pki.certificateToPem(certificate)
  cert = {
    privateKey: keys.privateKey,
    certDerBase64: der.toString('base64'),
    certDigestB64: createHash('sha256').update(der).digest('base64'),
    issuerName: 'CN=Test issuer',
    serialNumber: '1',
  }
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, certificate, 'test-password')
  testP12 = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64')
})

const xml =
  '<?xml version="1.0"?><r:record xmlns:r="urn:record" xmlns:extra="urn:extra" z="2" a="1"><r:value>Factura &amp; IVA</r:value><empty/></r:record>'
const time = new Date('2026-11-22T10:00:00Z')

function verify(signed: string): boolean {
  const signature = signed.match(/<ds:Signature\b[\s\S]*?<\/ds:Signature>/)?.[0]
  if (!signature) throw new Error('Missing signature')
  const verifier = new SignedXml({ publicCert: publicPem })
  verifier.loadSignature(signature)
  try {
    return verifier.checkSignature(signed)
  } catch {
    return false
  }
}

describe('XAdES XML signing', () => {
  it('signs both the document and its signed properties with canonical XML', () => {
    const signed = signXml(xml, cert, time)
    expect(verify(signed)).toBe(true)
    expect(signed).toContain('Type="http://uri.etsi.org/01903#SignedProperties"')
    expect(signed).toContain('<xades:SigningCertificate>')
    expect(signed).toContain('<xades:IssuerSerial>')
    expect(signed).not.toContain('<xades:IssuerSerialV2>')
  })

  it('rejects changes to the invoice and to the signed properties', () => {
    const signed = signXml(xml, cert, time)
    expect(verify(signed.replace('Factura &amp; IVA', 'Factura manipulada'))).toBe(false)
    expect(verify(signed.replace('CN=Test issuer', 'CN=Other issuer'))).toBe(false)
  })

  it('loads a PKCS12 identity and handles document-level processing instructions', () => {
    const input = `<?before test?>${xml.replace('<?xml version="1.0"?>', '')}<?after test?>`
    expect(verify(signXml(input, loadP12Cert(testP12, 'test-password'), time))).toBe(true)
  })

  it('derives the signed certificate identity from the certificate, not supplied metadata', () => {
    const signed = signXml(xml, { ...cert, issuerName: 'CN=Wrong', serialNumber: '999' }, time)
    expect(verify(signed)).toBe(true)
    expect(signed).toContain('CN=Test issuer')
    expect(signed).not.toContain('CN=Wrong')
    expect(signed).toContain(
      '<ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">1</ds:X509SerialNumber>',
    )
  })

  it('rejects malformed XML, DTDs, existing signatures and mismatched certificates', () => {
    expect(() => signXml('<record><value></record>', cert, time)).toThrow()
    expect(() => signXml('<!DOCTYPE record><record/>', cert, time)).toThrow()
    expect(() => signXml(signXml(xml, cert, time), cert, time)).toThrow()
    expect(() => signXml(xml, { ...cert, certDigestB64: 'invalid' }, time)).toThrow()
    const other = forge.pki.rsa.generateKeyPair({ bits: 1024 })
    expect(() => signXml(xml, { ...cert, privateKey: other.privateKey }, time)).toThrow()
  })

  it.skipIf(process.platform !== 'win32')(
    'passes an independent .NET XML signature verifier',
    () => {
      const script = [
        '$ErrorActionPreference="Stop"; Add-Type -AssemblyName System.Security;',
        '$documents=ConvertFrom-Json ([Console]::In.ReadToEnd());',
        'foreach ($xml in $documents) {',
        '$d=New-Object System.Xml.XmlDocument; $d.PreserveWhitespace=$true; $d.LoadXml($xml);',
        '$n=New-Object System.Xml.XmlNamespaceManager($d.NameTable);',
        '$n.AddNamespace("ds","http://www.w3.org/2000/09/xmldsig#");',
        '$s=New-Object System.Security.Cryptography.Xml.SignedXml($d);',
        '$s.LoadXml($d.SelectSingleNode("//ds:Signature",$n));',
        '$x=$d.SelectSingleNode("//ds:X509Certificate",$n).InnerText;',
        '$c=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(,[Convert]::FromBase64String($x));',
        'Write-Output $s.CheckSignature($c,$true) }',
      ].join(' ')
      const signed = signXml(xml, cert, time)
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          input: JSON.stringify([
            signed,
            signed.replace('Factura &amp; IVA', 'Factura manipulada'),
            signed.replace('CN=Test issuer', 'CN=Other issuer'),
          ]),
          encoding: 'utf8',
          timeout: 15000,
        },
      )
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout.trim().split(/\s+/)).toEqual(['True', 'False', 'False'])
    },
  )
})
