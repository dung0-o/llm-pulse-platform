SELECT
  f.mention_id,
  f.post_id,
  f.url,
  f.title,
  f.full_text,
  f.brand,
  f.model,
  f.mention,
  f.pattern,
  f.is_specific_family,
  f.published_at,
  f.publish_date,
  p.sentiment_score,
  p.sentiment_label
FROM {{ ref('gold_post_features') }} AS f
LEFT JOIN {{ source('model', 'gold_sentiment_predictions') }} AS p
  ON f.mention_id = p.mention_id
