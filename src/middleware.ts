import { defineMiddleware } from 'astro:middleware';

// Keep WordPress feed subscriptions working on the Cloudflare deployment.
export const onRequest = defineMiddleware(({ url, redirect }, next) => {
  if (url.pathname === '/' && ['rss2', 'rss', 'atom'].includes(url.searchParams.get('feed') ?? '')) {
    return redirect('/feed/', 301);
  }
  return next();
});
