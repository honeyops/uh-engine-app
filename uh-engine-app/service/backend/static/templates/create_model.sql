{#
Parameters expected:
- target: { database, schema }
- model_name: string
- primary_node: string (upper)
- source: string (upper)
- select_columns: [ { expr: string, alias: string } ]
- joins: [
    {
      secondary_node: string (upper),
      need_attr: bool,
      idx: int
    }
  ]
#}

{% set MODEL = model_name | upper %}
{% set PNODE = primary_node | upper %}
{% set SRC = source | upper %}

CREATE OR REPLACE VIEW {{ target.database | upper }}.{{ target.schema | upper }}.MODEL_{{ MODEL }} AS
SELECT
  n0.{{ PNODE }}_HK AS {{ PNODE }}_HK,
  n0.{{ PNODE }}_CK AS {{ PNODE }}_CK{% if (joins | length) > 0 or (primary_select_columns | length) > 0 %},{% endif %}
{% for j in joins %}
  n{{ j.idx }}.{{ j.secondary_node }}_HK AS {{ j.secondary_node }}_HK,
  n{{ j.idx }}.{{ j.secondary_node }}_CK AS {{ j.secondary_node }}_CK{% if not loop.last or (primary_select_columns | length) > 0 %},{% endif %}
{% endfor %}
{% for c in primary_select_columns %}
  {{ c.expr.replace('a0.', 'a0_derived.') }} AS {{ c.alias | upper }}{% if not loop.last %},{% endif %}
{% endfor %}
FROM {{ target.database | upper }}.{{ target.schema | upper }}.NODE_{{ PNODE }} n0
/* Latest primary attribute projection for presentation fields */
LEFT JOIN (
  SELECT * FROM {{ target.database | upper }}.{{ target.schema | upper }}.ATTR_{{ PNODE }}_{{ SRC }}
  QUALIFY ROW_NUMBER() OVER (PARTITION BY {{ PNODE }}_HK ORDER BY LOAD_TIME DESC) = 1
) a0_derived ON a0_derived.{{ PNODE }}_HK = n0.{{ PNODE }}_HK
{% for j in joins %}
LEFT JOIN {{ target.database | upper }}.{{ target.schema | upper }}.EDGE_{{ PNODE }}_{{ j.secondary_node }} e{{ j.idx }}
  ON e{{ j.idx }}.{{ PNODE }}_HK = n0.{{ PNODE }}_HK
LEFT JOIN {{ target.database | upper }}.{{ target.schema | upper }}.NODE_{{ j.secondary_node }} n{{ j.idx }}
  ON n{{ j.idx }}.{{ j.secondary_node }}_HK = e{{ j.idx }}.{{ j.secondary_node }}_HK
{% endfor %};
