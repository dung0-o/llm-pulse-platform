SELECT
  CONCAT(s.post_id, '-', m.model) AS mention_id,
  s.post_id,
  s.url,
  s.author,
  s.title,
  s.full_text,
  m.brand,
  m.model,
  m.pattern,
  m.is_specific_family,
  TRIM(REGEXP_EXTRACT(s.full_text, m.pattern)) AS mention,
  REGEXP_INSTR(s.full_text, m.pattern) AS mention_position,
  s.published_at,
  s.publish_date
FROM {{ ref('silver_cleaned_posts') }} s
CROSS JOIN {{ ref('models') }} m
WHERE REGEXP_CONTAINS(s.full_text, m.pattern)
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY post_id, mention_position
  ORDER BY is_specific_family DESC, LENGTH(model) DESC
) = 1
