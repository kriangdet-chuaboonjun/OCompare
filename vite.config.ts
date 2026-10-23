import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  define: { __APP_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true, target: 'es2022' }
})
