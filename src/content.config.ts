import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({
    base: './src/content/posts',
    pattern: '**/*.{md,mdoc}',
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishedAt: z.coerce.date(),
      updatedAt: z.coerce.date().optional(),
      draft: z.boolean().default(false),
      tags: z.array(z.string()).default([]),
      format: z.enum(['standard', 'aside', 'link']).default('standard'),
      subtitle: z.string().optional(),
      linkUrl: z.url().optional(),
      featuredImage: image().optional(),
      featuredImageAlt: z.string().default(''),
      wordpressId: z.number().int().optional(),
      sourceUrl: z.url().optional(),
    }),
});

export const collections = { posts };
