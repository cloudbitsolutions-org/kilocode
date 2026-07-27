import { defineConfig } from "vite"
export default defineConfig({
  esbuild: {
    logOverride: {
      'unsupported-jsx-comment': 'silent'
    }
  }
})
