/** Shared topic/tag assignment used by the importer and one-off backfill. */

export const DEFAULT_TOPIC = 'notebook';
export const SOURCE_TAGS = new Set(['From Tumblr']);

export const TOPICS = ['tech-thoughts', 'work', 'culture', 'notebook'];

const TAG_TO_TOPIC = new Map([
  ['Adobe', 'tech-thoughts'],
  ['Amazon', 'tech-thoughts'],
  ['Apple', 'tech-thoughts'],
  ['Artificial Intelligence', 'tech-thoughts'],
  ['Cool Tools', 'tech-thoughts'],
  ['Facebook', 'tech-thoughts'],
  ['Flash', 'tech-thoughts'],
  ['Foursquare', 'tech-thoughts'],
  ['Gadgets', 'tech-thoughts'],
  ['Git', 'tech-thoughts'],
  ['GitHub', 'tech-thoughts'],
  ['Google', 'tech-thoughts'],
  ['iOS', 'tech-thoughts'],
  ['iPad', 'tech-thoughts'],
  ['iPhone', 'tech-thoughts'],
  ['Linux', 'tech-thoughts'],
  ['Mac', 'tech-thoughts'],
  ['macOS', 'tech-thoughts'],
  ['Microsoft', 'tech-thoughts'],
  ['Nerdery', 'tech-thoughts'],
  ['Rails', 'tech-thoughts'],
  ['Rails 3', 'tech-thoughts'],
  ['Ruby', 'tech-thoughts'],
  ['science', 'tech-thoughts'],
  ['Social Media', 'tech-thoughts'],
  ['social networks', 'tech-thoughts'],
  ['Twitter', 'tech-thoughts'],
  ['Typekit', 'tech-thoughts'],
  ['Typography', 'tech-thoughts'],
  ['UX', 'tech-thoughts'],
  ['Web Development', 'tech-thoughts'],
  ['the web', 'tech-thoughts'],

  ['Basecamp', 'work'],
  ['Blogging', 'work'],
  ['Business', 'work'],
  ['Personal News', 'work'],
  ['Product Management', 'work'],
  ['Work', 'work'],
  ['Writing', 'work'],

  ['Climate Change', 'culture'],
  ['Coffee', 'culture'],
  ['Covid-19', 'culture'],
  ['Culture', 'culture'],
  ['Current Events', 'culture'],
  ['Elden Ring', 'culture'],
  ['Food', 'culture'],
  ['Gaming', 'culture'],
  ['Health', 'culture'],
  ['Hollywood', 'culture'],
  ['Marvel Studios', 'culture'],
  ['MCU', 'culture'],
  ['Mental Health', 'culture'],
  ['photography', 'culture'],
  ['psychology', 'culture'],
  ['San Francisco', 'culture'],
  ['Starfield', 'culture'],
  ['Travel', 'culture'],
  ['tv', 'culture'],
  ['US Politics', 'culture'],
  ['Video Games', 'culture'],
]);

const KEYWORD_TAGS = [
  { tag: 'Artificial Intelligence', re: /\b(ai|a\.i\.|claude|chatgpt|openai|anthropic|llm|cowork)\b/i },
  { tag: 'Apple', re: /\b(apple|iphone|ipad|macos|os x|yosemite|siri|watch|app store)\b/i },
  { tag: 'Google', re: /\bgoogle\b/i },
  { tag: 'Microsoft', re: /\b(microsoft|windows|surface|xbox)\b/i },
  { tag: 'Web Development', re: /\b(css3?|html|javascript|typescript|frontend|websites?|web fonts?|webfonts?|responsive web|web development)\b/i },
  { tag: 'Linux', re: /\b(linux|bazzite|fedora)\b/i },
  { tag: 'Gadgets', re: /\b(kindle|webcam|monitor|display|gadget|laptop|tablet)\b/i },
  { tag: 'Typography', re: /\b(typograph|typekit|webfont|oklch|fonts?)\b/i },
  { tag: 'Product Management', re: /\b(product org|product management|\bpm\b|roadmap)\b/i },
  { tag: 'Work', re: /\b(career|management|process kills|agency|consult)\b/i },
  { tag: 'Video Games', re: /\b(elden ring|starfield|video game|nintendo|playstation)\b/i },
  { tag: 'Travel', re: /\b(road trip|travel|electric vehicle)\b/i },
];

