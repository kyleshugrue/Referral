import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export default defineConfig(async ({ command }) => {
  const isProductionBuild = command === "build";
  const enableRuntimeErrorOverlay =
    !isProductionBuild && process.env.RUNTIME_ERROR_OVERLAY === "true";

  return {
    plugins: [
      react(),
      ...(enableRuntimeErrorOverlay ? [runtimeErrorOverlay()] : []),
      // This plugin injects an inline <style> tag into index.html. Keep it in
      // the development preview, but production HTML must satisfy the strict
      // style-src 'self' CSP.
      ...(!isProductionBuild ? [themePlugin()] : []),
      ...(!isProductionBuild &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@shared": path.resolve(__dirname, "shared"),
      },
    },
    root: path.resolve(__dirname, "client"),
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
    },
  };
});
