import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const apiTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000';

// While developing, /admin opens the separate admin page.
function adminRoute() {
  return {
    name: 'arcadia-admin-route',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/admin' || req.url?.startsWith('/admin?')) req.url = '/admin/index.html';
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [adminRoute()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin/index.html', import.meta.url))
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.FRONTEND_PORT || 5174),
    strictPort: true,

    allowedHosts: [
      'rule-spent-contort.ngrok-free.dev'
    ],

    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      },
      '/socket.io': {
        target: apiTarget,
        changeOrigin: true,
        ws: true
      }
    }
  }
});
