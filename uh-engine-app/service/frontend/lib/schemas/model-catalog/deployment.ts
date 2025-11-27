import { z } from 'zod'

// Minimal deployment summary inputs
export const deployBlueprintTableSchema = z.object({
	name: z.string().min(1),
	replace_objects: z.boolean().default(true),
})

export const deployModelSchema = z.object({
	id: z.string().min(1),
	type: z.enum(['dimension', 'fact']),
	replace_objects: z.boolean().default(true),
})

export const deploymentRequestSchema = z.object({
	blueprintTables: z.array(deployBlueprintTableSchema).default([]),
	models: z.array(deployModelSchema).default([]),
})

export type DeploymentRequest = z.infer<typeof deploymentRequestSchema>


