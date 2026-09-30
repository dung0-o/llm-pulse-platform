SELECT
    p.mention_id
FROM {{ source('model', 'gold_sentiment_predictions') }} p
LEFT JOIN {{ ref('gold_post_features') }} f
    ON p.mention_id = f.mention_id
WHERE f.mention_id IS NULL
