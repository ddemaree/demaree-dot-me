/** Shared record identities for the publisher and page verification links. */
const PUBLICATION_NSID = 'site.standard.publication';
const DOCUMENT_NSID = 'site.standard.document';
const RECORD_KEY = /^[A-Za-z0-9._:~-]{1,512}$/;

/**
 * Deterministic record key for a post slug. Slashes are not valid AT record keys.
 * @param {string} slug
 */
export function documentRkey(slug) {
  const key = `posts-${slug}`;
  if (!slug || !RECORD_KEY.test(key)) {
    throw new Error(`Post slug cannot form a valid AT record key: ${slug}`);
  }
  return key;
}

/** @param {string} did */
export function publicationUri(did) {
  return `at://${did}/${PUBLICATION_NSID}/main`;
}

/**
 * @param {string} did
 * @param {string} slug
 */
export function documentUri(did, slug) {
  return `at://${did}/${DOCUMENT_NSID}/${documentRkey(slug)}`;
}

/**
 * Parse a record AT-URI into its three components, rejecting extra path segments.
 * @param {string} uri
 */
export function parseAtUri(uri) {
  const match = uri.match(/^at:\/\/(did:[^/?#]+)\/([^/?#]+)\/([A-Za-z0-9._:~-]{1,512})$/);
  if (!match || match[3] === '.' || match[3] === '..') return null;
  return { did: match[1], nsid: match[2], rkey: match[3] };
}
