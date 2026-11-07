import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const importerSrc = fileURLToPath(new URL("../../packages/importer/src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@importer": importerSrc },
    // schema.ts lives in packages/importer; force one copy of the SDK and viem so schema objects and client agree
    dedupe: ["@arkiv-network/sdk", "viem"],
  },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
});
