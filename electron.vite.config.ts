import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: { build: { license: { fileName: 'THIRD_PARTY_LICENSES.md' } } },
  preload: { build: { license: { fileName: 'THIRD_PARTY_LICENSES.md' } } },
  renderer: {
    build: { license: { fileName: 'THIRD_PARTY_LICENSES.md' } },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
