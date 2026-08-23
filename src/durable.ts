import type {
	VerifactuCancellationInput,
	VerifactuSubmitInput,
	VerifactuSubmitResult,
} from "./client";
import { computeCancellationHash, computeInvoiceHash } from "./hash";
import type { VerifactuSoftware } from "./types";

export type DurableVerifactuRecord = {
	recordType: "alta" | "anulacion";
	currentHash: string;
	payload: unknown;
	incidence?: boolean;
};

export type PreparedDurableVerifactuRecord =
	| { recordType: "alta"; input: VerifactuSubmitInput; software: VerifactuSoftware }
	| { recordType: "anulacion"; input: VerifactuCancellationInput; software: VerifactuSoftware };

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("El registro fiscal almacenado no tiene un formato válido");
	}
	return value as Record<string, unknown>;
}

function text(payload: Record<string, unknown>, key: string): string {
	const value = payload[key];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Payload fiscal inválido: ${key}`);
	}
	return value;
}

function amount(payload: Record<string, unknown>, key: string): number {
	const value = payload[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Payload fiscal inválido: ${key}`);
	}
	return value;
}

function date(payload: Record<string, unknown>, key: string): Date {
	const value = new Date(text(payload, key));
	if (Number.isNaN(value.getTime())) throw new Error(`Fecha fiscal inválida: ${key}`);
	return value;
}

function nullableText(payload: Record<string, unknown>, key: string): string | null {
	const value = payload[key];
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") throw new Error(`Payload fiscal inválido: ${key}`);
	return value;
}

function nullableDate(payload: Record<string, unknown>, key: string): Date | null {
	const value = payload[key];
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") throw new Error(`Fecha fiscal inválida: ${key}`);
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) throw new Error(`Fecha fiscal inválida: ${key}`);
	return parsed;
}

function optionalEnum<T extends string>(
	payload: Record<string, unknown>,
	key: string,
	values: readonly T[],
): T | undefined {
	const value = payload[key];
	if (value === null || value === undefined || value === "") return undefined;
	if (typeof value !== "string" || !values.includes(value as T)) {
		throw new Error(`Payload fiscal inválido: ${key}`);
	}
	return value as T;
}

