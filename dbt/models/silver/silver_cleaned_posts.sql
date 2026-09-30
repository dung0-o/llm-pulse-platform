SELECT
  REGEXP_EXTRACT(id, r't3_([a-z0-9]+)') AS post_id,
  TRIM(title) AS title,
  REGEXP_REPLACE(author, r'/u/', '') AS author,
  url,
  published_at,
  updated_at,
  scraped_at,
  DATE(published_at) AS publish_date,
  CONCAT(
    title, '/n/n',
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REPLACE(REPLACE(REPLACE(REPLACE(raw_html,
          '&lt;', '<'),
          '&gt;', '>'),
          '&amp;', '&'),
          '&quot;', '"'
        ),
        r'(<!-- SC_OFF -->|<div class="md">|</div>|<[^>]+>|&#(\d+);|\s+submitted by\s.*$)', ''
      ),
      r'<br\s*/?>', '\n'
    )
  ) AS full_text,
FROM {{ ref('stg_raw_posts') }}
WHERE title IS NOT NULL
  AND TRIM(title) != ''
  AND url IS NOT NULL
  AND published_at IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY post_id
  ORDER BY scraped_at DESC
) = 1
