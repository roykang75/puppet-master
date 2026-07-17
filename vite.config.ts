import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  // assetsInlineLimit 0: 파일 아이콘 svg 1,250개가 JS에 data URI로 인라인되면 번들이 ~4MB 커진다 — 개별 파일로 유지
  build: { outDir: '../../dist/renderer', emptyOutDir: true, assetsInlineLimit: 0 },
});
