{%- set name = name | upper -%}
{%- set ns = namespace(all_cols=[]) -%}

{%- for binding in primary_node.bindings -%}
    {%- set ns.all_cols = ns.all_cols + [(binding.binding, 'string')] -%}
{%- endfor -%}

{%- for node in secondary_nodes -%}
    {%- for binding in node.bindings -%}
        {%- set ns.all_cols = ns.all_cols + [(binding.binding, 'string')] -%}
    {%- endfor -%}
{%- endfor -%}

{%- for col in columns -%}
    {%- set ns.all_cols = ns.all_cols + [(col.binding, col.type)] -%}
{%- endfor -%}

{%- set unique_cols = [] -%}
{%- for c in ns.all_cols -%}
    {%- if c not in unique_cols -%}
        {%- set _ = unique_cols.append(c) -%}
    {%- endif -%}
{%- endfor -%}

CREATE {% if replace_objects %}OR REPLACE VIEW{% else %}VIEW IF NOT EXISTS{% endif %} {{ stage.database | upper }}.{{ stage.schema | upper }}.STG_{{ name }}_{{ source | upper }}
AS
SELECT
{%- for col, ctype in unique_cols %}
    {{ col | upper }},
{%- endfor %}
    {{ ingest_time | upper }},
    COALESCE({% if delete_condition is defined and delete_condition %}{{ delete_condition }}{% else %}FALSE{% endif %}, FALSE) AS IS_DELETED
FROM {{ database | upper }}.{{ schema | upper }}.{{ name | upper }}
{%- if where_clause is defined and where_clause %}
WHERE {{ where_clause }}
{%- endif %};