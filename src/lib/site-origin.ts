/** Preview deployments must stay out of search indexes until domain cutover. */
export function isProductionSite(url: URL) {
  return url.hostname === 'demaree.me';
}
