import type { APIRoute } from 'astro';
import { renderSocialImage } from '../../lib/render-social-image';

export const prerender = true;

export const GET: APIRoute = async () => new Response(await renderSocialImage(), {
  headers: { 'Content-Type': 'image/png' },
});
