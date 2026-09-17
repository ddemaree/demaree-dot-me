// @ts-check
import { defineConfig } from 'astro/config';
import { env } from 'node:process';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import markdoc from '@astrojs/markdoc';
import vercel from '@astrojs/vercel';
import keystatic from '@keystatic/astro';

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
  adapter: vercel(),
});
