import { readFile } from "node:fs/promises";

const entry = new URL("../dist/index.js", import.meta.url);
const source = await readFile(entry, "utf8");

if (
  source.includes('from "@richhouse83/xsd-validator"') ||
  source.includes("from '@richhouse83/xsd-validator'")
) {
  throw new Error("El validador XSD nativo no puede importarse al cargar el paquete.");
}

await import(entry.href);
console.log("La entrada de @doscientos/verifactu no carga el validador XSD nativo.");