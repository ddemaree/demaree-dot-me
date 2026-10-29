-- Existing EmDash installations do not reapply changed seed configuration.
-- Run with Wrangler D1 execute against each existing local/remote database.
UPDATE _emdash_collections SET url_pattern = '/p/{slug}/'
WHERE slug = 'posts' AND url_pattern = '/emdash-test/{slug}/';
