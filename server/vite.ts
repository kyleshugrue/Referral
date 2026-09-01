import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer, createLogger } from "vite";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { type Server } from "http";
import viteConfig from "../vite.config";
import { isSpaRoute, isNoIndexRoute } from "./lib/spa-routes";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const isReplitPreview = Boolean(
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_CLUSTER ||
    process.env.REPL_ID ||
    process.env.REPLIT_PREVIEW === "true" ||
    (process.env.NODE_ENV === "development" && process.env.PORT === "3001"),
  );
  const isCi = process.env.CI === "true";
  const resolvedViteConfig =
    typeof viteConfig === "function"
      ? await viteConfig({ command: "serve", mode: "development" })
      : viteConfig;
  const serverOptions = {
    middlewareMode: true,
    // Replit's preview proxy does not accept this server's HMR upgrade. Keep
    // local development hot reload, but avoid a persistent browser console
    // error in the proxied preview. Production never uses Vite.
    hmr: isReplitPreview || isCi ? false : { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...resolvedViteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    // Strip query string for route matching
    const urlPath = url.split("?")[0];

    // Skip API and WebSocket routes so they reach the handlers registered
    // after setupVite() (e.g. /api/health) instead of being swallowed by
    // this SPA fallback. Mirrors the same guard in serveStaticFiles()
    // (production static-file serving path) below.
    if (urlPath.startsWith("/api") || urlPath.startsWith("/ws")) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "..",
        "client",
        "index.html",
      );

      // Always reload index.html from disk in case it changes.
      const template = await fs.promises.readFile(clientTemplate, "utf-8");
      let page = await vite.transformIndexHtml(url, template);
      if (isReplitPreview || isCi) {
        page = page.replace(
          /<script type="module" src="\/@vite\/client"><\/script>\s*/g,
          "",
        );
      }

      // Return 404 for unrecognised paths so crawlers classify them correctly.
      // Known SPA routes still receive 200.
      const statusCode = isSpaRoute(urlPath) ? 200 : 404;

      // Inject noindex directives for auth/utility routes so search engines
      // never index thin utility pages (login, register, password-reset, etc.).
      let finalPage = page;
      const headers: Record<string, string> = {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
      };
      if (isNoIndexRoute(urlPath)) {
        headers["X-Robots-Tag"] = "noindex, nofollow";
        finalPage = finalPage.replace(
          "</head>",
          '  <meta name="robots" content="noindex,nofollow" />\n  </head>',
        );
      }

      res.status(statusCode).set(headers).end(finalPage);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
