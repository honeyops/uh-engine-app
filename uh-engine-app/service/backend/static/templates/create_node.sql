{%- set node = node | upper -%}

CREATE {% if replace_objects %}OR REPLACE TABLE{% else %}TABLE IF NOT EXISTS{% endif %} {{ target.database | upper }}.{{ target.schema | upper }}.NODE_{{ node }}
(
    {{ node }}_HK BINARY NOT NULL,
    {{ node }}_CK STRING NOT NULL,
    LOAD_TIME TIMESTAMP NOT NULL,
    LOADED_FROM STRING NOT NULL,
    CONSTRAINT PK_NODE_{{ node }} PRIMARY KEY({{ node }}_HK)  
);