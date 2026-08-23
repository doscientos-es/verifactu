export const AEAT_VERIFACTU_ERROR_CATALOG_URL =
	"https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties";

export type AeatErrorEffect =
	| "full_submission_rejected"
	| "record_rejected"
	| "accepted_with_errors";

export interface AeatErrorMetadata {
	code: string;
	effect: AeatErrorEffect;
	effectLabel: string;
}

const EFFECT_LABELS: Record<AeatErrorEffect, string> = {
	full_submission_rejected: "La AEAT rechaza el envío completo.",
	record_rejected:
		"La AEAT rechaza la factura (o la petición completa si el error está en la cabecera).",
	accepted_with_errors: "La AEAT acepta el registro, pero indica que debe subsanarse.",
};

function effectForCode(code: number): AeatErrorEffect | null {
	if ((code >= 4102 && code <= 4141) || (code >= 3500 && code <= 3503)) {
		return "full_submission_rejected";
	}
	if ((code >= 1100 && code <= 1293) || (code >= 3000 && code <= 3004)) {
		return "record_rejected";
	}
	if (code >= 2000 && code <= 2009) return "accepted_with_errors";
	return null;
}

function knownCode(value: string): string | null {
	if (!/^[0-9]{4}$/.test(value)) return null;
	return effectForCode(Number(value)) ? value : null;
}

export function extractAeatErrorCode(value: string | null | undefined): string | null {
	if (!value) return null;
	const contextualMatch = value.match(/(?:AEAT|c[oó]digo)\s*[:#-]?\s*([0-9]{4})\b/i)?.[1];
	if (contextualMatch) return knownCode(contextualMatch);
	for (const match of value.matchAll(/\b[0-9]{4}\b/g)) {
		const code = knownCode(match[0]);
		if (code) return code;
	}
	return null;
}

export function getAeatErrorMetadata(
	code: string | null | undefined,
	fallbackText?: string | null,
): AeatErrorMetadata | null {
	const normalizedCode = knownCode(code?.trim() ?? "") ?? extractAeatErrorCode(fallbackText);
	if (!normalizedCode) return null;
	const effect = effectForCode(Number(normalizedCode));
	if (!effect) return null;
	return { code: normalizedCode, effect, effectLabel: EFFECT_LABELS[effect] };
}