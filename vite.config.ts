import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  envPrefix: "PUBLIC_",
  plugins: [react()],
});
