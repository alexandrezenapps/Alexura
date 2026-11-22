import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'frontend', 'src'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: path.resolve(__dirname, 'vendor'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/react/mount.tsx'),
      name: 'AlexuraReactStudio',
      formats: ['iife'],
      fileName: () => 'studio-react.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'studio-react.css';
          }
          return 'studio-[name][extname]';
        },
      },
    },
  },
});
