import { describe, expect, it } from "vitest";
import { buildQrDataUrl, buildQrUrl } from "./qr";

const params = {
  nif: "B12345678",
  invoiceNumber: "FAC-2025-001",
  issueDate: new Date(Date.UTC(2025, 0, 5)),
  total: 1210,
};

const APP_URL = "https://app.test";

describe("buildQrUrl", () => {
  it("points to the local /p/verify route in mock mode", () => {
    const url = buildQrUrl(params, { environment: "mock", appUrl: APP_URL });
    expect(url.startsWith(`${APP_URL}/p/verify?`)).toBe(true);
  });

  it("encodes the AEAT cotejo query params", () => {
    const url = new URL(buildQrUrl(params, { environment: "mock", appUrl: APP_URL }));
    expect(url.searchParams.get("nif")).toBe(params.nif);
    expect(url.searchParams.get("numserie")).toBe(params.invoiceNumber);
    expect(url.searchParams.get("fecha")).toBe("05-01-2025");
    expect(url.searchParams.get("importe")).toBe("1210.00");
  });

  it("uses the AEAT test endpoint in test mode", () => {
    expect(buildQrUrl(params, { environment: "test", appUrl: APP_URL })).toContain("aeat.es");
  });

  it("uses the AEAT prod endpoint in prod mode", () => {
    expect(buildQrUrl(params, { environment: "prod", appUrl: APP_URL })).toContain(
      "agenciatributaria.gob.es",
    );
  });
});

describe("buildQrDataUrl", () => {
  it("renders a base64 PNG data URL", async () => {
    const dataUrl = await buildQrDataUrl("https://example.com/verify?x=1");
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});
