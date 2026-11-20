/**
 * Add referral attribution to public links into the Bits&Letters site.
 * @param {string} href
 * @param {string} campaign
 * @param {'referral' | 'logo'} [medium]
 */
export function withBitsAndLettersUtm(href, campaign, medium = 'referral') {
  let url;
  try {
    url = new URL(href.startsWith('//') ? `https:${href}` : href);
  } catch {
    return href;
  }

  if (!['https:', 'http:'].includes(url.protocol) ||
      !['bitsandletters.com', 'www.bitsandletters.com'].includes(url.hostname)) {
    return href;
  }

  const defaults = { utm_source: 'demaree.me', utm_medium: medium, utm_campaign: campaign };
  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (url.searchParams.has(key)) continue;
    url.searchParams.set(key, value);
    changed = true;
  }
  return changed ? url.href : href;
}
