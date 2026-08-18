import { describe, expect, it } from "vitest";
import {
  buildVerifactuCancellationXml,
  buildVerifactuXml,
  cancelInVerifactu,
  submitToVerifactu,
} from "./client";
import { createVerifactuClient } from "./index";
import type { VerifactuConfig, VerifactuSoftware } from "./types";
import { validateVerifactuXml } from "./validate";

const mockSoftware: VerifactuSoftware = {
  producerName: "Test Company S.L.",
  producerNif: "B12345678",
  name: "TestApp",
  id: "D1",
  version: "1.0.0",
  installationNumber: "00000001",
  onlyVerifactu: true,
  multipleTaxpayers: false,
};

const mockConfig: VerifactuConfig = {
  environment: "mock",
  certificate: { p12Base64: "", password: "" },
  software: mockSoftware,
  appUrl: "https://app.test",
};

describe("verifactu/client", () => {
  const baseInput = {
    nif: "B12345678",
    invoiceNumber: "A-000001",
    invoiceType: "F1",
    issueDate: new Date("2026-03-15T00:00:00.000Z"),
    taxAmount: 21,
    total: 121,
    previousHash: null,
    generatedAt: new Date("2026-03-15T12:00:00.000Z"),
    emisorName: "Test Company S.L.",
    clientNif: "12345678A",
    clientName: "Test Client",
    descriptionOperacion: "Servicios de prueba",
    vatLines: [{ rate: 21, base: 100, tax: 21 }],
    previousInvoiceNumber: null,
    previousIssueDate: null,
  };

  it("buildVerifactuXml includes all mandatory fiscal fields", () => {
    const xml = buildVerifactuXml(baseInput, "deadbeef", mockSoftware);
    expect(xml).toContain("<sf:IDVersion>1.0</sf:IDVersion>");
    expect(xml).toContain("<sf:NIF>B12345678</sf:NIF>");
    expect(xml).toContain(
      "<sf:NombreRazonEmisor>Test Company S.L.</sf:NombreRazonEmisor>",
    );
    expect(xml).toContain("<sf:NumSerieFactura>A-000001</sf:NumSerieFactura>");
    expect(xml).toContain(
      "<sf:FechaExpedicionFactura>15-03-2026</sf:FechaExpedicionFactura>",
    );
    expect(xml).toContain("<sf:TipoFactura>F1</sf:TipoFactura>");
    expect(xml).toContain(
      "<sf:DescripcionOperacion>Servicios de prueba</sf:DescripcionOperacion>",
    );
    expect(xml).toContain("<sf:NIF>12345678A</sf:NIF>"); // Destinatarios
    expect(xml).toContain("<sf:TipoImpositivo>21.00</sf:TipoImpositivo>");
    expect(xml).toContain("<sf:CuotaTotal>21.00</sf:CuotaTotal>");
    expect(xml).toContain("<sf:ImporteTotal>121.00</sf:ImporteTotal>");
    expect(xml).toContain("<sf:PrimerRegistro>S</sf:PrimerRegistro>");
    expect(xml).toContain("<sf:TipoHuella>01</sf:TipoHuella>");
    expect(xml).toContain("<sf:Huella>deadbeef</sf:Huella>");
    expect(xml).toContain(
      "<sf:IdSistemaInformatico>D1</sf:IdSistemaInformatico>",
    );
  });

  it("buildVerifactuXml preserves the canonical critical element order", () => {
    const xml = buildVerifactuXml(baseInput, "GOLDENHASH", mockSoftware);
    expect(xml.indexOf("<sf:IDVersion>")).toBeLessThan(xml.indexOf("<sf:IDFactura>"));
    expect(xml.indexOf("<sf:IDFactura>")).toBeLessThan(xml.indexOf("<sf:Desglose>"));
    expect(xml.indexOf("<sf:Desglose>")).toBeLessThan(xml.indexOf("<sf:Encadenamiento>"));
    expect(xml.indexOf("<sf:Encadenamiento>")).toBeLessThan(xml.indexOf("<sf:SistemaInformatico>"));
    expect(xml).toContain("<sf:FechaHoraHusoGenRegistro>2026-03-15T13:00:00+01:00</sf:FechaHoraHusoGenRegistro>");
    expect(xml).toContain("<sf:Huella>GOLDENHASH</sf:Huella>");
  });

  it("buildVerifactuXml chains via RegistroAnterior when previousHash + prev invoice ID are set", () => {
    const xml = buildVerifactuXml(
      {
        ...baseInput,
        previousHash: "abc123",
        previousInvoiceNumber: "A-000001",
        previousIssueDate: new Date("2026-01-15T00:00:00.000Z"),
      },
      "newhash",
      mockSoftware,
    );
    expect(xml).toContain("<sf:RegistroAnterior>");
    expect(xml).toContain("<sf:IDEmisorFactura>B12345678</sf:IDEmisorFactura>");
    expect(xml).toContain("<sf:NumSerieFactura>A-000001</sf:NumSerieFactura>");
    expect(xml).toContain(
      "<sf:FechaExpedicionFactura>15-01-2026</sf:FechaExpedicionFactura>",
    );
    expect(xml).toContain("<sf:Huella>abc123</sf:Huella>");
    expect(xml).not.toContain("PrimerRegistro");
    expect(xml).not.toContain("FacturaAnterior>");
  });

  it("buildVerifactuXml falls back to PrimerRegistro when previousInvoiceNumber is missing", () => {
    // previousHash set but previousInvoiceNumber not → treated as first invoice
    const xml = buildVerifactuXml(
      { ...baseInput, previousHash: "abc123" },
      "newhash",
      mockSoftware,
    );
    expect(xml).toContain("<sf:PrimerRegistro>S</sf:PrimerRegistro>");
  });

  it("uses the SIF producer identity instead of the invoice issuer", () => {
    const xml = buildVerifactuXml(baseInput, "HASH", {
      ...mockSoftware,
      producerName: "Software Producer S.L.",
      producerNif: "B99999999",
    });
    expect(xml).toContain("<sf:NombreRazon>Software Producer S.L.</sf:NombreRazon>");
    expect(xml).toContain("<sf:NIF>B99999999</sf:NIF>");
  });

  it("sets Incidencia only for an incident retry", () => {
    const xml = buildVerifactuXml({ ...baseInput, incidence: true }, "HASH", mockSoftware);
    expect(xml).toContain("<sf:Incidencia>S</sf:Incidencia>");
  });

  it("buildVerifactuCancellationXml identifies and chains an annulled invoice", () => {
    const xml = buildVerifactuCancellationXml(
      {
        nif: "B12345678",
        cancelledInvoiceNumber: "A-000001",
        cancelledInvoiceIssueDate: new Date("2026-03-15T00:00:00.000Z"),
        previousHash: "abc123",
        generatedAt: new Date("2026-03-16T12:00:00.000Z"),
        emisorName: "Test Company S.L.",
        previousInvoiceNumber: "A-000001",
        previousIssueDate: new Date("2026-03-15T00:00:00.000Z"),
      },
      "ANNULMENTHASH",
      mockSoftware,
    );
    expect(xml).toContain("<sf:RegistroAnulacion>");
    expect(xml).toContain("<sf:IDEmisorFacturaAnulada>B12345678</sf:IDEmisorFacturaAnulada>");
    expect(xml).toContain("<sf:NumSerieFacturaAnulada>A-000001</sf:NumSerieFacturaAnulada>");
    expect(xml).toContain("<sf:SinRegistroPrevio>N</sf:SinRegistroPrevio>");
    expect(xml).toContain("<sf:RechazoPrevio>N</sf:RechazoPrevio>");
    expect(xml).toContain("<sf:RegistroAnterior>");
    expect(xml).toContain("<sf:Huella>ANNULMENTHASH</sf:Huella>");
    expect(validateVerifactuXml(xml)).toEqual({ valid: true });
  });

  it("submitToVerifactu in mock mode returns accepted with deterministic CSV", async () => {
    const result = await submitToVerifactu(baseInput, mockConfig);
    expect(result.status).toBe("accepted");
    expect(result.hash).toMatch(/^[A-F0-9]{64}$/);
    expect(result.csv).toBe(result.hash.slice(0, 16).toUpperCase());
    expect(result.idfact).toBe("B12345678-A-000001-20260315");
    expect(result.errorMessage).toBeNull();
    expect(result.errorCode).toBeNull();
    expect(result.aeatCode).toBeNull();
    expect(result.response).toMatchObject({ mock: true });
  });

  it("fails closed for an unsupported rectificative type", async () => {
    const result = await submitToVerifactu({ ...baseInput, invoiceType: "R1" }, mockConfig);
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("configuration_invalid");
  });

  it("cancelInVerifactu in mock mode returns an accepted RegistroAnulacion", async () => {
    const result = await cancelInVerifactu(
      {
        nif: "B12345678",
        cancelledInvoiceNumber: "A-000001",
        cancelledInvoiceIssueDate: new Date("2026-03-15T00:00:00.000Z"),
        previousHash: null,
        generatedAt: new Date("2026-03-16T12:00:00.000Z"),
        emisorName: "Test Company S.L.",
        previousInvoiceNumber: null,
        previousIssueDate: null,
      },
      mockConfig,
    );
    expect(result.status).toBe("accepted");
    expect(result.hash).toMatch(/^[A-F0-9]{64}$/);
    expect(result.idfact).toBe("B12345678-A-000001-20260315");
  });

  it("submitToVerifactu returns error when cert is missing in test mode", async () => {
    const result = await submitToVerifactu(baseInput, {
      ...mockConfig,
      environment: "test",
    });
    expect(result.status).toBe("error");
    expect(result.csv).toBeNull();
    expect(result.errorCode).toBe("cert_missing");
    expect(result.errorMessage).toMatch(/certificado|certificate/i);
  });

  it("reports malformed certificate Base64 before attempting TLS", async () => {
    const result = await submitToVerifactu(baseInput, {
      ...mockConfig,
      environment: "test",
      certificate: { p12Base64: "data:application/x-pkcs12;base64,AAAA", password: "x" },
    });
    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("cert_invalid");
    expect(result.errorMessage).toMatch(/data URL|Base64/i);
  });

  it("computes the same hash twice for the same payload (determinism)", async () => {
    const a = await submitToVerifactu(baseInput, mockConfig);
    const b = await submitToVerifactu(baseInput, mockConfig);
    expect(a.hash).toBe(b.hash);
  });

  it("generated XML passes the well-formedness gate", () => {
    const xml = buildVerifactuXml(baseInput, "deadbeef", mockSoftware);
    expect(validateVerifactuXml(xml)).toEqual({ valid: true });
  });

  it("validateVerifactuXml flags malformed XML with a message", () => {
    const result = validateVerifactuXml("<sum:Foo><sum:Bar></sum:Foo>");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toBeTruthy();
  });
});