function references(payload: Record<string, unknown>, key: string) {
	const value = payload[key];
	if (value === null || value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error(`Payload fiscal inválido: ${key}`);
	return value.map((entry) => {
		const row = asRecord(entry);
		return { invoiceNumber: text(row, "invoiceNumber"), issueDate: date(row, "issueDate") };
	});
}

export function normalizeAltaRechazoPrevio(
	value: "N" | "S" | "X" | undefined,
): "S" | "X" | undefined {
	return value === "N" ? undefined : value;
}

export function parseDurableAltaPayload(value: unknown): VerifactuSubmitInput {
	const payload = asRecord(value);
	const vatLines = payload.vatLines;
	if (!Array.isArray(vatLines)) throw new Error("Payload fiscal inválido: vatLines");
	const rechazoPrevio = optionalEnum(payload, "rechazoPrevio", ["N", "S", "X"] as const);
	return {
		nif: text(payload, "nif"),
		invoiceNumber: text(payload, "invoiceNumber"),
		invoiceType: text(payload, "invoiceType"),
		externalReference: nullableText(payload, "externalReference") ?? undefined,
		rectificationType: optionalEnum(payload, "rectificationMethod", ["S", "I"] as const),
		rectifiedInvoices:
			references(payload, "rectifiedInvoices") ??
			(payload.rectifiedInvoiceNumber
				? [{
					invoiceNumber: text(payload, "rectifiedInvoiceNumber"),
					issueDate: date(payload, "rectifiedInvoiceIssueDate"),
				}]
				: undefined),
		substitutedInvoices: references(payload, "substitutedInvoices"),
		rectificationAmounts:
			payload.rectificationAmounts && typeof payload.rectificationAmounts === "object"
				? (() => {
					const amounts = asRecord(payload.rectificationAmounts);
					return {
						base: amount(amounts, "base"),
						tax: amount(amounts, "tax"),
						surcharge:
							amounts.surcharge === undefined ? undefined : amount(amounts, "surcharge"),
					};
				})()
				: undefined,
		operationDate: payload.operationDate ? date(payload, "operationDate") : undefined,
		subsanacion: optionalEnum(payload, "subsanacion", ["S", "N"] as const),
		rechazoPrevio: normalizeAltaRechazoPrevio(rechazoPrevio),
		issueDate: date(payload, "issueDate"),
		taxAmount: amount(payload, "taxAmount"),
		total: amount(payload, "total"),
		previousHash: nullableText(payload, "previousHash"),
		generatedAt: date(payload, "generatedAt"),
		emisorName: text(payload, "emisorName"),
		clientNif: nullableText(payload, "clientNif"),
		clientName: nullableText(payload, "clientName"),
		descriptionOperacion: text(payload, "descriptionOperacion"),
		vatLines: vatLines.map((line) => {
			const row = asRecord(line);
			return { rate: amount(row, "rate"), base: amount(row, "base"), tax: amount(row, "tax") };
		}),
		previousInvoiceNumber: nullableText(payload, "previousInvoiceNumber"),
		previousIssueDate: nullableDate(payload, "previousIssueDate"),
	};
}

export function parseDurableCancellationPayload(value: unknown): VerifactuCancellationInput {
	const payload = asRecord(value);
	return {
		nif: text(payload, "nif"),
		cancelledInvoiceNumber: text(payload, "cancelledInvoiceNumber"),
		cancelledInvoiceIssueDate: date(payload, "cancelledInvoiceIssueDate"),
		previousHash: nullableText(payload, "previousHash"),
		generatedAt: date(payload, "generatedAt"),
		emisorName: text(payload, "emisorName"),
		previousInvoiceNumber: nullableText(payload, "previousInvoiceNumber"),
		previousIssueDate: nullableDate(payload, "previousIssueDate"),
		sinRegistroPrevio: optionalEnum(payload, "sinRegistroPrevio", ["S", "N"] as const) ?? "N",
		rechazoPrevio: optionalEnum(payload, "rechazoPrevio", ["S", "N"] as const) ?? "N",
		externalReference: nullableText(payload, "externalReference") ?? undefined,
	};
}

export function resolveVerifactuSoftwareSnapshot(
	value: unknown,
	legacyFallback: VerifactuSoftware,
): VerifactuSoftware {
	const payload = asRecord(value);
	if (payload.software === undefined || payload.software === null) return legacyFallback;
	const software = asRecord(payload.software);
	const boolean = (key: string): boolean => {
		const entry = software[key];
		if (typeof entry !== "boolean") throw new Error(`Payload fiscal inválido: software.${key}`);
		return entry;
	};
	return {
		producerName: text(software, "producerName"),
		producerNif: text(software, "producerNif"),
		name: text(software, "name"),
		id: text(software, "id"),
		version: text(software, "version"),
		installationNumber: text(software, "installationNumber"),
		onlyVerifactu: boolean("onlyVerifactu"),
		multipleTaxpayers: boolean("multipleTaxpayers"),
	};
}

export function prepareDurableVerifactuRecord(
	record: DurableVerifactuRecord,
	legacySoftware: VerifactuSoftware,
): PreparedDurableVerifactuRecord {
	const software = resolveVerifactuSoftwareSnapshot(record.payload, legacySoftware);
	if (record.recordType === "alta") {
		const input = { ...parseDurableAltaPayload(record.payload), incidence: record.incidence };
		if (computeInvoiceHash(input) !== record.currentHash) {
			throw new Error("La huella del ledger no coincide con su payload");
		}
		return { recordType: "alta", input, software };
	}
	const input = { ...parseDurableCancellationPayload(record.payload), incidence: record.incidence };
	if (computeCancellationHash(input) !== record.currentHash) {
		throw new Error("La huella de anulación no coincide con su payload");
	}
	return { recordType: "anulacion", input, software };
}

export function sanitizeVerifactuResponse(response: unknown): Record<string, unknown> {
	if (!response || typeof response !== "object" || Array.isArray(response)) {
		return { kind: "unknown_response" };
	}
	const allowed = [
		"kind", "httpStatus", "csv", "aeatCode", "aeatDescription", "soapFault",
		"waitSeconds", "error", "errorCode", "aeatStatus", "warnings",
	];
	return Object.fromEntries(
		allowed
			.filter((key) => (response as Record<string, unknown>)[key] !== undefined)
			.map((key) => [key, (response as Record<string, unknown>)[key]]),
	);
}

export function formatVerifactuDeliveryError(
	explicitError: string | null,
	result: Pick<VerifactuSubmitResult, "aeatCode" | "errorMessage"> | null,
): string | null {
	const message = explicitError ?? result?.errorMessage ?? null;
	if (!result?.aeatCode) return message;
	return message ? `AEAT ${result.aeatCode}: ${message}` : `AEAT ${result.aeatCode}`;
}

export function isRetryableVerifactuDelivery(result: VerifactuSubmitResult | null): boolean {
	if (result?.status !== "error") return false;
	if (result.errorCode === "network_error" || result.errorCode === "response_invalid") return true;
	if (result.errorCode !== "http_error") return false;
	const status = (result.response as { httpStatus?: unknown }).httpStatus;
	return typeof status === "number" && (status === 408 || status === 429 || status >= 500);
}

export function verifactuWaitSeconds(result: VerifactuSubmitResult | null): number | null {
	const value = (result?.response as { waitSeconds?: unknown } | undefined)?.waitSeconds;
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}