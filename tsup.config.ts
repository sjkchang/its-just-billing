import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/client.ts",
		"src/repositories/drizzle/index.ts",
		"src/providers/stripe/index.ts",
		"src/handler/hono.ts",
	],
	format: "esm",
	dts: true,
	splitting: true,
	clean: true,
	external: ["stripe", "drizzle-orm", "nanoid", "zod"],
});