describe("verifactu/facade", () => {
  const baseInput = {
    nif: "B12345678",
    invoiceNumber: "A-000001",
    invoiceType: "F1",
    issueDate: new Date("2026-03-15T00:00:00.000Z"),
    taxAmount: 21,
    total: 121,
    previousHash: null,
    generatedAt: new Date("2026-03-15T12:00:00.000Z"),
    emisorName: "Test Company S.L.",
    clientNif: "12345678A",
    clientName: "Test Client",
    descriptionOperacion: "Servicios de prueba",
    vatLines: [{ rate: 21, base: 100, tax: 21 }],
    previousInvoiceNumber: null,
    previousIssueDate: null,
  };

  it("registerInvoice delegates to submitToVerifactu with the bound config", async () => {
    const client = createVerifactuClient(mockConfig);
    const viaFacade = await client.registerInvoice(baseInput);
    const viaFn = await submitToVerifactu(baseInput, mockConfig);
    expect(viaFacade.status).toBe("accepted");
    expect(viaFacade.hash).toBe(viaFn.hash);
    expect(viaFacade.idfact).toBe(viaFn.idfact);
  });

  it("cancelInvoice delegates to RegistroAnulacion submission", async () => {
    const client = createVerifactuClient(mockConfig);
    const result = await client.cancelInvoice({
      nif: "B12345678",
      cancelledInvoiceNumber: "A-000001",
      cancelledInvoiceIssueDate: new Date("2026-03-15T00:00:00.000Z"),
      previousHash: null,
      generatedAt: new Date("2026-03-16T12:00:00.000Z"),
      emisorName: "Test Company S.L.",
      previousInvoiceNumber: null,
      previousIssueDate: null,
    });
    expect(result.status).toBe("accepted");
  });

  it("buildQrUrl uses the bound config's environment/appUrl", () => {
    const client = createVerifactuClient(mockConfig);
    const url = client.buildQrUrl({
      nif: "B12345678",
      invoiceNumber: "A-000001",
      issueDate: new Date("2026-03-15T00:00:00.000Z"),
      total: 121,
    });
    expect(url.startsWith("https://app.test/p/verify?")).toBe(true);
    expect(url).toContain("nif=B12345678");
    expect(url).toContain("importe=121.00");
  });

  it("buildQrDataUrl returns a PNG data URL for the bound config", async () => {
    const client = createVerifactuClient(mockConfig);
    const dataUrl = await client.buildQrDataUrl({
      nif: "B12345678",
      invoiceNumber: "A-000001",
      issueDate: new Date("2026-03-15T00:00:00.000Z"),
      total: 121,
    });
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});
