{%- set name = name | upper -%}

CREATE {% if replace_objects %}OR REPLACE STREAM{% else %}STREAM IF NOT EXISTS{% endif %} {{ stage.database | upper }}.{{ stage.schema | upper }}.STREAM_{{ name }} ON VIEW {{ stage.database | upper }}.{{ stage.schema | upper }}.STG_{{ name }}_{{ source | upper }};