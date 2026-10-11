import type { APIRoute } from 'astro';

// Keep the WordPress subscription URL while serving the current CMS feed.
export const prerender = false;

export const GET: APIRoute = ({ redirect }) => redirect('/feed.xml', 301);
