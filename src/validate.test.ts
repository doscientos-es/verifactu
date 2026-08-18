import { describe, expect, it } from "vitest";
import { validateVerifactuCancellation, validateVerifactuSubmission } from "./validate";
import type { VerifactuCancellationInput, VerifactuSubmitInput } from "./client";
import type { VerifactuSoftware } from "./types";

const software: VerifactuSoftware = {
  producerName: "Test Company S.L.",
  producerNif: "B12345678",
  name: "TestApp",
  id: "D1",
  version: "1.0.0",
  installationNumber: "1",
  onlyVerifactu: true,
  multipleTaxpayers: false,
};

const submission = {
  nif: "B12345678",
  invoiceNumber: "A-1",
  invoiceType: "F1",
  issueDate: new Date("2026-03-15T00:00:00Z"),
  taxAmount: 21,
  total: 121,
  previousHash: null,
  generatedAt: new Date("2026-03-15T12:00:00Z"),
  emisorName: "Test Company S.L.",
  clientNif: "12345678A",
  clientName: "Client",
  descriptionOperacion: "Servicio",
  vatLines: [{ rate: 21, base: 100, tax: 21 }],
  previousInvoiceNumber: null,
  previousIssueDate: null,
} satisfies VerifactuSubmitInput;

const cancellation = {
  nif: "B12345678",
  cancelledInvoiceNumber: "A-1",
  cancelledInvoiceIssueDate: new Date("2026-03-15T00:00:00Z"),
  previousHash: null,
  generatedAt: new Date("2026-03-15T12:00:00Z"),
  emisorName: "Test Company S.L.",
  previousInvoiceNumber: null,
  previousIssueDate: null,
} satisfies VerifactuCancellationInput;

describe("runtime fiscal validation", () => {
  it("fails closed for malformed arrays instead of throwing", () => {
    const result = validateVerifactuSubmission(
      { ...submission, vatLines: [null] } as unknown as VerifactuSubmitInput,
      software,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects invalid correction flags and references", () => {
    expect(
      validateVerifactuSubmission(
        { ...submission, rechazoPrevio: "Y" } as unknown as VerifactuSubmitInput,
        software,
      ).valid,
    ).toBe(false);
    expect(
      validateVerifactuSubmission(
        { ...submission, rectifiedInvoices: [null] } as unknown as VerifactuSubmitInput,
        software,
      ).valid,
    ).toBe(false);
  });

  it("validates cancellation flags and external references", () => {
    expect(
      validateVerifactuCancellation(
        { ...cancellation, sinRegistroPrevio: "Y" } as unknown as VerifactuCancellationInput,
        software,
      ).valid,
    ).toBe(false);
    expect(
      validateVerifactuCancellation(
        { ...cancellation, externalReference: " " },
        software,
      ).valid,
    ).toBe(false);
  });
});
