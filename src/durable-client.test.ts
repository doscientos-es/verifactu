import { describe, expect, it } from "vitest";
import { deliverDurableVerifactuRecord } from "./durable-client";
import { parseDurableAltaPayload } from "./durable";
import { computeInvoiceHash } from "./hash";
import type { VerifactuConfig } from "./types";

const config: VerifactuConfig = {
  environment: "mock",
  appUrl: "https://example.test",
  certificate: { p12Base64: "", password: "" },
  software: {
    producerName: "Doscientos",
    producerNif: "B12345678",
    name: "Test SIF",
    id: "D1",
    version: "1.0.0",
    installationNumber: "00000001",
    onlyVerifactu: true,
    multipleTaxpayers: false,
  },
};

describe("deliverDurableVerifactuRecord", () => {
  it("verifies and dispatches a durable Alta with one call", async () => {
    const payload = {
      nif: "B12345678",
      invoiceNumber: "2026-000001",
      invoiceType: "F1",
      issueDate: "2026-08-23",
      taxAmount: 21,
      total: 121,
      previousHash: null,
      generatedAt: "2026-08-23T10:00:00.000Z",
      emisorName: "Doscientos SL",
      clientNif: "12345678Z",
      clientName: "Cliente SL",
      descriptionOperacion: "Servicios",
      vatLines: [{ rate: 21, base: 100, tax: 21 }],
      previousInvoiceNumber: null,
      previousIssueDate: null,
      software: config.software,
    };
    const currentHash = computeInvoiceHash(parseDurableAltaPayload(payload));

    await expect(
      deliverDurableVerifactuRecord({ recordType: "alta", currentHash, payload }, config),
    ).resolves.toMatchObject({ status: "accepted", hash: currentHash });
  });
});