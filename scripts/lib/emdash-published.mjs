import { EmDashClient } from 'emdash/client';
import {
  emdashOrigin,
  loadOAuthCredential,
  refreshOAuthCredential,
  validBearerToken,
} from './emdash-auth.mjs';

/** Read only the live rows of published posts, following every CMS cursor. */
export async function readPublishedEmDashPosts() {
  const origin = emdashOrigin(process.env.EMDASH_SITE_URL || 'https://demaree.me');
  const suppliedToken = process.env.EMDASH_API_TOKEN || process.env.EMDASH_TOKEN;
  if (suppliedToken && !validBearerToken(suppliedToken)) {
    throw new Error('The EmDash token environment variable is invalid; its contents were not printed.');
  }

  let credential = suppliedToken ? null : await loadOAuthCredential(origin);
  if (!suppliedToken && !credential) {
    throw new Error(`No EmDash read credential for ${origin}. Set EMDASH_API_TOKEN or log in with pnpm login:emdash --url ${origin}.`);
  }
  if (credential?.expiresAt && Date.parse(credential.expiresAt) <= Date.now() + 30_000) {
    credential = await refreshOAuthCredential(origin, credential);
  }

  async function readAll() {
    const token = suppliedToken || credential.accessToken;
    let customHeaders;
    try { customHeaders = new Headers(credential?.customHeaders ?? {}); }
    catch { throw new Error('Stored EmDash request headers are invalid; their contents were not printed.'); }
    const client = new EmDashClient({
      baseUrl: origin,
      token,
      interceptors: [async (request, next) => {
        const headers = new Headers(request.headers);
        customHeaders.forEach((value, key) => headers.set(key, value));
        headers.set('Authorization', `Bearer ${token}`);
        return next(new Request(request, {
          headers, redirect: 'manual', signal: AbortSignal.timeout(60_000),
        }));
      }],
    });
    const posts = [];
    for await (const post of client.listAll('posts', {
      status: 'published', limit: 100, orderBy: 'publishedAt', order: 'desc',
    })) {
      if (post.status === 'published') posts.push(post);
    }
    return posts;
  }

  try {
    return await readAll();
  } catch (error) {
    // Retry an expired stored OAuth credential once without creating a grant.
    if (error.status !== 401 || !credential?.refreshToken) throw error;
    credential = await refreshOAuthCredential(origin, credential);
    return readAll();
  }
}
