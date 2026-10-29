import sanitizeHtml from 'sanitize-html';

// EmDash 1.1.0's inline HTML allowlist, with link titles and ordered-list
// starting numbers retained from the existing Markdoc content.
const allowedTags = [
  'address', 'article', 'aside', 'footer', 'header', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hgroup', 'main', 'nav', 'section', 'blockquote',
  'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'hr', 'li', 'menu',
  'ol', 'p', 'pre', 'ul', 'a', 'abbr', 'b', 'bdi', 'bdo', 'br',
  'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 'rb',
  'rp', 'rt', 'rtc', 'ruby', 's', 'samp', 'small', 'span', 'strong',
  'sub', 'sup', 'time', 'u', 'var', 'wbr', 'caption', 'col',
  'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'img', 'iframe',
];

/** @param {string} html */
export function sanitizeEmDashHtml(html) {
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      '*': ['class', 'id', 'data-*'],
      a: ['href', 'name', 'target', 'title'],
      img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
      iframe: ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen'],
      ol: ['start'],
    },
    allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel'],
    allowedIframeHostnames: ['www.youtube.com', 'player.vimeo.com'],
  });
}
