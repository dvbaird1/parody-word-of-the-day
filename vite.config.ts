import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({command, mode}) => ({
  plugins: [react(), cloudflare({auxiliaryWorkers: [{configPath: 'wrangler.unsubscribe.jsonc', devOnly: true}]})],
  define: { __LOCAL_DEV_BUILD__: JSON.stringify(command === 'serve' && mode === 'development') },
}));
