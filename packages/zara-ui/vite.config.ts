import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { resolve } from "path"

export default defineConfig({
  base: process.env.KILO_ASSISTANT_UI_BASE ?? "/",
  plugins: [solid()],
  resolve: {
    alias: {
      "~": resolve(__dirname, "src"),
    },
    conditions: ["browser", "solid", "module", "import"],
    dedupe: ["solid-js", "solid-js/web", "solid-js/store", "@pierre/diffs"],
  },
  build: {
    target: "esnext",
    outDir: "dist",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
})
