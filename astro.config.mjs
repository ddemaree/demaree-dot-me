// @ts-check
import { defineConfig } from 'astro/config';
import { env } from 'node:process';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import markdoc from '@astrojs/markdoc';
import keystatic from '@keystatic/astro';
import cloudflare from '@astrojs/cloudflare';
import emdash from 'emdash/astro';
import { d1, r2 } from '@emdash-cms/cloudflare';

export default defineConfig({
  site: 'https://demaree.me',
  output: 'server',
  devToolbar: { enabled: false },
  vite: { plugins: [tailwindcss()] },
  // Public blog content and navigation read published EmDash data at request time.
  integrations: [
    react(),
    markdoc(),
    ...(env.NODE_ENV === 'development' ? [keystatic()] : []),
    emdash({
      database: d1({ binding: 'DB', session: 'disabled' }),
      storage: r2({ binding: 'MEDIA' }),
    }),
  ],
  // Local D1, R2, and session data stay in this worktree during development.
  adapter: cloudflare({ remoteBindings: false }),
});
