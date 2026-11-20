import { defineLiveCollection } from 'astro:content';
import { z } from 'astro/zod';
import { emdashLoader } from 'emdash/runtime';
import { bnlSanityLoader } from './loaders/bnl-sanity';

const bnlPosts = defineLiveCollection({
  loader: bnlSanityLoader({
    projectId: 'bc2mm6na',
    dataset: 'v2',
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    url: z.url(),
    image: z.url().optional(),
    imageAlt: z.string().optional(),
  }),
});

export const collections = {
  bnlPosts,
  _emdash: defineLiveCollection({ loader: emdashLoader() }),
};
