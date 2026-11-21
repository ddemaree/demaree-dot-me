export const socialImageSize = { width: 1200, height: 630 };

export const defaultSocialImage = {
  ...socialImageSize,
  src: '/og/default.png',
};

export const defaultSocialImageAlt = 'David Demaree’s pixel portrait next to his orange tag mark.';

export function postSocialImage(slug: string) {
  return { ...socialImageSize, src: `/og/posts/${encodeURIComponent(slug)}.png` };
}
