import { z } from 'zod'

// Database/schema/table selection for a blueprint component
export const sourceBindingSchema = z.object({
	binding_db: z.string().trim().min(1, 'Database is required'),
	binding_schema: z.string().trim().min(1, 'Schema is required'),
	source_table: z.string().trim().min(1, 'Table is required'),
})

// Simple type map used for warning-level checks (string/number/datetime/boolean)
export const normalizedTypeSchema = z.enum([
	'string', 'number', 'datetime', 'boolean',
])

export const tablePkItemSchema = z.object({
	name: z.string().min(1),
	binding: z.string().optional().default(''),
})

export const nodeBindingItemSchema = z.object({
	name: z.string().min(1),
	binding: z.string().optional().default(''),
})

export const secondaryNodeSchema = z.object({
	node: z.string().min(1),
	bindings: z.array(nodeBindingItemSchema).default([]),
})

export const attributeColumnSchema = z.object({
	name: z.string().min(1),
	data_type: z.string().optional().default(''),
	binding: z.string().optional().default(''),
})

export const blueprintBindingsSchema = z.object({
	...sourceBindingSchema.shape,
	table_pk: z.array(tablePkItemSchema).default([]),
	primary_node: z
		.object({ bindings: z.array(nodeBindingItemSchema).default([]) })
		.optional(),
	secondary_nodes: z.array(secondaryNodeSchema).default([]),
	columns: z.array(attributeColumnSchema).default([]),
})

export type SourceBindingInput = z.infer<typeof sourceBindingSchema>
export type BlueprintBindingsInput = z.infer<typeof blueprintBindingsSchema>


