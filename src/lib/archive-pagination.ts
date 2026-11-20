const pageSize = 8;

export function paginatePosts<T>(posts: T[], url: URL) {
  const values = url.searchParams.getAll('page');
  const value = values[0] ?? '1';
  if (values.length > 1 || !/^[1-9]\d*$/.test(value)) return undefined;

  const page = Number(value);
  const pageCount = Math.max(1, Math.ceil(posts.length / pageSize));
  if (!Number.isSafeInteger(page) || page > pageCount) return undefined;

  const pageUrl = (number: number) => number === 1 ? url.pathname : `${url.pathname}?page=${number}`;
  const start = (page - 1) * pageSize;
  return {
    posts: posts.slice(start, start + pageSize),
    canonical: pageUrl(page),
    newer: page > 1 ? pageUrl(page - 1) : undefined,
    older: page < pageCount ? pageUrl(page + 1) : undefined,
  };
}
