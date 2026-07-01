/**
 * XAdES-BES enveloped signature for Verifactu (HAC/1177/2024).
 *
 * Uses node-forge to load a PKCS12 certificate and sign the XML payload
 * with RSA-SHA256. The signature is embedded before the root closing tag.
 *
 * NOTE: This implementation computes the document digest on the raw UTF-8
 * bytes of the unsigned document. This is valid because:
 *   (a) We generate the XML deterministically (no declaration, no BOM).
 *   (b) The enveloped-signature transform removes the <ds:Signature> element
 *       before digest verification; since the signature is absent from the
 *       input, the digest covers exactly the canonical document bytes.
 */

import { createHash } from "node:crypto";
import forge from "node-forge";
import { spanishTimestamp } from "./hash";

const DS_NS = "http://www.w3.org/2000/09/xmldsig#";
const XADES_NS = "http://uri.etsi.org/01903/v1.3.2#";
const C14N_ALG = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256_ALG = "http://www.w3.org/2001/04/xmlenc#sha256";

export interface P12Cert {
  certDerBase64: string; // DER cert encoded in base64
  certDigestB64: string; // SHA-256(DER) in base64
  issuerName: string; // X.509 issuer DN (RFC 4514 reversed)
  serialNumber: string; // certificate serial as decimal string
  privateKey: forge.pki.rsa.PrivateKey;
}

/** Load a PKCS12 (.p12) and extract the signing certificate and private key. */
export function loadP12Cert(p12Base64: string, password: string): P12Cert {
  const p12Buf = Buffer.from(p12Base64, "base64");
  const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12Buf));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

  const certBagType = forge.pki.oids.certBag as string;
  const keyBagType = forge.pki.oids.pkcs8ShroudedKeyBag as string;

  const certBags = p12.getBags({ bagType: certBagType })[certBagType] ?? [];
  const keyBags = p12.getBags({ bagType: keyBagType })[keyBagType] ?? [];

  const certBag = certBags[0];
  const keyBag = keyBags[0];
  if (!certBag?.cert) throw new Error("PKCS12: no certificate bag found");
  if (!keyBag?.key) throw new Error("PKCS12: no private key bag found");

  const cert = certBag.cert;
  const privateKey = keyBag.key as forge.pki.rsa.PrivateKey;

  const certDerBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const certDerBase64 = Buffer.from(certDerBytes, "binary").toString("base64");
  const certDigestB64 = createHash("sha256")
    .update(Buffer.from(certDerBase64, "base64"))
    .digest("base64");

  // RFC 4514: reverse attribute order
  const issuerName = cert.issuer.attributes
    .slice()
    .reverse()
    .map((a: forge.pki.CertificateField) => `${a.shortName}=${escapeRdn(String(a.value))}`)
    .join(",");

  // Serial number as decimal (forge gives hex without 0x prefix)
  const serialNumber = BigInt(`0x${cert.serialNumber}`).toString(10);

  return { certDerBase64, certDigestB64, issuerName, serialNumber, privateKey };
}

function escapeRdn(v: string): string {
  return v.replace(/[,+="\\<>;#]/g, (c) => `\\${c}`);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── XML builders ────────────────────────────────────────────────────────────

function buildSignedProperties(cert: P12Cert, signingTime: Date, id: string): string {
  const time = spanishTimestamp(signingTime);
  return (
    `<xades:SignedProperties xmlns:xades="${XADES_NS}" Id="${id}">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${time}</xades:SigningTime>` +
    `<xades:SigningCertificateV2>` +
    `<xades:Cert>` +
    `<xades:CertDigest>` +
    `<ds:DigestMethod xmlns:ds="${DS_NS}" Algorithm="${SHA256_ALG}"/>` +
    `<ds:DigestValue xmlns:ds="${DS_NS}">${cert.certDigestB64}</ds:DigestValue>` +
    `</xades:CertDigest>` +
    `<xades:IssuerSerialV2>` +
    `<ds:X509IssuerName xmlns:ds="${DS_NS}">${escapeXml(cert.issuerName)}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber xmlns:ds="${DS_NS}">${cert.serialNumber}</ds:X509SerialNumber>` +
    "</xades:IssuerSerialV2>" +
    `</xades:Cert>` +
    `</xades:SigningCertificateV2>` +
    `</xades:SignedSignatureProperties>` +
    "</xades:SignedProperties>"
  );
}

function buildSignedInfo(
  sigId: string,
  spropsId: string,
  docDigest: string,
  propsDigest: string,
): string {
  return (
    `<ds:SignedInfo xmlns:ds="${DS_NS}">` +
    `<ds:CanonicalizationMethod Algorithm="${C14N_ALG}"/>` +
    `<ds:SignatureMethod Algorithm="${RSA_SHA256}"/>` +
    `<ds:Reference Id="${sigId}-REF-DOC" URI="">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
    `<ds:Transform Algorithm="${C14N_ALG}"/>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA256_ALG}"/>` +
    `<ds:DigestValue>${docDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Id="${sigId}-REF-XADES" Type="http://uri.etsi.org/01903#SignedProperties" URI="#${spropsId}">` +
    `<ds:DigestMethod Algorithm="${SHA256_ALG}"/>` +
    `<ds:DigestValue>${propsDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Embed an XAdES-BES enveloped signature inside `unsignedXml`.
 * The signature element is inserted just before the root closing tag.
 */
export function signXml(unsignedXml: string, cert: P12Cert, signingTime?: Date): string {
  const now = signingTime ?? new Date();
  const docBuf = Buffer.from(unsignedXml, "utf8");
  const sigId = `SIG-${createHash("sha256").update(docBuf).digest("hex").slice(0, 8).toUpperCase()}`;
  const spropsId = `${sigId}-SPROPS`;

  // 1. Document digest (unsigned XML bytes)
  const docDigest = sha256b64(docBuf);

  // 2. SignedProperties digest
  const signedPropsXml = buildSignedProperties(cert, now, spropsId);
  const propsDigest = sha256b64(Buffer.from(signedPropsXml, "utf8"));

  // 3. Build and sign SignedInfo
  const signedInfoXml = buildSignedInfo(sigId, spropsId, docDigest, propsDigest);
  const md = forge.md.sha256.create();
  md.update(signedInfoXml, "utf8");
  const signatureB64 = Buffer.from(cert.privateKey.sign(md), "binary").toString("base64");

  // 4. Assemble full ds:Signature element
  const signatureEl =
    `<ds:Signature xmlns:ds="${DS_NS}" Id="${sigId}">` +
    signedInfoXml +
    `<ds:SignatureValue Id="${sigId}-VALUE">${signatureB64}</ds:SignatureValue>` +
    `<ds:KeyInfo>` +
    `<ds:X509Data>` +
    `<ds:X509Certificate>${cert.certDerBase64}</ds:X509Certificate>` +
    `</ds:X509Data>` +
    `</ds:KeyInfo>` +
    `<ds:Object Id="${sigId}-OBJ">` +
    `<xades:QualifyingProperties xmlns:xades="${XADES_NS}" Target="#${sigId}">` +
    signedPropsXml +
    `</xades:QualifyingProperties>` +
    `</ds:Object>` +
    `</ds:Signature>`;

  // 5. Embed before root closing tag
  const lastClose = unsignedXml.lastIndexOf("</");
  if (lastClose === -1) throw new Error("signXml: cannot locate root closing tag");
  return unsignedXml.slice(0, lastClose) + signatureEl + unsignedXml.slice(lastClose);
}

function sha256b64(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("base64");
}
