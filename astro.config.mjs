// @ts-check
import { defineConfig } from 'astro/config';
import { env } from 'node:process';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import markdoc from '@astrojs/markdoc';
import keystatic from '@keystatic/astro';

import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://demaree.me',
  devToolbar: {
    enabled: false,
  },

  vite: {
    plugins: [tailwindcss()]
  },

  // Local storage writes repository files and is only useful in development.
  integrations: [react(), markdoc(), ...(env.NODE_ENV === 'development' ? [keystatic()] : [])],
  adapter: cloudflare(),
  // This site does not use sessions; avoid provisioning a Cloudflare KV namespace.
  session: false,
});
