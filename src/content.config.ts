import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { parseContentDate } from './lib/dates.mjs';

const contentDate = z.union([z.string(), z.date()]).transform((value, context) => {
  try {
    return parseContentDate(value);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid content date',
    });
    return z.NEVER;
  }
});

const topics = defineCollection({
  loader: glob({
    base: './src/content/topics',
    pattern: '**/*.{yaml,yml}',
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    inNav: z.boolean().default(false),
    navOrder: z.number().int().default(0),
  }),
});

const posts = defineCollection({
  loader: glob({
    base: './src/content/posts',
    pattern: '**/*.{md,mdoc}',
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishedAt: contentDate,
      updatedAt: contentDate.optional(),
      draft: z.boolean().default(false),
      topic: reference('topics').optional(),
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

export const collections = { posts, topics };
