import type { APIRoute } from 'astro';
import { emdashPostSlug } from '../../../lib/emdash-post';
import { renderSocialImage } from '../../../lib/render-social-image';
import { isProductionSite } from '../../../lib/site-origin';
import { getPublishedPost } from '../../../lib/taxonomy';

export const prerender = false;

export const GET: APIRoute = async ({ params, url }) => {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (!isProductionSite(url)) headers.set('X-Robots-Tag', 'noindex');

  try {
    const slug = emdashPostSlug(params.slug);
    const post = slug ? await getPublishedPost(slug) : undefined;
    if (!post) {
      return new Response('Post not found.', { status: 404, headers });
    }

    const png = await renderSocialImage(post.data.title);
    headers.set('Content-Type', 'image/png');
    return new Response(png, { headers });
  } catch (error) {
    console.error('[Open Graph] Failed to generate post image:', error);
    return new Response('Post image is temporarily unavailable.', { status: 503, headers });
  }
};
