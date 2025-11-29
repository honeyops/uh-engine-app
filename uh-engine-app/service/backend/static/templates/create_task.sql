{%- set name = name | upper -%}
{% set node = primary_node.node | upper  %}
{%- set db = target.database | upper %}
{%- set schema = target.schema | upper -%}

CREATE {% if replace_objects %}OR REPLACE TASK{% else %}TASK IF NOT EXISTS{% endif %} {{ stage.database | upper }}.{{ stage.schema | upper }}.TASK_{{ name }}
    WAREHOUSE = {{ warehouse | upper }}
WHEN SYSTEM$STREAM_HAS_DATA('{{ stage.database | upper }}.{{ stage.schema | upper }}.STREAM_{{ name }}')
AS
INSERT ALL
-- Insert keys to primary node ({{ node }}) when they don't already exist in the {{ node }} node - first occurrence per HK only
WHEN (node_{{ node }}_rn = 1) AND (
  SELECT COUNT(1) 
  FROM {{ db }}.{{ schema }}.NODE_{{ node }} TGT 
  WHERE TGT.{{ node }}_HK = SRC_{{ node }}_HK
) = 0
THEN INTO {{ db }}.{{ schema }}.NODE_{{ node }}
(
  {{ node }}_HK,
  {{ node }}_CK,
  LOAD_TIME,
  LOADED_FROM
)  
VALUES(
  SRC_{{ node }}_HK,
  SRC_{{ node }}_CK,
  SRC_LOAD_TIME,
  SRC_LOADED_FROM
)
{%- for key in secondary_nodes %}
{%- set knode = key.node | upper  %}
{%- if key.load != false %}
-- Insert keys to secondary node no{{ loop.index }} ({{ key.node }}) when they don't already exist in the {{ key.node }} node - first occurrence per HK only
WHEN (node_{{ knode }}_rn = 1) AND (
  SELECT COUNT(1)
  FROM {{ db }}.{{ schema }}.NODE_{{ knode }} TGT
  WHERE TGT.{{ knode }}_HK = SRC_{{ knode }}_HK
) = 0
THEN INTO {{ db }}.{{ schema }}.NODE_{{ knode }}
(
  {{ knode }}_HK,
  {{ knode }}_CK,
  LOAD_TIME,
  LOADED_FROM
)  
VALUES(
  SRC_{{ knode }}_HK,
  SRC_{{ knode }}_CK,
  SRC_LOAD_TIME,
  SRC_LOADED_FROM
)
{%- endif %}

-- Insert into the edge for {{ node }} ({{ primary_node.name }}) -> {{ key.node }} ({{ key.name }})
-- where the latest link is not the same as the stream
WHEN (
  SELECT COUNT(1)
  FROM {{ db }}.{{ schema }}.EDGE_{{ node }}_{{ knode }} TGT 
  WHERE TGT.{{ node }}_{{ knode }}_EK = SRC_{{ node }}_{{ knode }}_EK
) = 0
THEN INTO {{ db }}.{{ schema }}.EDGE_{{ node }}_{{ knode }}
(
  {{ node }}_{{ knode }}_EK,
  {{ node }}_HK,
  {{ knode }}_HK,
  LOAD_TIME,
  INGEST_TIME,
  LOADED_FROM
)  
VALUES (
  SRC_{{ node }}_{{ knode }}_EK,
  SRC_{{ node }}_HK,
  SRC_{{ knode }}_HK,
  SRC_LOAD_TIME,
  SRC_INGEST_TIME,
  SRC_LOADED_FROM
)
{%- endfor %}

-- Insert stream data into the attribute where the hash_diff is new
WHEN 1=1
-- WHEN NOT (EQUAL_NULL(TGT_HASH_DIFF,SRC_HASH_DIFF) AND RN_ORDER = 1)
THEN INTO {{ db }}.{{ schema }}.ATTR_{{ node }}_{{ name | upper }}_{{ source | upper }}
(
  {{ node }}_HK,
  {%- for col in columns %}
  {{ col.target | upper }},
  {%- endfor %} 
  HASH_DIFF,
  LOAD_TIME,
  INGEST_TIME,
  LOADED_FROM
)  
VALUES 
(
  SRC_{{ node }}_HK,
  {%- for col in columns %}
  SRC_{{ col.target | upper }},
  {%- endfor %} 
  SRC_HASH_DIFF,
  SRC_LOAD_TIME,
  SRC_INGEST_TIME,
  SRC_LOADED_FROM
)

