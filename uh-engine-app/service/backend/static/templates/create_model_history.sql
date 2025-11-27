{#
Parameters expected:
- target: { database, schema }
- model_name: string
- primary_node: string (upper)
- source: string (upper)
- select_columns: [ { expr: string, alias: string } ]  # expressions reference a0 or a{idx}
- joins: [ { secondary_node: string (upper), need_attr: bool, idx: int } ]
#}

{% set MODEL = model_name | upper %}
{% set PNODE = primary_node | upper %}
{% set SRC = source | upper %}

CREATE OR REPLACE VIEW {{ target.database | upper }}.{{ target.schema | upper }}.MODEL_{{ MODEL }}_HISTORY AS
WITH primary_attr AS (
  SELECT
    *,
    LEAD(LOAD_TIME) OVER (PARTITION BY {{ PNODE }}_HK ORDER BY LOAD_TIME) AS VALID_TO
  FROM {{ target.database | upper }}.{{ target.schema | upper }}.ATTR_{{ PNODE }}_{{ SRC }}
)
SELECT
  n0.{{ PNODE }}_HK AS {{ PNODE }}_HK,
  a0.LOAD_TIME AS VALID_FROM,
  COALESCE(a0.VALID_TO, TO_TIMESTAMP('9999-12-31 23:59:59')) AS VALID_TO{% if (joins | length) > 0 or (select_columns | length) > 0 %},{% endif %}
{% for j in joins %}
  n{{ j.idx }}.{{ j.secondary_node }}_HK AS {{ j.secondary_node }}_HK{% if not loop.last or (select_columns | length) > 0 %},{% endif %}
{% endfor %}
{% for c in select_columns %}
  {{ c.expr }} AS {{ c.alias | upper }}{% if not loop.last %},{% endif %}
{% endfor %}
FROM {{ target.database | upper }}.{{ target.schema | upper }}.NODE_{{ PNODE }} n0
JOIN primary_attr a0 ON a0.{{ PNODE }}_HK = n0.{{ PNODE }}_HK
{% for j in joins %}
LEFT JOIN {{ target.database | upper }}.{{ target.schema | upper }}.EDGE_{{ PNODE }}_{{ j.secondary_node }} e{{ j.idx }}
  ON e{{ j.idx }}.{{ PNODE }}_HK = n0.{{ PNODE }}_HK
LEFT JOIN {{ target.database | upper }}.{{ target.schema | upper }}.NODE_{{ j.secondary_node }} n{{ j.idx }}
  ON n{{ j.idx }}.{{ j.secondary_node }}_HK = e{{ j.idx }}.{{ j.secondary_node }}_HK
{% if j.need_attr %}
LEFT JOIN LATERAL (
  SELECT *
  FROM {{ target.database | upper }}.{{ target.schema | upper }}.ATTR_{{ j.secondary_node }}_{{ SRC }} s
  WHERE s.{{ j.secondary_node }}_HK = n{{ j.idx }}.{{ j.secondary_node }}_HK
    AND s.LOAD_TIME <= a0.LOAD_TIME
  QUALIFY ROW_NUMBER() OVER (PARTITION BY s.{{ j.secondary_node }}_HK ORDER BY s.LOAD_TIME DESC) = 1
) a{{ j.idx }} ON TRUE
{% endif %}
{% endfor %};
