{%- set ns = namespace(all_cols=[]) -%}

{%- if primary_node.name is iterable and primary_node.name is not string -%}
    {%- for n in primary_node.name -%}
        {%- set ns.all_cols = ns.all_cols + [(n, 'string')] -%}
    {%- endfor -%}
{%- else -%}
    {%- set ns.all_cols = ns.all_cols + [(primary_node.name, 'string')] -%}
{%- endif -%}

{%- for node in secondary_nodes -%}
    {%- if node.name is iterable and node.name is not string -%}
        {%- for n in node.name -%}
            {%- set ns.all_cols = ns.all_cols + [(n, 'string')] -%}
        {%- endfor -%}
    {%- else -%}
        {%- set ns.all_cols = ns.all_cols + [(node.name, 'string')] -%}
    {%- endif -%}
{%- endfor -%}

{%- for col in columns -%}
    {%- set ns.all_cols = ns.all_cols + [(col.name, col.type)] -%}
{%- endfor -%}

{%- set unique_cols = [] -%}
{%- for c in ns.all_cols -%}
    {%- if c not in unique_cols -%}
        {%- set _ = unique_cols.append(c) -%}
    {%- endif -%}
{%- endfor -%}

CREATE {% if replace_objects %}OR REPLACE TABLE{% else %}TABLE IF NOT EXISTS{% endif %} ENTITY_MANAGER_DEV._1_SOURCE_DATA.{{ name | upper }}
(
{%- for col, ctype in unique_cols %}
    {{ col | upper }} {{ ctype | upper }},
{%- endfor %}
    INGEST_TIME DATETIME
)