-- Select from stream with computed keys and row numbers for deduplication
SELECT
    -- Primary Hash
    SHA1_BINARY({{ hash_expr(composite_expr(primary_node.name)) }}) AS SRC_{{ node }}_HK,
    {{ composite_expr(primary_node.name) }} AS SRC_{{ node }}_CK,
    ROW_NUMBER() OVER (PARTITION BY SHA1_BINARY({{ hash_expr(composite_expr(primary_node.name)) }}) ORDER BY SRC.{{ ingest_time | upper }}, SYSDATE()) AS node_{{ node }}_rn,
    -- Secondary Keys
    {%- for key in secondary_nodes %}
    {%- set knode = key.node | upper  %}
    SHA1_BINARY({{ hash_expr(composite_expr(key.name)) }}) AS SRC_{{ knode }}_HK,
    {{ composite_expr(key.name) }} AS SRC_{{ knode }}_CK,
    {%- if key.load != false %}
    ROW_NUMBER() OVER (PARTITION BY SHA1_BINARY({{ hash_expr(composite_expr(key.name)) }}) ORDER BY SRC.{{ ingest_time | upper }}, SYSDATE()) AS node_{{ knode }}_rn,
    {%- endif %}
    SHA1_BINARY(
      UPPER(
        ARRAY_TO_STRING(
          ARRAY_CONSTRUCT(
            {{ hash_expr(composite_expr(primary_node.name)) }},
            {{ hash_expr(composite_expr(key.name)) }}
          ),
        '^'
        )
      )
    ) AS SRC_{{ node }}_{{ knode }}_EK,
    {%- endfor %}
    -- Data Cols
    {%- for col in columns %}
    SRC.{{ col.binding | upper }} AS SRC_{{ col.target | upper }},
    {%- endfor %}
    -- Dates
    SYSDATE() AS SRC_LOAD_TIME,
    SRC.{{ ingest_time | upper }} AS SRC_INGEST_TIME,
    '{{ name | upper }}' AS SRC_LOADED_FROM,
    -- Hash Diff
    SHA1_BINARY(
      ARRAY_TO_STRING(
        ARRAY_CONSTRUCT(
          {{ hash_expr(composite_expr(primary_node.name)) }},
          {%- for key in secondary_nodes %}
          {{ hash_expr(composite_expr(key.name)) }},
          {%- endfor %}
          {%- for col in columns %}
          {{ hash_expr('SRC.' + col.binding) }}{% if not loop.last %},{% endif %}
          {%- endfor %}
        ),
        '^'
      )
    ) AS SRC_HASH_DIFF,
    -- TGT_SAT.HASH_DIFF AS TGT_HASH_DIFF,
    ROW_NUMBER() OVER (PARTITION BY SRC_{{ node }}_HK ORDER BY SRC.{{ ingest_time | upper }}) AS RN_ORDER
FROM {{ stage.database | upper }}.{{ stage.schema | upper }}.STREAM_{{ name | upper }} SRC
-- ASOF JOIN {{ db }}.{{ schema }}.ATTR_{{ node }}_{{ name | upper }}_{{ source | upper }} TGT_SAT
--     MATCH_CONDITION(SRC.{{ ingest_time | upper }} >= TGT_SAT.INGEST_TIME) 
--     ON TGT_SAT.{{ node }}_HK = SRC_{{ node }}_HK
WHERE SRC.{{ ingest_time | upper }} > (
    SELECT COALESCE(MAX(INGEST_TIME), '1900-01-01'::TIMESTAMP) 
    FROM {{ db }}.{{ schema }}.ATTR_{{ node }}_{{ name | upper }}_{{ source | upper }}
)
QUALIFY NOT(EQUAL_NULL(SRC_HASH_DIFF, LAG(SRC_HASH_DIFF) OVER (PARTITION BY SRC_{{ node }}_HK ORDER BY SRC.{{ ingest_time | upper }})))
;