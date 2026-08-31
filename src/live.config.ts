import { defineLiveCollection } from 'astro:content';
import { z } from 'astro/zod';
import { bnlRssLoader } from './loaders/bnl-rss';

const bnlPosts = defineLiveCollection({
  loader: bnlRssLoader({
    feedUrl: 'https://www.bitsandletters.com/ideas/feed.xml',
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    url: z.url(),
  }),
});

export const collections = { bnlPosts };
