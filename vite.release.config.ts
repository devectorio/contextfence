import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((module) => `node:${module}`),
];
const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    target: "node22",
    outDir: "dist/package",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: {
        index: resolve(projectRoot, "src/public.ts"),
        cli: resolve(projectRoot, "src/cli/bin.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["yaml", ...nodeBuiltins],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
