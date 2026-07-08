import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
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