const TOPIC_KEYWORDS = [
  {
    topic: 'tech-thoughts',
    re: /\b(apple|google|microsoft|facebook|twitter|iphone|ipad|macos|ios|linux|android|software|css3?|html|javascript|objective-c|ec2|amazon|yahoo|mozilla|h\.264|macbook|foursquare|readability|instapaper|yelp|permalink|webfont|oklch|kindle|wordpress|siri|bazzite|webcam|browser|chrome|firefox|safari|api|programming|developer|vim|claude|chatgpt|openai|anthropic|ai|gadget|flash|adobe|typekit|github|gitlab|rails|ruby|internet users|retina|os x|lion)\b/i,
  },
  {
    topic: 'work',
    re: /\b(product org|product management|career|consult|agency|process kills|management|business|basecamp|work for free|engineerism|startup|paul graham|culture of fear|creative people say no)\b/i,
  },
  {
    topic: 'culture',
    re: /\b(food|restaurant|movie|tv|netflix|the wire|mad men|oscar|animaniacs|game|elden|marvel|hollywood|coffee|travel|road trip|breaking bad|depression|mental health|psychology|climate|politics|soccer|whisky|whiskey|music|jay-z|trent reznor)\b/i,
  },
];

const SLUG_OVERRIDES = {
  'amazon-now-offering-ec2-micro-instances': {
    topic: 'tech-thoughts',
    tags: ['Amazon'],
  },
  'amazons-new-ec2-micro-instances-benchmarked': {
    topic: 'tech-thoughts',
    tags: ['Amazon'],
  },
  'getting-hardboiled-with-css3-2d-transforms': {
    topic: 'tech-thoughts',
    tags: ['Web Development'],
  },
  'objective-c-literals-part-1': {
    topic: 'tech-thoughts',
    tags: ['Apple'],
  },
  'marco-arment-reviews-the-retina-macbook-pro': {
    topic: 'tech-thoughts',
    tags: ['Apple'],
  },
  'should-i-work-for-free': { topic: 'work', tags: ['Work'] },
  'creative-people-say-no': { topic: 'work', tags: ['Work'] },
  'middle-form': { topic: 'work', tags: ['Blogging'] },
};

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function meaningfulTags(tags) {
  return tags.filter((tag) => !SOURCE_TAGS.has(tag));
}

function tagsFromText(text) {
  if (!text) return [];
  return KEYWORD_TAGS.filter(({ re }) => re.test(text)).map(({ tag }) => tag);
}

function topicFromTags(tags) {
  for (const tag of meaningfulTags(tags)) {
    const topic = TAG_TO_TOPIC.get(tag);
    if (topic) return topic;
  }
  return undefined;
}

function topicFromText(text) {
  if (!text) return undefined;
  for (const { topic, re } of TOPIC_KEYWORDS) {
    if (re.test(text)) return topic;
  }
  return undefined;
}

export function classifyEntry({
  slug = '',
  title = '',
  description = '',
  tags = [],
  format = 'standard',
}) {
  const override = SLUG_OVERRIDES[slug];
  const haystack = `${title} ${description}`;
  const nextTags = unique([
    ...tags,
    ...(override?.tags ?? []),
    ...tagsFromText(haystack),
  ]);
  const topic =
    override?.topic ??
    topicFromTags(nextTags) ??
    topicFromText(haystack) ??
    DEFAULT_TOPIC;

  return { topic, tags: nextTags };
}

export function slugifyTag(name) {
  return name
    .trim()
    .replace(/^i(Pad|Phone|OS)$/i, (_, part) => `i-${part.toLowerCase()}`)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
