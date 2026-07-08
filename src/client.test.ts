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
			"<sf:IdSistemaInformatico>TEST01</sf:IdSistemaInformatico>",
		);
	});

	// Golden regression lock: any change to the emitted XML (element order, new
	// fields, formatting) breaks this snapshot. spanishTimestamp is pinned to
	// Europe/Madrid, so the output is deterministic across machines/timezones.
	it("buildVerifactuXml matches the golden XML snapshot", () => {
		const xml = buildVerifactuXml(baseInput, "GOLDENHASH", mockSoftware);
		expect(xml).toMatchInlineSnapshot(`
			"<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd" xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
			  <sfLR:Cabecera>
			    <sf:ObligadoEmision>
			      <sf:NombreRazon>Test Company S.L.</sf:NombreRazon>
			      <sf:NIF>B12345678</sf:NIF>
			    </sf:ObligadoEmision>
			  </sfLR:Cabecera>
			  <sfLR:RegistroFactura>
			    <sf:RegistroAlta>
			      <sf:IDVersion>1.0</sf:IDVersion>
			      <sf:IDFactura>
			        <sf:IDEmisorFactura>B12345678</sf:IDEmisorFactura>
			        <sf:NumSerieFactura>A-000001</sf:NumSerieFactura>
			        <sf:FechaExpedicionFactura>15-03-2026</sf:FechaExpedicionFactura>
			      </sf:IDFactura>
			      <sf:NombreRazonEmisor>Test Company S.L.</sf:NombreRazonEmisor>
			      <sf:TipoFactura>F1</sf:TipoFactura>
			      <sf:DescripcionOperacion>Servicios de prueba</sf:DescripcionOperacion>
			      <sf:Destinatarios>
			        <sf:IDDestinatario>
			          <sf:NombreRazon>Test Client</sf:NombreRazon>
			          <sf:NIF>12345678A</sf:NIF>
			        </sf:IDDestinatario>
			      </sf:Destinatarios>
			      <sf:Desglose>
			        <sf:DetalleDesglose>
			          <sf:ClaveRegimen>01</sf:ClaveRegimen>
			          <sf:CalificacionOperacion>S1</sf:CalificacionOperacion>
			          <sf:TipoImpositivo>21.00</sf:TipoImpositivo>
			          <sf:BaseImponibleOImporteNoSujeto>100.00</sf:BaseImponibleOImporteNoSujeto>
			          <sf:CuotaRepercutida>21.00</sf:CuotaRepercutida>
			        </sf:DetalleDesglose>
			      </sf:Desglose>
			      <sf:CuotaTotal>21.00</sf:CuotaTotal>
			      <sf:ImporteTotal>121.00</sf:ImporteTotal>
			      <sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>
			      <sf:SistemaInformatico>
			        <sf:NombreRazon>Test Company S.L.</sf:NombreRazon>
			        <sf:NIF>B12345678</sf:NIF>
			        <sf:NombreSistemaInformatico>TestApp</sf:NombreSistemaInformatico>
			        <sf:IdSistemaInformatico>TEST01</sf:IdSistemaInformatico>
			        <sf:Version>1.0.0</sf:Version>
			        <sf:NumeroInstalacion>00000001</sf:NumeroInstalacion>
			        <sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>
			        <sf:TipoUsoPosibleMultiOT>N</sf:TipoUsoPosibleMultiOT>
			        <sf:IndicadorMultiples>N</sf:IndicadorMultiples>
			      </sf:SistemaInformatico>
			      <sf:FechaHoraHusoGenRegistro>15-03-2026T13:00:00+01:00</sf:FechaHoraHusoGenRegistro>
			      <sf:TipoHuella>01</sf:TipoHuella>
			      <sf:Huella>GOLDENHASH</sf:Huella>
			    </sf:RegistroAlta>
			  </sfLR:RegistroFactura>
			</sfLR:RegFactuSistemaFacturacion>"
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
		expect(xml).toContain("<sf:RegistroAnterior>");
		expect(xml).toContain(
			"<sf:NumSerieFacturaAnterior>A-000001</sf:NumSerieFacturaAnterior>",
		);
		expect(xml).toContain("<sf:Huella>abc123</sf:Huella>");
		expect(xml).not.toContain("PrimerRegistro");
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
		const result = await submitToVerifactu(baseInput, {
			...mockConfig,
			environment: "test",
		});
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
