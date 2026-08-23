import { describe, expect, it } from "vitest";
import { extractAeatErrorCode, getAeatErrorMetadata } from "./aeat-errors";

describe("AEAT VERI*FACTU error metadata", () => {
	it.each([
		["4102", "full_submission_rejected"],
		["3501", "full_submission_rejected"],
		["1100", "record_rejected"],
		["3000", "record_rejected"],
		["2001", "accepted_with_errors"],
	] as const)("classifies official code %s", (code, effect) => {
		expect(getAeatErrorMetadata(code)?.effect).toBe(effect);
	});

	it("extracts only known AEAT codes from persisted details", () => {
		expect(extractAeatErrorCode("AEAT 4102: El XML no cumple el esquema")).toBe("4102");
		expect(extractAeatErrorCode("AEAT HTTP 500: fecha no permitida en 2024")).toBeNull();
	});

	it("falls back to an error code embedded in the detail", () => {
		expect(getAeatErrorMetadata(null, "Código: 2005. Importe incorrecto")).toMatchObject({
			code: "2005",
			effect: "accepted_with_errors",
		});
	});
});