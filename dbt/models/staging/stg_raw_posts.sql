SELECT
  id,
  title,
  link AS url,
  author,
  published AS published_at,
  updated AS updated_at,
  scraped_at,
  COALESCE(
    (SELECT value FROM UNNEST(content) WHERE type = 'text/html'),
    summary
  ) AS raw_html
FROM {{ source('bronze', 'raw_posts') }}
