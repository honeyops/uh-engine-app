{%- set primary = primary | upper %}
{%- set secondary = secondary | upper -%}

CREATE {% if replace_objects %}OR REPLACE TABLE{% else %}TABLE IF NOT EXISTS{% endif %} {{ target.database | upper }}.{{ target.schema | upper }}.EDGE_{{ primary }}_{{ secondary }}
(
    {{ primary }}_{{ secondary }}_EK BINARY NOT NULL,
    {{ primary }}_HK BINARY NOT NULL,
    {{ secondary }}_HK BINARY NOT NULL,
    LOAD_TIME TIMESTAMP NOT NULL,
    INGEST_TIME TIMESTAMP NOT NULL,
    LOADED_FROM STRING NOT NULL,
    CONSTRAINT PK_{{ primary }}_{{ secondary }}_EK PRIMARY KEY({{ primary }}_{{ secondary }}_EK),
    CONSTRAINT FK1_{{ primary }}_HK FOREIGN KEY({{ primary }}_HK) REFERENCES {{ target.database | upper }}.{{ target.schema | upper }}.NODE_{{ primary }},
    CONSTRAINT FK2_{{ secondary }}_HK FOREIGN KEY({{ secondary }}_HK) REFERENCES {{ target.database | upper }}.{{ target.schema | upper }}.NODE_{{ secondary }}
);