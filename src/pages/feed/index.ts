import type { APIRoute } from 'astro';

// The WordPress subscription URL stays valid; the XML itself is built once.
export const prerender = false;

export const GET: APIRoute = ({ redirect }) => redirect('/feed.xml', 301);
