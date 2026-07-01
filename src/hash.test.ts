import { describe, expect, it } from "vitest";
import { buildHashPayload, computeInvoiceHash } from "./hash";
import { buildIdfact } from "./idfact";

const baseInput = {
  nif: "B12345678",
  invoiceNumber: "A-000001",
  invoiceType: "F1",
  issueDate: new Date(Date.UTC(2026, 4, 25)),
  taxAmount: 21.0,
  total: 121.0,
  previousHash: null,
  generatedAt: new Date(Date.UTC(2026, 4, 25, 12, 0, 0)),
} as const;

describe("verifactu hash", () => {
  it("uses '0' as previous_hash for the first invoice", () => {
    const payload = buildHashPayload(baseInput);
    expect(payload).toContain("&0&");
  });

  it("formats issue date as DD-MM-YYYY", () => {
    const payload = buildHashPayload(baseInput);
    expect(payload).toContain("25-05-2026");
  });

  it("produces a deterministic SHA-256 uppercase hex hash", () => {
    const h1 = computeInvoiceHash(baseInput);
    const h2 = computeInvoiceHash(baseInput);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[A-F0-9]{64}$/);
  });

  it("chains different hashes for different previous_hash", () => {
    const h1 = computeInvoiceHash(baseInput);
    const h2 = computeInvoiceHash({ ...baseInput, previousHash: h1 });
    expect(h1).not.toBe(h2);
  });

  it("formats amounts with 2 decimals", () => {
    const payload = buildHashPayload({ ...baseInput, taxAmount: 21, total: 121 });
    expect(payload).toContain("&21.00&");
    expect(payload).toContain("&121.00&");
  });
});

describe("idfact", () => {
  it("formats as NIF-FULLNUMBER-YYYYMMDD", () => {
    const id = buildIdfact("B12345678", "A-000001", new Date(Date.UTC(2026, 4, 25)));
    expect(id).toBe("B12345678-A-000001-20260525");
  });
});
