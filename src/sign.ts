/** XAdES enveloped XML signatures. Fiscal compliance requires additional controls. */

import { createHash, createPublicKey, randomUUID, X509Certificate } from 'node:crypto'

import { XMLValidator } from 'fast-xml-parser'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'

import { spanishTimestamp } from './hash'

const DS_NS = 'http://www.w3.org/2000/09/xmldsig#'
const XADES_NS = 'http://uri.etsi.org/01903/v1.3.2#'
const C14N_ALG = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const SHA256_ALG = 'http://www.w3.org/2001/04/xmlenc#sha256'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'

export interface P12Cert {
  certDerBase64: string // DER cert encoded in base64
  certDigestB64: string // SHA-256(DER) in base64
  issuerName: string // X.509 issuer DN (RFC 4514 reversed)
  serialNumber: string // certificate serial as decimal string
  privateKey: forge.pki.rsa.PrivateKey
}

/** Decode the configured PKCS#12 value without silently accepting bad input. */
export function decodeP12Base64(p12Base64: string): Buffer {
  const value = p12Base64.replace(/\s/g, '')
  if (/^data:/i.test(value)) {
    throw new Error(
      'PKCS12: se recibió una data URL; configure solo el Base64 del archivo .p12/.pfx',
    )
  }
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error('PKCS12: VERIFACTU_CERT_P12_BASE64 no es Base64 válido o está truncado')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length < 16) {
    throw new Error('PKCS12: el certificado Base64 está vacío o incompleto')
  }
  return decoded
}

/** Load a PKCS12 (.p12) and extract the signing certificate and private key. */
export function loadP12Cert(p12Base64: string, password: string): P12Cert {
  const p12Buf = decodeP12Base64(p12Base64)
  const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12Buf.toString('binary')))
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password)

  const certBagType = forge.pki.oids.certBag as string
  const keyBagType = forge.pki.oids.pkcs8ShroudedKeyBag as string

  const certBags = p12.getBags({ bagType: certBagType })[certBagType] ?? []
  const keyBags = p12.getBags({ bagType: keyBagType })[keyBagType] ?? []

  const certBag = certBags[0]
  const keyBag = keyBags[0]
  if (!certBag?.cert) throw new Error('PKCS12: no certificate bag found')
  if (!keyBag?.key) throw new Error('PKCS12: no private key bag found')

  const cert = certBag.cert
  const privateKey = keyBag.key as forge.pki.rsa.PrivateKey

  const certDerBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  const certDerBase64 = Buffer.from(certDerBytes, 'binary').toString('base64')
  const certDigestB64 = createHash('sha256')
    .update(Buffer.from(certDerBase64, 'base64'))
    .digest('base64')

  return { certDerBase64, certDigestB64, ...certificateIdentity(cert), privateKey }
}

function escapeRdn(v: string): string {
  return v.replace(/[,+="\\<>;#]/g, (c) => `\\${c}`).replace(/^ | $/g, '\\ ')
}

function certificateIdentity(cert: forge.pki.Certificate) {
  return {
    issuerName: cert.issuer.attributes
      .slice()
      .reverse()
      .map(
        (attribute: forge.pki.CertificateField) =>
          `${attribute.shortName ?? attribute.type}=${escapeRdn(String(attribute.value))}`,
      )
      .join(','),
    serialNumber: BigInt(`0x${cert.serialNumber}`).toString(10),
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── XML builders ────────────────────────────────────────────────────────────

function buildSignedProperties(cert: P12Cert, signingTime: Date, id: string): string {
  const time = spanishTimestamp(signingTime)
  return (
    `<xades:SignedProperties xmlns:xades="${XADES_NS}" Id="${id}">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${time}</xades:SigningTime>` +
    `<xades:SigningCertificate>` +
    `<xades:Cert>` +
    `<xades:CertDigest>` +
    `<ds:DigestMethod xmlns:ds="${DS_NS}" Algorithm="${SHA256_ALG}"/>` +
    `<ds:DigestValue xmlns:ds="${DS_NS}">${cert.certDigestB64}</ds:DigestValue>` +
    `</xades:CertDigest>` +
    `<xades:IssuerSerial>` +
    `<ds:X509IssuerName xmlns:ds="${DS_NS}">${escapeXml(cert.issuerName)}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber xmlns:ds="${DS_NS}">${cert.serialNumber}</ds:X509SerialNumber>` +
    '</xades:IssuerSerial>' +
    `</xades:Cert>` +
    `</xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties>` +
    '</xades:SignedProperties>'
  )
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sign an unsigned XML document, including its XAdES signed properties.
 * This primitive does not by itself implement or certify a fiscal system.
 */
export function signXml(unsignedXml: string, cert: P12Cert, signingTime?: Date): string {
  const now = signingTime ?? new Date()
  if (
    !Number.isFinite(now.getTime()) ||
    /<!DOCTYPE/i.test(unsignedXml) ||
    /<(?:[A-Za-z_][\w.-]*:)?Signature(?:\s|\/|>)/.test(unsignedXml) ||
    XMLValidator.validate(unsignedXml) !== true
  )
    throw new Error('signXml: invalid or already signed XML')

  const certBytes = Buffer.from(cert.certDerBase64, 'base64')
  const certificate = new X509Certificate(certBytes)
  const privateKey = forge.pki.privateKeyToPem(cert.privateKey)
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  if (
    !publicKey.equals(certificate.publicKey.export({ type: 'spki', format: 'der' })) ||
    createHash('sha256').update(certBytes).digest('base64') !== cert.certDigestB64
  )
    throw new Error('signXml: certificate and private key do not match')

  const parsed = forge.pki.certificateFromAsn1(forge.asn1.fromDer(certBytes.toString('binary')))
  const signingCert = { ...cert, ...certificateIdentity(parsed) }

  const sigId = `SIG-${randomUUID()}`
  const spropsId = `${sigId}-SPROPS`
  const signer = new SignedXml({
    privateKey,
    publicCert: certificate.toString(),
    canonicalizationAlgorithm: C14N_ALG,
    signatureAlgorithm: RSA_SHA256,
    objects: [
      {
        content:
          `<xades:QualifyingProperties xmlns:xades="${XADES_NS}" Target="#${sigId}">` +
          buildSignedProperties(signingCert, now, spropsId) +
          '</xades:QualifyingProperties>',
      },
    ],
  })
  signer.addReference({
    xpath: '/*',
    isEmptyUri: true,
    id: `${sigId}-REF-DOC`,
    transforms: [ENVELOPED, C14N_ALG],
    digestAlgorithm: SHA256_ALG,
  })
  signer.addReference({
    xpath: `//*[@Id='${spropsId}']`,
    type: 'http://uri.etsi.org/01903#SignedProperties',
    transforms: [C14N_ALG],
    digestAlgorithm: SHA256_ALG,
  })
  signer.computeSignature(unsignedXml, { prefix: 'ds', attrs: { Id: sigId } })
  return signer.getSignedXml()
}
