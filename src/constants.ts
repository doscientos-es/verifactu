/**
 * Domain constants for the Verifactu / SIF module (RD 1007/2023, HAC/1177/2024).
 */

/** AEAT "ValidarQR" cotejo endpoints, keyed by `VERIFACTU_ENV`. */
export const AEAT_VALIDATE_QR_URL = {
  prod: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR",
  test: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR",
} as const;

/** SOAP service endpoints for AltaRegistroFactura / AnulaRegistroFactura. */
export const AEAT_SOAP_ENDPOINT = {
  prod: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  test: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
} as const;

/** SOAPAction for the AltaRegistroFactura operation. */
export const AEAT_SOAP_ACTION_ALTA =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SistemaFacturacion/altaRegistroFactura";
