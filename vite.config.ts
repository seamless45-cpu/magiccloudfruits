import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * `dev.html` is the development entry (it loads /src/main.tsx). The repository root
 * `index.html` is the *built* single-file game, because GitHub Pages serves the branch
 * root and a browser cannot execute TypeScript. In dev, "/" forwards to the live entry.
 */
const devEntry = path.resolve(__dirname, "dev.html");

const devIndexRedirect = (): Plugin => ({
  name: "dev-index-redirect",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || "").split("?")[0];
      if (url === "/" || url === "/index.html") {
        res.writeHead(302, { Location: "/dev.html" });
        res.end();
        return;
      }
      next();
    });
  },
});

export default defineConfig({
  // The build is published both at the repo root and below /docs, so PWA assets use relative URLs.
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile(), devIndexRedirect()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: { input: devEntry },
  },
  // Allow the app to be served from any host (e.g. the sandbox/preview domain)
  server: {
    host: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
