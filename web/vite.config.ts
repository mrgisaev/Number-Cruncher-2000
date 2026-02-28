import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        bulkPercent: resolve(__dirname, 'bulk-percent.html'),
        whatsNew: resolve(__dirname, 'whats-new.html'),
        shareSplitter: resolve(__dirname, 'share-splitter.html'),
        creativeRenamer: resolve(__dirname, 'creative-renamer.html'),
        creativeResizer: resolve(__dirname, 'creative-resizer.html'),
        creativeEditor: resolve(__dirname, 'creative-editor.html'),
        utmGenerator: resolve(__dirname, 'utm-generator.html'),
      },
    },
  },
})
