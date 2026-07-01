import { describe, expect, it } from "vitest";
import { buildVerifactuXml, submitToVerifactu } from "./client";
import { createVerifactuClient } from "./index";
import type { VerifactuConfig, VerifactuSoftware } from "./types";
import { validateVerifactuXml } from "./validate";

const mockSoftware: VerifactuSoftware = {
  name: "TestApp",
  id: "TEST01",
  version: "1.0.0",
  installationNumber: "00000001",
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
    expect(xml).toContain("<sum:IDVersion>1.0</sum:IDVersion>");
    expect(xml).toContain("<sum:NIF>B12345678</sum:NIF>");
    expect(xml).toContain("<sum:NombreRazonEmisor>Test Company S.L.</sum:NombreRazonEmisor>");
    expect(xml).toContain("<sum:NumSerieFactura>A-000001</sum:NumSerieFactura>");
    expect(xml).toContain("<sum:FechaExpedicionFactura>15-03-2026</sum:FechaExpedicionFactura>");
    expect(xml).toContain("<sum:TipoFactura>F1</sum:TipoFactura>");
    expect(xml).toContain(
      "<sum:DescripcionOperacion>Servicios de prueba</sum:DescripcionOperacion>",
    );
    expect(xml).toContain("<sum:NIF>12345678A</sum:NIF>"); // Destinatarios
    expect(xml).toContain("<sum:TipoImpositivo>21.00</sum:TipoImpositivo>");
    expect(xml).toContain("<sum:CuotaTotal>21.00</sum:CuotaTotal>");
    expect(xml).toContain("<sum:ImporteTotal>121.00</sum:ImporteTotal>");
    expect(xml).toContain("<sum:PrimerRegistro>S</sum:PrimerRegistro>");
    expect(xml).toContain("<sum:TipoHuella>01</sum:TipoHuella>");
    expect(xml).toContain("<sum:Huella>deadbeef</sum:Huella>");
    expect(xml).toContain("<sum:IdSistemaInformatico>TEST01</sum:IdSistemaInformatico>");
  });

  // Golden regression lock: any change to the emitted XML (element order, new
  // fields, formatting) breaks this snapshot. spanishTimestamp is pinned to
  // Europe/Madrid, so the output is deterministic across machines/timezones.
  it("buildVerifactuXml matches the golden XML snapshot", () => {
    const xml = buildVerifactuXml(baseInput, "GOLDENHASH", mockSoftware);
    expect(xml).toMatchInlineSnapshot(`
      "<sum:RegFactuSistemaFacturacion xmlns:sum="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
        <sum:Cabecera>
          <sum:ObligadoEmision>
            <sum:NombreRazon>Test Company S.L.</sum:NombreRazon>
            <sum:NIF>B12345678</sum:NIF>
          </sum:ObligadoEmision>
        </sum:Cabecera>
        <sum:RegistroFactura>
          <sum:RegistroAlta>
            <sum:IDVersion>1.0</sum:IDVersion>
            <sum:IDFactura>
              <sum:IDEmisorFactura>B12345678</sum:IDEmisorFactura>
              <sum:NumSerieFactura>A-000001</sum:NumSerieFactura>
              <sum:FechaExpedicionFactura>15-03-2026</sum:FechaExpedicionFactura>
            </sum:IDFactura>
            <sum:NombreRazonEmisor>Test Company S.L.</sum:NombreRazonEmisor>
            <sum:TipoFactura>F1</sum:TipoFactura>
            <sum:DescripcionOperacion>Servicios de prueba</sum:DescripcionOperacion>
            <sum:Destinatarios>
              <sum:IDDestinatario>
                <sum:NombreRazon>Test Client</sum:NombreRazon>
                <sum:NIF>12345678A</sum:NIF>
              </sum:IDDestinatario>
            </sum:Destinatarios>
            <sum:Desglose>
              <sum:DetalleDesglose>
                <sum:ClaveRegimen>01</sum:ClaveRegimen>
                <sum:CalificacionOperacion>S1</sum:CalificacionOperacion>
                <sum:TipoImpositivo>21.00</sum:TipoImpositivo>
                <sum:BaseImponibleOImporteNoSujeto>100.00</sum:BaseImponibleOImporteNoSujeto>
                <sum:CuotaRepercutida>21.00</sum:CuotaRepercutida>
              </sum:DetalleDesglose>
            </sum:Desglose>
            <sum:CuotaTotal>21.00</sum:CuotaTotal>
            <sum:ImporteTotal>121.00</sum:ImporteTotal>
            <sum:Encadenamiento><sum:PrimerRegistro>S</sum:PrimerRegistro></sum:Encadenamiento>
            <sum:SistemaInformatico>
              <sum:NombreRazon>Test Company S.L.</sum:NombreRazon>
              <sum:NIF>B12345678</sum:NIF>
              <sum:NombreSistemaInformatico>TestApp</sum:NombreSistemaInformatico>
              <sum:IdSistemaInformatico>TEST01</sum:IdSistemaInformatico>
              <sum:Version>1.0.0</sum:Version>
              <sum:NumeroInstalacion>00000001</sum:NumeroInstalacion>
              <sum:TipoUsoPosibleSoloVerifactu>S</sum:TipoUsoPosibleSoloVerifactu>
              <sum:TipoUsoPosibleMultiOT>N</sum:TipoUsoPosibleMultiOT>
              <sum:IndicadorMultiples>N</sum:IndicadorMultiples>
            </sum:SistemaInformatico>
            <sum:FechaHoraHusoGenRegistro>15-03-2026T13:00:00+01:00</sum:FechaHoraHusoGenRegistro>
            <sum:TipoHuella>01</sum:TipoHuella>
            <sum:Huella>GOLDENHASH</sum:Huella>
          </sum:RegistroAlta>
        </sum:RegistroFactura>
      </sum:RegFactuSistemaFacturacion>"
    `);
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
    expect(xml).toContain("<sum:RegistroAnterior>");
    expect(xml).toContain("<sum:NumSerieFacturaAnterior>A-000001</sum:NumSerieFacturaAnterior>");
    expect(xml).toContain("<sum:Huella>abc123</sum:Huella>");
    expect(xml).not.toContain("PrimerRegistro");
  });

  it("buildVerifactuXml falls back to PrimerRegistro when previousInvoiceNumber is missing", () => {
    // previousHash set but previousInvoiceNumber not → treated as first invoice
    const xml = buildVerifactuXml(
      { ...baseInput, previousHash: "abc123" },
      "newhash",
      mockSoftware,
    );
    expect(xml).toContain("<sum:PrimerRegistro>S</sum:PrimerRegistro>");
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

  it("submitToVerifactu returns error when cert is missing in test mode", async () => {
    const result = await submitToVerifactu(baseInput, { ...mockConfig, environment: "test" });
    expect(result.status).toBe("error");
    expect(result.csv).toBeNull();
    expect(result.errorCode).toBe("cert_missing");
    expect(result.errorMessage).toMatch(/certificado|certificate/i);
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
