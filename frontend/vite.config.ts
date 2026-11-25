import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En développement (npm run dev), l'API est celle de la stack Docker.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': apiTarget,
      '/uploads': apiTarget,
    },
  },
});
