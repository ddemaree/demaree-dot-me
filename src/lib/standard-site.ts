/**
 * Helpers for standard.site AT Protocol integration.
 * @see https://standard.site
 */
const PUBLICATION_NSID = 'site.standard.publication';
const DOCUMENT_NSID = 'site.standard.document';

/**
 * Construct the AT-URI for the publication record.
 * Convention: at://{did}/{nsid}/main
 */
export function publicationUri(did: string): string {
  return `at://${did}/${PUBLICATION_NSID}/main`;
}

/**
 * Construct the AT-URI for a document record.
 * Convention: at://{did}/site.standard.document/posts/{slug}
 */
export function documentUri(did: string, slug: string): string {
  return `at://${did}/${DOCUMENT_NSID}/posts/${slug}`;
}

/**
 * Parse an AT-URI back into its components.
 * Returns null if the URI doesn't match the expected format.
 */
export function parseAtUri(uri: string): { did: string; nsid: string; rkey: string } | null {
  const match = uri.match(/^at:\/\/(did:[^/]+)(\/[^/]+)(\/.+)$/);
  if (!match) return null;
  return { did: match[1], nsid: match[2].slice(1), rkey: match[3] };
}
