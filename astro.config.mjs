// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import markdoc from '@astrojs/markdoc';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [markdoc()],
  adapter: vercel(),


  fonts: [{
    provider: fontProviders.local(),
    name: "die-grotesk-vf",
    cssVariable: "--font-die-grotesk-vf",
    options: {
      variants: [
        {
          src: ['./src/assets/fonts/die-grotesk-vf-roman.woff2'],
          weight: '100 900',
          style: 'normal'
        },
        {
          src: ['./src/assets/fonts/die-grotesk-vf-italic.woff2'],
          weight: '100 900',
          style: 'italic'
        }
      ]
    }
  }, {
    provider: fontProviders.local(),
    name: "gorton-perfected-vf",
    cssVariable: "--font-gorton-perfected-vf",
    options: {
      variants: [
        {
          src: ['./src/assets/fonts/GortonPerfectedVF.woff2'],
          weight: '100 900',
          style: 'normal'
        }
      ]
    }
  }, {
    provider: fontProviders.local(),
    name: "berkeley-mono-vf",
    cssVariable: "--font-berkeley-mono-vf",
    options: {
      variants: [
        {
          src: ['./src/assets/fonts/Berkeley Mono Variable.woff2'],
          weight: '100 900',
          style: 'normal'
        }
      ]
    }
  }]
});
