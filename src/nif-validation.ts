import { XMLParser } from "fast-xml-parser";
import https from "node:https";
import type { VerifactuCertificate } from "./types";

export const AEAT_NIF_ENDPOINTS = [
	"https://ws.ia.aeat.es/wlpl/SUWS-JDIT/ws/valnifws/VALNIFV3SOAP",
	"https://www1.agenciatributaria.gob.es/wlpl/BURT-JDIT/ws/VNifV2SOAP",
	"https://www10.agenciatributaria.gob.es/wlpl/BURT-JDIT/ws/VNifV2SOAP",
] as const;

const NAMESPACE =
	"http://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/burt/jdit/ws/VNifV2Ent.xsd";

export type AeatFiscalIdentity = { nif: string; name: string };

export type AeatNifValidation = {
	status: "verified" | "mismatch" | "unavailable";
	aeatName: string | null;
	aeatResult: string | null;
	message: string;
};

export type AeatNifValidationOptions = {
	endpoints?: readonly string[];
	requestTimeoutMs?: number;
	maxResponseBytes?: number;
};

function escapeXml(value: string): string {
	return value.replace(
		/[<>&"']/g,
		(char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char] ?? char,
	);
}

export function buildAeatNifEnvelope({ nif, name }: AeatFiscalIdentity): string {
	return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:vnif="${NAMESPACE}"><soapenv:Header/><soapenv:Body><vnif:VNifV2Ent><vnif:Contribuyente><vnif:Nif>${escapeXml(nif)}</vnif:Nif><vnif:Nombre>${escapeXml(name)}</vnif:Nombre></vnif:Contribuyente></vnif:VNifV2Ent></soapenv:Body></soapenv:Envelope>`;
}

function normalizedResult(value: string): string {
	return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();
}

export function interpretAeatNifResponse(xml: string): AeatNifValidation {
	try {
		const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true })
			.parse(xml) as Record<string, unknown>;
		const envelope = parsed.Envelope as Record<string, unknown> | undefined;
		const body = envelope?.Body as Record<string, unknown> | undefined;
		const response = body?.VNifV2Sal as Record<string, unknown> | undefined;
		const taxpayer = response?.Contribuyente as Record<string, unknown> | undefined;
		const result = typeof taxpayer?.Resultado === "string" ? taxpayer.Resultado.trim() : "";
		const aeatName = typeof taxpayer?.Nombre === "string" ? taxpayer.Nombre.trim() || null : null;
		if (!result) throw new Error("Respuesta sin resultado censal");
		if (normalizedResult(result) === "IDENTIFICADO") {
			return { status: "verified", aeatName, aeatResult: result, message: "Identificado en el censo de AEAT." };
		}
		if (normalizedResult(result) === "NO PROCESADO") {
			return {
				status: "unavailable", aeatName, aeatResult: result,
				message: "AEAT no ha procesado la consulta. Inténtalo de nuevo antes de emitir.",
			};
		}
		return {
			status: "mismatch", aeatName, aeatResult: result,
			message: aeatName
				? `AEAT no identifica esa combinación. Denominación censal: ${aeatName}.`
				: "AEAT no identifica esa combinación de NIF y razón social.",
		};
	} catch {
		return {
			status: "unavailable", aeatName: null, aeatResult: null,
			message: "AEAT devolvió una respuesta no válida.",
		};
	}
}

function postSoap(
	endpoint: string,
	xml: string,
	certificate: VerifactuCertificate,
	timeoutMs: number,
	maxResponseBytes: number,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const body = Buffer.from(xml, "utf8");
		const request = https.request(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "text/xml; charset=utf-8",
				"Content-Length": body.length,
				SOAPAction: "",
			},
			pfx: Buffer.from(certificate.p12Base64, "base64"),
			passphrase: certificate.password,
			rejectUnauthorized: true,
			timeout: timeoutMs,
		}, (response) => {
			const chunks: Buffer[] = [];
			let size = 0;
			response.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > maxResponseBytes) request.destroy(new Error("La respuesta de AEAT excede el límite"));
				else chunks.push(chunk);
			});
			response.on("end", () => {
				if ((response.statusCode ?? 500) >= 400) reject(new Error(`AEAT respondió HTTP ${response.statusCode}`));
				else resolve(Buffer.concat(chunks).toString("utf8"));
			});
		});
		request.once("timeout", () => request.destroy(new Error("Tiempo de espera agotado al consultar AEAT")));
		request.once("error", reject);
		request.end(body);
	});
}

export async function validateSpanishFiscalIdentity(
	identity: AeatFiscalIdentity,
	certificate: VerifactuCertificate,
	options: AeatNifValidationOptions = {},
): Promise<AeatNifValidation> {
	const envelope = buildAeatNifEnvelope(identity);
	for (const endpoint of options.endpoints ?? AEAT_NIF_ENDPOINTS) {
		try {
			return interpretAeatNifResponse(await postSoap(
				endpoint,
				envelope,
				certificate,
				options.requestTimeoutMs ?? 30_000,
				options.maxResponseBytes ?? 1_048_576,
			));
		} catch {
			// All endpoints are read-only alternatives published by AEAT.
		}
	}
	return {
		status: "unavailable", aeatName: null, aeatResult: null,
		message: "No se pudo consultar AEAT. Inténtalo de nuevo antes de regularizar.",
	};
}