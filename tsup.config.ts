import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    errors: "src/aeat-errors.ts",
    durable: "src/durable.ts",
    nif: "src/nif-validation.ts",
  },
  format: ["esm", "cjs"],
  target: "node20",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  shims: true,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
