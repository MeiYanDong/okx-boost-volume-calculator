import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "server/cronJob.ts",
    outDir: ".server",
    emptyOutDir: true,
    target: "node20",
    rollupOptions: {
      output: {
        entryFileNames: "cronJob.mjs",
      },
    },
  },
});
