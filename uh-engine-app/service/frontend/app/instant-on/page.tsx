'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from "@/components/shared/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { ChevronLeft, ChevronRight, Loader2, Zap, User, Database, ArrowDown, ArrowUp } from "lucide-react"
import { useRouter } from 'next/navigation'
import { cn } from "@/lib/utils"
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deployDatabase, getDatabaseConfig, type DatabaseConfig, updateDatabaseConfig } from '@/lib/api/model-catalog'
import { useToast } from '@/hooks/use-toast'
import { SourceAccessSection } from '@/components/source-access/source-access-section'

type Step = 'getting-started' | 'architecture' | 'database' | 'prerequisite' | 'summary'

const steps: { id: Step; title: string; description: string }[] = [
	{
		id: 'getting-started',
		title: 'Getting Started',
		description: 'Introduction to Instant On'
	},
	{
		id: 'architecture',
		title: 'Architecture',
		description: 'System architecture overview'
	},
	{
		id: 'database',
		title: 'Database',
		description: 'Database configuration'
	},
	{
		id: 'prerequisite',
		title: 'Access',
		description: 'Access requirements'
	},
	{
		id: 'summary',
		title: 'Summary',
		description: 'Review and proceed'
	}
]

export default function InstantOnPage() {
	const [currentStep, setCurrentStep] = useState<Step>('getting-started')
	const router = useRouter()
	const queryClient = useQueryClient()
	const { toast } = useToast()

	// Database config endpoint doesn't exist - using default/empty config
	// TODO: Replace with existing API when available
	const databaseConfig: DatabaseConfig | undefined = undefined
	const isDatabaseLoading = false
	const databaseError = null

	type SchemaSummary = {
		name: string
		description?: string
		isOptional: boolean
		isSelectedByDefault: boolean
		isDeployed: boolean
	}

	type DatabaseSummary = {
		name: string
		displayName: string
		isDeployed: boolean
		schemas: SchemaSummary[]
	}

	const databaseSummary = useMemo<DatabaseSummary | null>(() => {
		if (!databaseConfig?.config) {
			return null
		}

		const modernSection = databaseConfig.config.databases
		if (modernSection && Array.isArray(modernSection.schemas)) {
			return {
				name: modernSection.name ?? 'UNKNOWN_DATABASE',
				displayName: (modernSection.name ?? 'UNKNOWN_DATABASE').toUpperCase(),
				isDeployed: Boolean(modernSection.deployed),
				schemas: modernSection.schemas.map((schema, index) => ({
					name: schema.name ?? `SCHEMA_${index + 1}`,
					description: schema.description,
					isOptional: Boolean(schema.optional),
					isSelectedByDefault: schema.deployed ?? schema.create !== false,
					isDeployed: Boolean(schema.deployed),
				})),
			}
		}

		const legacySection = databaseConfig.config.database
		if (legacySection && Array.isArray(legacySection.layers)) {
			return {
				name: legacySection.name ?? 'UNKNOWN_DATABASE',
				displayName: (legacySection.name ?? 'UNKNOWN_DATABASE').toUpperCase(),
				isDeployed: false,
				schemas: legacySection.layers
					.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
					.map((layer) => ({
						name: layer.name,
						description: layer.description,
						isOptional: false,
						isSelectedByDefault: true,
						isDeployed: false,
					})),
			}
		}

		return null
	}, [databaseConfig])

	const [schemaOverrides, setSchemaOverrides] = useState<Record<string, boolean>>({})

	useEffect(() => {
		if (!databaseSummary) {
			setSchemaOverrides((prev) => (Object.keys(prev).length > 0 ? {} : prev))
			return
		}

		setSchemaOverrides((prev) => {
			const next: Record<string, boolean> = {}
			for (const schema of databaseSummary.schemas) {
				if (!schema.isOptional) continue
				const previousValue = prev[schema.name]
				next[schema.name] = previousValue ?? schema.isSelectedByDefault
			}

			const prevKeys = Object.keys(prev)
			const nextKeys = Object.keys(next)

			if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === next[key])) {
				return prev
			}

			return next
		})
	}, [databaseSummary])

	const effectiveSchemas = useMemo(() => {
		if (!databaseSummary) return []

		return databaseSummary.schemas.map((schema) => {
			const override = schemaOverrides[schema.name]
			const isSelected = schema.isOptional ? (override ?? schema.isSelectedByDefault) : true
			return {
				...schema,
				isSelected,
			}
		})
	}, [databaseSummary, schemaOverrides])

	const selectedSchemaCount = useMemo(
		() => effectiveSchemas.filter((schema) => schema.isSelected).length,
		[effectiveSchemas],
	)

	const optionalSchemaCount = useMemo(
		() => effectiveSchemas.filter((schema) => schema.isOptional).length,
		[effectiveSchemas],
	)

	const updateDatabaseConfigMutation = useMutation({
		mutationFn: (nextConfig: DatabaseConfig['config']) => updateDatabaseConfig(nextConfig),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['database-config'] })
		},
		onError: (error: any) => {
			const description =
				error?.response?.data?.detail ??
				error?.message ??
				'Failed to update database configuration.'
			toast({
				variant: 'destructive',
				title: 'Database configuration update failed',
				description,
			})
		},
	})

	const handleOptionalToggle = useCallback((schemaName: string, nextValue: boolean) => {
		if (!databaseSummary || !databaseConfig?.config?.databases) {
			toast({
				variant: 'destructive',
				title: 'Cannot update schema',
				description: 'Database configuration is not available.',
			})
			return
		}

		const previousValue =
			schemaOverrides[schemaName] ??
			databaseSummary.schemas.find((schema) => schema.name === schemaName)?.isSelectedByDefault ??
			false

		setSchemaOverrides((prev) => ({
			...prev,
			[schemaName]: nextValue,
		}))

		const nextConfig = JSON.parse(JSON.stringify(databaseConfig.config)) as DatabaseConfig['config']
		const targetSection = nextConfig.databases
		if (!targetSection) {
			toast({
				variant: 'destructive',
				title: 'Cannot update schema',
				description: 'Database configuration is not in the expected format.',
			})
			setSchemaOverrides((prev) => ({
				...prev,
				[schemaName]: previousValue,
			}))
			return
		}

		const schemaToUpdate = targetSection.schemas.find((schema) => schema.name === schemaName)
		if (!schemaToUpdate) {
			toast({
				variant: 'destructive',
				title: 'Cannot update schema',
				description: `Schema ${schemaName} was not found in the configuration.`,
			})
			setSchemaOverrides((prev) => ({
				...prev,
				[schemaName]: previousValue,
			}))
			return
		}

		// Only update the create flag - deployed should only be set when actually deployed
		schemaToUpdate.create = nextValue

		updateDatabaseConfigMutation.mutate(nextConfig, {
			onError: () => {
				setSchemaOverrides((prev) => ({
					...prev,
					[schemaName]: previousValue,
				}))
			},
		})
	}, [databaseConfig?.config, databaseSummary, schemaOverrides, toast, updateDatabaseConfigMutation])
	
	const currentStepIndex = steps.findIndex(s => s.id === currentStep)
	const isFirstStep = currentStepIndex === 0
	const isLastStep = currentStepIndex === steps.length - 1

	const deployDatabaseMutation = useMutation({
		mutationFn: () => deployDatabase({ drop_existing: false }),
		onSuccess: () => {
			toast({
				title: 'Deployment complete',
				description: 'The database and selected schemas are ready.',
				className: 'border-emerald-500 bg-emerald-100 text-emerald-800',
			})
			router.push('/model-catalog')
		},
		onError: (error: any) => {
			const description =
				error?.response?.data?.detail ??
				error?.message ??
				'Database deployment failed. Please check the logs and try again.'
			toast({
				variant: 'destructive',
				title: 'Deployment failed',
				description,
			})
		},
	})

	const handleNext = () => {
		if (isLastStep) {
			deployDatabaseMutation.mutate()
		} else if (!deployDatabaseMutation.isPending) {
			setCurrentStep(steps[currentStepIndex + 1].id)
		}
	}

	const isDeploying = deployDatabaseMutation.isPending

	const handlePrevious = () => {
		if (!isFirstStep && !isDeploying) {
			setCurrentStep(steps[currentStepIndex - 1].id)
		}
	}

	const renderStepContent = () => {
		switch (currentStep) {
			case 'getting-started':
				return (
					<div className="space-y-4">
						<h2 className="text-2xl font-semibold">Welcome to Instant On</h2>
						<p className="text-muted-foreground">
							Instant On provides a streamlined way to provision and configure your Unified Honey Engine environment.
							This wizard will provide information and guide you through the setup process step by step.
						</p>
						<div className="space-y-2">
							<h3 className="text-lg font-medium">What you'll accomplish:</h3>
							<ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
								<li>Understand the system architecture</li>
								<li>Configure database settings</li>
								<li>Review access requirements</li>
								<li>Finalise the setup</li>
							</ul>
						</div>
					</div>
				)
			case 'architecture':
				return (
					<div className="space-y-4">
						<h2 className="text-2xl font-semibold">System Architecture</h2>
						<p className="text-muted-foreground">
							The Unified Honey Engine accepts source data from anywhere in your Snowflake account. </p>
						<p className="text-muted-foreground">
							The engine stages and prepares your data, then deposits it into the UNIFIED_HONEY database where it's automatically organized, 
							modeled, and optionally surfaced in the semantic layer. </p>
						<p className="text-muted-foreground">
							From here, you can combine models or directly expose them in your own database for consumption.
						</p>
						
						{/* Flow Diagram */}
							<Card>
								<CardHeader>
								<CardTitle>Overview</CardTitle>
								</CardHeader>
								<CardContent>
								<div className="space-y-2 py-4">
									{/* Sources */}
									<div className="flex flex-col items-center">
										<div className="flex gap-4 justify-center flex-wrap">
											<div className="rounded-lg border-2 border-border bg-muted/30 px-4 py-3 min-w-[120px] text-center">
												<p className="text-sm font-medium">Source 1</p>
											</div>
											<div className="rounded-lg border-2 border-border bg-muted/30 px-4 py-3 min-w-[120px] text-center">
												<p className="text-sm font-medium">Source 2</p>
											</div>
											<div className="rounded-lg border-2 border-border bg-muted/30 px-4 py-3 min-w-[120px] text-center">
												<p className="text-sm font-medium">Source 3</p>
											</div>
										</div>
									</div>
									
									{/* Arrow Down */}
									<div className="flex justify-center">
										<ArrowDown className="h-6 w-6 text-primary" />
									</div>
									
									{/* Unified Honey Engine */}
									<div className="flex flex-col items-center">
										<div className="rounded-xl border-3 border-primary bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 px-8 py-6 min-w-[260px] text-center shadow-lg relative overflow-hidden">
											<div className="relative z-10">
												<div className="flex items-center justify-center gap-2 mb-2">
													<Zap className="h-6 w-6 text-primary" />
													<p className="text-lg font-bold text-primary">Unified Honey Engine</p>
												</div>
												<p className="text-xs text-muted-foreground font-medium">Staging & Processing</p>
											</div>
										</div>
									</div>
									
									{/* Arrow Down */}
									<div className="flex justify-center">
										<ArrowDown className="h-6 w-6 text-primary" />
									</div>
									
									{/* UNIFIED_HONEY Database Container */}
									<div className="flex flex-col items-center w-full">
										<div className="rounded-lg border-3 border-primary bg-primary/5 px-6 py-5 min-w-[280px] max-w-[400px] w-full">
											{/* Database Header */}
											<div className="text-center mb-4 pb-3 border-b border-primary/20">
												<p className="text-lg font-bold text-primary">UNIFIED_HONEY Database</p>
											</div>
											
											{/* Layers inside database */}
											<div className="space-y-2">
												{/* Organised data store */}
												<div className="rounded-lg border-2 border-border bg-background px-4 py-3 text-center">
													<p className="text-sm font-semibold">Organised data store</p>
												</div>
												
												{/* Arrow Down */}
												<div className="flex justify-center">
													<ArrowDown className="h-5 w-5 text-primary/50" />
												</div>
												
												{/* Modelled objects */}
												<div className="rounded-lg border-2 border-border bg-background px-4 py-3 text-center">
													<p className="text-sm font-semibold">Modelled objects</p>
												</div>
												
												{/* Arrow Down */}
												<div className="flex justify-center">
													<ArrowDown className="h-5 w-5 text-primary/50" />
												</div>
												
												{/* Semantic views */}
												<div className="rounded-lg border-2 border-border bg-background px-4 py-3 text-center">
													<p className="text-sm font-semibold">Semantic views</p>
													<p className="text-xs text-muted-foreground mt-1">(optional)</p>
												</div>
											</div>
										</div>
									</div>
									
									{/* Arrow Up to UNIFIED_HONEY Database (access) */}
									<div className="flex justify-center">
										<ArrowUp className="h-6 w-6 text-primary" />
									</div>
									
									{/* Your Data */}
									<div className="flex flex-col items-center">
										<div className="rounded-xl border-3 border-primary bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 px-8 py-6 min-w-[260px] text-center shadow-lg">
											<div className="flex items-center justify-center gap-2 mb-2">
												<User className="h-6 w-6 text-primary" />
												<p className="text-lg font-bold text-primary">Your Data</p>
											</div>
											<p className="text-xs text-muted-foreground font-medium">Ready for Consumption</p>
										</div>
									</div>
								</div>
								</CardContent>
							</Card>
					</div>
				)
			case 'prerequisite':
				return <SourceAccessSection />
			case 'database':
				return (
					<div className="space-y-4">
						<h2 className="text-2xl font-semibold">Database Deployment</h2>
						<p className="text-muted-foreground">
							This outlines the new database that will be created and the schemas that will be included.
						</p>
						<p className="text-muted-foreground">
							Required schemas are always included. Optional schemas can be toggled on or off before deployment.
						</p>
						<Card>
							<CardHeader>
								<CardTitle>Deployment Summary</CardTitle>
								<CardDescription>
									List of database objects that will be deployed as part of Instant On.
								</CardDescription>
							</CardHeader>
							<CardContent>
								{isDatabaseLoading && (
									<div className="space-y-4">
										<Skeleton className="h-6 w-48" />
										<div className="space-y-3">
											<Skeleton className="h-16 w-full" />
											<Skeleton className="h-16 w-full" />
											<Skeleton className="h-16 w-full" />
										</div>
									</div>
								)}

								{!isDatabaseLoading && databaseError && (
									<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
										Unable to load database configuration. Please verify the backend API is reachable.
									</div>
								)}

								{!isDatabaseLoading && !databaseError && !databaseSummary && (
									<div className="rounded-md border border-muted bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
										No database configuration found. Ensure configuration/database.yaml has been defined.
									</div>
								)}

								{!isDatabaseLoading && !databaseError && databaseSummary && (
									<div className="space-y-6">
										<div className="rounded-lg border border-border bg-muted/20 p-4">
											<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
												<div>
													<p className="text-sm text-muted-foreground">Database</p>
													<div className="flex items-center gap-2">
														<p className="text-lg font-semibold tracking-wide">
															{databaseSummary.displayName}
														</p>
														{databaseSummary.isDeployed && (
															<Badge className="border-emerald-500 bg-emerald-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-700">
																Deployed
															</Badge>
														)}
													</div>
												</div>
												<div className="text-sm text-muted-foreground">
													{selectedSchemaCount} of {effectiveSchemas.length} schema
													{effectiveSchemas.length === 1 ? '' : 's'} selected
												</div>
											</div>
											{optionalSchemaCount > 0 && (
												<p className="mt-2 text-xs text-muted-foreground">
													Optional schemas can be toggled. Required schemas are always deployed.
												</p>
											)}
										</div>

										<div className="space-y-3">
											{effectiveSchemas.map((schema) => (
												<div
													key={schema.name}
													className={cn(
														"flex flex-col gap-3 rounded-lg border border-border/70 bg-background p-4 transition",
														!schema.isSelected && schema.isOptional ? "opacity-60" : "",
													)}
												>
													<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
														<div>
															<div className="flex items-center gap-2">
																<p className="text-sm font-medium tracking-wide">
																	{schema.name.toUpperCase()}
																</p>
																{schema.isDeployed && (
																	<Badge className="border-emerald-500 bg-emerald-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-emerald-700">
																		Deployed
																	</Badge>
																)}
															</div>
															<p className="text-xs text-muted-foreground">
																{schema.description || 'No description provided.'}
															</p>
														</div>
														{schema.isOptional ? (
															<label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
																<Checkbox
																	id={`schema-toggle-${schema.name}`}
																	checked={schema.isSelected}
																	disabled={updateDatabaseConfigMutation.isPending}
																	onCheckedChange={(checked) =>
																		handleOptionalToggle(schema.name, checked === true)
																	}
																/>
																<span>Include in deployment</span>
															</label>
														) : (
															<span className="text-xs font-medium text-muted-foreground">
																Required
															</span>
														)}
													</div>
												</div>
											))}
										</div>
									</div>
								)}
							</CardContent>
						</Card>
					</div>
				)
			case 'summary':
				return (
					<div className="space-y-4">
						<h2 className="text-2xl font-semibold">Summary</h2>
						<p className="text-muted-foreground">
							Review your configuration and proceed to execute the Instant On setup.
						</p>
						<div className="space-y-3">
							<Card>
								<CardHeader>
									<CardTitle>Configuration Summary</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-3">
										<div className="flex justify-between items-center">
											<span className="text-sm font-medium">Architecture</span>
											<span className="text-sm text-muted-foreground">Reviewed</span>
										</div>
										<div className="flex justify-between items-center">
											<span className="text-sm font-medium">Pre-requisites</span>
											<span className="text-sm text-muted-foreground">Verified</span>
										</div>
										<div className="flex justify-between items-center">
											<span className="text-sm font-medium">Database</span>
											<span className="text-sm text-muted-foreground">Ready to configure</span>
										</div>
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle>Next Steps</CardTitle>
								</CardHeader>
								<CardContent>
									<p className="text-sm text-muted-foreground">
										Click "Next" to proceed with the Instant On execution. This will:
									</p>
									<ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground ml-4 mt-2">
										<li>Create the database and schemas</li>
										<li>Provision required roles and users</li>
										<li>Configure security settings</li>
										<li>Initialize the engine components</li>
									</ul>
								</CardContent>
							</Card>
						</div>
					</div>
				)
			default:
				return null
		}
	}

	return (
		<>
			<DeployingOverlay isVisible={isDeploying} />
			<PageHeader title="Instant on" group="Engine Management" />
			<div className="flex flex-1 flex-col min-h-0">
				<div className="flex-1 overflow-auto p-6">
					<div className="max-w-4xl mx-auto space-y-6">
						{/* Step Indicator */}
						<div className="flex items-start justify-between mb-8 gap-2">
							{steps.map((step, index) => (
								<React.Fragment key={step.id}>
									<div className="flex flex-col items-center flex-1 min-w-0">
										<button
											onClick={() => setCurrentStep(step.id)}
											disabled={isDeploying}
											className={cn(
												"w-10 h-10 rounded-full flex items-center justify-center font-medium shrink-0 transition-all cursor-pointer",
												"hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
												currentStep === step.id
													? 'bg-primary text-primary-foreground cursor-default'
													: index < currentStepIndex
													? 'bg-primary/20 text-primary hover:bg-primary/30'
													: 'bg-muted text-muted-foreground hover:bg-muted/80',
												isDeploying && 'opacity-50 cursor-not-allowed'
											)}
											aria-label={`Go to step ${index + 1}: ${step.title}`}
										>
											{index + 1}
										</button>
										<div className="mt-2 text-center w-full">
											<button
												onClick={() => setCurrentStep(step.id)}
												disabled={isDeploying}
												className={cn(
													"text-xs font-medium whitespace-nowrap transition-colors",
													"hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded",
													currentStep === step.id
														? 'text-foreground cursor-default'
														: 'text-muted-foreground hover:text-foreground',
													isDeploying && 'opacity-50 cursor-not-allowed'
												)}
												aria-label={`Go to step ${index + 1}: ${step.title}`}
											>
												{step.title}
											</button>
										</div>
									</div>
									{index < steps.length - 1 && (
										<div
											className={cn(
												"h-0.5 flex-1 mt-5 mx-2",
												index < currentStepIndex ? 'bg-primary' : 'bg-muted'
											)}
										/>
									)}
								</React.Fragment>
							))}
						</div>

						{/* Step Content */}
						<Card>
							<CardContent className="pt-6">{renderStepContent()}</CardContent>
						</Card>
					</div>
				</div>

				{/* Navigation Buttons */}
				<div className="border-t bg-background p-4">
					<div className="mx-auto flex max-w-4xl justify-between">
						<Button
							variant="outline"
							onClick={handlePrevious}
							disabled={isFirstStep || isDeploying}
							className="flex items-center gap-2"
						>
							<ChevronLeft className="h-4 w-4" />
							Previous
						</Button>
						<Button
							onClick={handleNext}
							disabled={isDeploying}
							className="flex items-center gap-2"
						>
							{isLastStep ? (
								isDeploying ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" />
										Deploying...
									</>
								) : (
									<>
										<Zap className="h-4 w-4" />
										Instant On
									</>
								)
							) : (
								<>
									Next
									<ChevronRight className="h-4 w-4" />
								</>
							)}
						</Button>
					</div>
				</div>
			</div>
		</>
	)
}

function DeployingOverlay({ isVisible }: { isVisible: boolean }) {
	if (!isVisible) {
		return null
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur">
			<div className="flex flex-col items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-50 px-6 py-5 text-emerald-800 shadow-lg">
				<Loader2 className="h-6 w-6 animate-spin" />
				<p className="text-sm font-medium">Deploying, please wait...</p>
			</div>
		</div>
	)
}
