import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Asset Tracker',
        short_name: 'Assets',
        theme_color: '#0B2545',
        background_color: '#F8F7F2',
        display: 'standalone',
        lang: 'ja',
        icons: [],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
