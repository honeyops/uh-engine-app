{%- set node = primary_node.node | upper -%}
{%- set db = target.database | upper %}
{%- set schema = target.schema | upper -%}

{# PIT Table Creation - Only create if replace_objects is true or table doesn't exist #}
{% if replace_objects %}
CREATE OR REPLACE TABLE {{ db }}.{{ schema }}.PIT_{{ node }}
{% else %}
CREATE TABLE IF NOT EXISTS {{ db }}.{{ schema }}.PIT_{{ node }}
{% endif %}
(
    {{ node }}_HK BINARY NOT NULL,
    EFFECTIVE_DATE TIMESTAMP NOT NULL,
    SOURCE TEXT,
    {{ source | upper }}_LOAD_TIME TIMESTAMP,
    {{ source | upper }}_INGEST_TIME TIMESTAMP,
    CONSTRAINT PK_PIT_{{ node }} PRIMARY KEY ({{ node }}_HK, EFFECTIVE_DATE)
);
(
    {{ node }}_HK BINARY NOT NULL,
    EFFECTIVE_DATE TIMESTAMP NOT NULL,
    SOURCE TEXT,
    {{ source | upper }}_LOAD_TIME TIMESTAMP,
    {{ source | upper }}_INGEST_TIME TIMESTAMP,
    CONSTRAINT PK_PIT_{{ node }} PRIMARY KEY ({{ node }}_HK, EFFECTIVE_DATE)
);
