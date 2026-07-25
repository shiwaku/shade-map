import { defineConfig } from 'vite'

// GitHub Pages (/docs 公開) 想定: base 相対・出力先 docs
export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
    target: 'es2020',
    emptyOutDir: true,
  },
})
