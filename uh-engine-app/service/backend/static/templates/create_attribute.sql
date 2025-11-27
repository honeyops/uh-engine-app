{%- set node = primary_node.node | upper -%}

CREATE {% if replace_objects %}OR REPLACE TABLE{% else %}TABLE IF NOT EXISTS{% endif %} {{ target.database | upper }}.{{ target.schema | upper }}.ATTR_{{ node }}_{{ name | upper }}_{{ source | upper }}
(
    {{ node }}_HK BINARY NOT NULL,
    {%- for col in columns %}
    {{ col.target | upper }} {{ col.type | upper }},
    {%- endfor %}
    IS_DELETED BOOLEAN NOT NULL,
    HASH_DIFF BINARY NOT NULL,
    LOAD_TIME TIMESTAMP NOT NULL,
    INGEST_TIME TIMESTAMP NOT NULL,
    LOADED_FROM STRING NOT NULL,
    CONSTRAINT PK_{{ node }}_HK PRIMARY KEY ({{ node }}_HK, LOAD_TIME),
    CONSTRAINT FK_{{ node }}_HK FOREIGN KEY ({{ node }}_HK) REFERENCES {{ target.database | upper }}.{{ target.schema | upper }}.NODE_{{ node }}
);
