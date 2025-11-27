'use client'

import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useModelCatalogWizard } from '@/lib/state/model-catalog-wizard'
import { useQuery } from '@tanstack/react-query'
import {
	getDeploymentSummary,
	deployModelsStaged,
	type DeploymentSummaryResponse,
} from '@/lib/api/model-catalog'
import {
	Database,
	Box,
	Network,
	Play,
	Waves,
	Eye,
	CheckCircle2,
	XCircle,
	Circle,
	AlertTriangle,
	Loader2,
	ChevronRight,
	ChevronLeft,
	ChevronDown,
	Rocket,
	Upload,
	PackagePlus,
	PanelRightOpen,
} from 'lucide-react'
import DeploymentLogs from './deployment-logs'

type DeploymentStatus = 'pending' | 'in_progress' | 'completed' | 'error'

type ItemStatus = {
	[key: string]: DeploymentStatus
}

type ModelDeploymentStatus = {
	modelId: string
	stepStatuses: {
		staging: ItemStatus
		data_processing: ItemStatus
		key_storage: ItemStatus
		build_relationships: ItemStatus
		data_storage: ItemStatus
		supporting_artefacts: ItemStatus
		model_deployment: ItemStatus
		seed_load: ItemStatus
		apply_tags: ItemStatus
		apply_grants: ItemStatus
	}
	errors: Array<{ step: string; item: string; message: string }>
}

type StepKey = keyof ModelDeploymentStatus['stepStatuses']

type DeploymentSummaryProps = {
	onLoadingChange?: (isLoading: boolean) => void
	onDeploymentSuccess?: (modelIds: string[]) => void
}

export default function DeploymentSummary({ onLoadingChange, onDeploymentSuccess }: DeploymentSummaryProps) {
	const wizard = useModelCatalogWizard()
	const setDeploymentProgressRef = React.useRef(wizard.setDeploymentProgress)
	setDeploymentProgressRef.current = wizard.setDeploymentProgress
	const [deploymentStatuses, setDeploymentStatuses] = useState<
		Record<string, ModelDeploymentStatus>
	>({})
	const [errorModalOpen, setErrorModalOpen] = useState(false)
	const [allErrors, setAllErrors] = useState<Array<{ model: string; step: string; item: string; message: string }>>([])
	const [isLogPanelOpen, setIsLogPanelOpen] = useState(true)
	const [collapsedModels, setCollapsedModels] = useState<Set<string>>(new Set())
	const deploymentInitiatedRef = React.useRef(false)
	const previousProgressRef = React.useRef<number>(0)

	// Fetch deployment summary
	const { data: summaryData, isLoading } = useQuery({
		queryKey: ['deployment-summary', wizard.selectedModelIds],
		queryFn: () => getDeploymentSummary(wizard.selectedModelIds),
		enabled: wizard.selectedModelIds.length > 0 && wizard.step === 'summary',
	})

	// Notify parent of loading state changes
	useEffect(() => {
		onLoadingChange?.(isLoading)
	}, [isLoading, onLoadingChange])

	// Initialize deployment statuses from summary
	useEffect(() => {
		if (summaryData?.models) {
			const statuses: Record<string, ModelDeploymentStatus> = {}
			summaryData.models.forEach((model) => {
				statuses[model.model_id] = {
					modelId: model.model_id,
					stepStatuses: {
						staging: {},
						data_processing: {},
						key_storage: {},
						build_relationships: {},
						data_storage: {},
						supporting_artefacts: {},
						model_deployment: {},
						seed_load: {},
						apply_tags: {},
						apply_grants: {},
					},
					errors: [],
				}
				// Initialize all items as pending
				model.staging.items.forEach((item) => {
					statuses[model.model_id].stepStatuses.staging[item.name] = 'pending'
				})
				model.data_processing.streams.forEach((item) => {
					statuses[model.model_id].stepStatuses.data_processing[item.name] = 'pending'
				})
				model.data_processing.tasks.forEach((item) => {
					statuses[model.model_id].stepStatuses.data_processing[item.name] = 'pending'
				})
				model.key_storage.items.forEach((item) => {
					statuses[model.model_id].stepStatuses.key_storage[item.name] = 'pending'
				})
				model.build_relationships.items.forEach((item) => {
					statuses[model.model_id].stepStatuses.build_relationships[item.name] = 'pending'
				})
				model.data_storage.items.forEach((item) => {
					statuses[model.model_id].stepStatuses.data_storage[item.name] = 'pending'
				})
				model.supporting_artefacts.items.forEach((item) => {
					statuses[model.model_id].stepStatuses.supporting_artefacts[item.name] = 'pending'
				})
				statuses[model.model_id].stepStatuses.model_deployment[model.model_deployment.name] = 'pending'
				if (model.seed_load.available) {
					model.seed_load.blueprints.forEach((bp) => {
						statuses[model.model_id].stepStatuses.seed_load[`${bp.blueprint_id}_refresh`] = 'pending'
					})
				}
				// Initialize apply_tags and apply_grants items
				if (model.apply_tags && model.apply_tags.items) {
					model.apply_tags.items.forEach((item) => {
						statuses[model.model_id].stepStatuses.apply_tags[item.name] = 'pending'
					})
				}
				if (model.apply_grants && model.apply_grants.items) {
					model.apply_grants.items.forEach((item) => {
						statuses[model.model_id].stepStatuses.apply_grants[item.name] = 'pending'
					})
				}
			})
			setDeploymentStatuses(statuses)
		}
	}, [summaryData])

	// Handle deployment when wizard.isDeploying becomes true (triggered by footer button)
	useEffect(() => {
		// Early return conditions
		if (!wizard.isDeploying) {
			// Reset the ref when not deploying
			deploymentInitiatedRef.current = false
			return
		}

		if (!summaryData?.models || summaryData.models.length === 0) {
			return
		}

		// Check if deployment already started using ref (prevent double deployment)
		if (deploymentInitiatedRef.current) {
			return
		}

		// Mark deployment as initiated IMMEDIATELY to prevent race conditions
		deploymentInitiatedRef.current = true

		const modelIds = wizard.selectedModelIds

		// Reset all statuses to pending
		setDeploymentStatuses((prev) => {
			const updated = { ...prev }
			Object.keys(updated).forEach((modelId) => {
				const modelStatus = updated[modelId]
				if (!modelStatus) return
				
				// Reset all step statuses
				const stepKeys: Array<keyof ModelDeploymentStatus['stepStatuses']> = [
					'staging',
					'data_processing',
					'key_storage',
					'build_relationships',
					'data_storage',
					'supporting_artefacts',
					'model_deployment',
					'seed_load',
					'apply_tags',
					'apply_grants',
				]
				
				stepKeys.forEach((stepKey) => {
					Object.keys(modelStatus.stepStatuses[stepKey]).forEach((item) => {
						modelStatus.stepStatuses[stepKey][item] = 'pending'
					})
				})
				
				modelStatus.errors = []
			})
			return updated
		})
		setAllErrors([])

		deployModelsStaged(
			modelIds,
			{ replace_objects: true, run_full_refresh: true },
			// onLog - track deployment progress
			(log) => {
				// Add log to wizard for display in log panel - wrap in queueMicrotask to ensure immediate processing
				queueMicrotask(() => {
					wizard.appendLog(
						log.message,
						log.level,
						log.step,
						log.object_name || '',
						log.timestamp
					)
				})

				if (!log.model_id || !log.step) return

				setDeploymentStatuses((prev) => {
					const updated = { ...prev }
					const modelStatus = updated[log.model_id!]
					if (!modelStatus || !summaryData) return updated

					const model = summaryData.models.find((m) => m.model_id === log.model_id)
					if (!model) return updated

					// Map step names to our step keys
					const stepMap: Record<string, keyof typeof modelStatus.stepStatuses> = {
						staging: 'staging',
						data_processing: 'data_processing',
						key_storage: 'key_storage',
						build_relationships: 'build_relationships',
						data_storage: 'data_storage',
						supporting_artefacts: 'supporting_artefacts',
						model_deployment: 'model_deployment',
						seed_load: 'seed_load',
						apply_tags: 'apply_tags',
						apply_grants: 'apply_grants',
					}

					const stepKey = stepMap[log.step]
					if (!stepKey) return updated

					// Helper function to find item name by object_name or blueprint_id
					const findItemName = () => {
						let itemName = log.object_name

						if (!itemName && log.blueprint_id) {
							// Try to find the item by blueprint_id
							if (stepKey === 'staging') {
								const item = model.staging.items.find((i) => i.blueprint_id === log.blueprint_id)
								itemName = item?.name
							} else if (stepKey === 'data_processing') {
								const item = [...model.data_processing.streams, ...model.data_processing.tasks].find(
									(i) => i.blueprint_id === log.blueprint_id
								)
								itemName = item?.name
							} else if (stepKey === 'key_storage') {
								const item = model.key_storage.items.find((i) => i.blueprint_id === log.blueprint_id)
								itemName = item?.name
							} else if (stepKey === 'build_relationships') {
								const item = model.build_relationships.items.find((i) => i.blueprint_id === log.blueprint_id)
								itemName = item?.name
							} else if (stepKey === 'data_storage') {
								const item = model.data_storage.items.find((i) => i.blueprint_id === log.blueprint_id)
								itemName = item?.name
							}
						}

						return itemName
					}

					// Handle start/in-progress
					if (log.status === 'start' || log.status === 'in_progress') {
						const itemName = findItemName()
						if (itemName && modelStatus.stepStatuses[stepKey][itemName] === 'pending') {
							modelStatus.stepStatuses[stepKey][itemName] = 'in_progress'
						}
					}

					// Handle completion
					if (log.status === 'complete' && log.level === 'SUCCESS') {
						const itemName = findItemName()
						if (itemName && (modelStatus.stepStatuses[stepKey][itemName] === 'pending' || modelStatus.stepStatuses[stepKey][itemName] === 'in_progress')) {
							modelStatus.stepStatuses[stepKey][itemName] = 'completed'
						}
					}

					// Handle errors
					if (log.level === 'ERROR') {
						const itemName = findItemName()
						if (itemName) {
							modelStatus.stepStatuses[stepKey][itemName] = 'error'
							modelStatus.errors.push({
								step: log.step,
								item: itemName,
								message: log.message,
							})

							setAllErrors((prev) => [
								...prev,
								{
									model: log.model_id!,
									step: log.step,
									item: itemName,
									message: log.message,
								},
							])
						}
					}

					return updated
				})
			},
			// onModelStart
			(data) => {
				// Model deployment started
			},
			// onModelComplete - handled via onLog events now
			(data) => {
				// Model completion is tracked via log events with step="model_deployment"
			},
			// onComplete
			(data) => {
				wizard.setIsDeploying(false)
				// Clear minimized state when deployment completes so modal can be closed normally
				wizard.setIsMinimized(false)

				if (onDeploymentSuccess) {
					const successfulIds = Array.isArray(data?.successful)
						? data.successful
							.map((entry: any) => {
								if (!entry) return null
								if (typeof entry === 'string') return entry

								if (typeof entry === 'object') {
									return entry.model_id || entry.modelId || entry.id || null
								}

								return null
							})
							.filter((id): id is string => Boolean(id))
						: []

					const idsToReport = successfulIds.length > 0 ? successfulIds : wizard.selectedModelIds
					if (idsToReport.length > 0) {
						onDeploymentSuccess(idsToReport)
					}
				}
			},
			// onError
			(error) => {
				wizard.setIsDeploying(false)
				// Clear minimized state on error so modal can be closed normally
				wizard.setIsMinimized(false)
			}
		)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [wizard.isDeploying, wizard.selectedModelIds, summaryData, onDeploymentSuccess])

	// Check if deploy button should be enabled
	const canDeploy = !wizard.isDeploying && summaryData?.models && summaryData.models.length > 0

	// Get step icon
	const getStepIcon = (step: string) => {
		switch (step) {
			case 'staging':
				return <Database className="h-4 w-4" />
			case 'data_processing':
				return <Waves className="h-4 w-4" />
			case 'key_storage':
				return <Box className="h-4 w-4" />
			case 'build_relationships':
				return <Network className="h-4 w-4" />
			case 'data_storage':
				return <Database className="h-4 w-4" />
			case 'supporting_artefacts':
				return <Eye className="h-4 w-4" />
			case 'model_deployment':
				return <Rocket className="h-4 w-4" />
			case 'seed_load':
				return <PackagePlus className="h-4 w-4" />
			case 'apply_tags':
				return <Upload className="h-4 w-4" />
			case 'apply_grants':
				return <Upload className="h-4 w-4" />
			default:
				return <Circle className="h-4 w-4" />
		}
	}

	// Get step display name
	const getStepName = (step: string) => {
		switch (step) {
			case 'staging':
				return 'Staging'
			case 'data_processing':
				return 'Data Processing'
			case 'key_storage':
				return 'Keys'
			case 'build_relationships':
				return 'Relationships'
			case 'data_storage':
				return 'Data'
			case 'supporting_artefacts':
				return 'Supporting Artefacts'
			case 'model_deployment':
				return 'Model Deployment'
			case 'seed_load':
				return 'Initial Load'
			case 'apply_tags':
				return 'Apply Tags'
			case 'apply_grants':
				return 'Apply Grants'
			default:
				return step
		}
	}

	// Check if all items in a step are completed
	const isStepComplete = (modelId: string, step: keyof ModelDeploymentStatus['stepStatuses']) => {
		const modelStatus = deploymentStatuses[modelId]
		if (!modelStatus) return false
		const stepStatuses = modelStatus.stepStatuses[step]
		const items = Object.keys(stepStatuses)
		if (items.length === 0) return false
		return items.every((item) => stepStatuses[item] === 'completed')
	}

	// Check if any items in a step have errors
	const hasStepErrors = (modelId: string, step: keyof ModelDeploymentStatus['stepStatuses']) => {
		const modelStatus = deploymentStatuses[modelId]
		if (!modelStatus) return false
		const stepStatuses = modelStatus.stepStatuses[step]
		return Object.values(stepStatuses).some((status) => status === 'error')
	}

	// Toggle model collapse state
	const toggleModelCollapse = (modelId: string) => {
		setCollapsedModels((prev) => {
			const newSet = new Set(prev)
			if (newSet.has(modelId)) {
				newSet.delete(modelId)
			} else {
				newSet.add(modelId)
			}
			return newSet
		})
	}

	// Get checkbox component for an item
	const getCheckbox = (status: DeploymentStatus, size: 'default' | 'large' = 'default') => {
		const sizeClass = size === 'large' ? 'h-6 w-6' : 'h-4 w-4'
		if (status === 'completed') {
			return <CheckCircle2 className={`${sizeClass} text-green-600`} />
		} else if (status === 'error') {
			return <XCircle className={`${sizeClass} text-red-600`} />
		} else if (status === 'in_progress') {
			return <Loader2 className={`${sizeClass} text-blue-600 animate-spin`} />
		} else {
			return <Circle className={`${sizeClass} text-muted-foreground`} />
		}
	}

	// Calculate deployment progress and counts
	const { deploymentProgress, totalCounts, totalItemCount } = useMemo(() => {
		if (!summaryData?.models || Object.keys(deploymentStatuses).length === 0) {
			return {
				deploymentProgress: 0,
				totalCounts: {
					staging: 0,
					data_processing: 0,
					key_storage: 0,
					build_relationships: 0,
					data_storage: 0,
					supporting_artefacts: 0,
					model_deployment: 0,
					seed_load: 0,
					apply_tags: 0,
					apply_grants: 0,
				},
				totalItemCount: 0,
			}
		}

		let totalItems = 0
		let completedItems = 0
		const counts: Record<StepKey, number> = {
			staging: 0,
			data_processing: 0,
			key_storage: 0,
			build_relationships: 0,
			data_storage: 0,
			supporting_artefacts: 0,
			model_deployment: 0,
			seed_load: 0,
			apply_tags: 0,
			apply_grants: 0,
		}

		// Calculate progress and counts
		Object.values(deploymentStatuses).forEach((modelStatus) => {
			Object.entries(modelStatus.stepStatuses).forEach(([stepKey, step]) => {
				const typedStepKey = stepKey as StepKey
				const itemCount = Object.keys(step).length
				if (itemCount > 0) {
					counts[typedStepKey] += itemCount
				}
				Object.values(step).forEach((status) => {
					totalItems++
					if (status === 'completed') {
						completedItems++
					}
				})
			})
		})

		return {
			deploymentProgress: totalItems > 0 ? (completedItems / totalItems) * 100 : 0,
			totalCounts: counts,
			totalItemCount: Object.values(counts).reduce((acc, value) => acc + value, 0),
		}
	}, [deploymentStatuses, summaryData])

	// Sync deployment progress to Zustand store (only when it changes)
	useEffect(() => {
		if (previousProgressRef.current !== deploymentProgress) {
			previousProgressRef.current = deploymentProgress
			setDeploymentProgressRef.current(deploymentProgress)
		}
	}, [deploymentProgress])

	// Group errors by unique message and calculate distinct errors
	const { distinctErrors, totalErrors } = useMemo(() => {
		const errorMap = new Map<string, {
			message: string
			count: number
			occurrences: Array<{ model: string; step: string; item: string }>
		}>()

		allErrors.forEach((error) => {
			const key = error.message
			if (errorMap.has(key)) {
				const existing = errorMap.get(key)!
				existing.count++
				existing.occurrences.push({
					model: error.model,
					step: error.step,
					item: error.item,
				})
			} else {
				errorMap.set(key, {
					message: error.message,
					count: 1,
					occurrences: [{
						model: error.model,
						step: error.step,
						item: error.item,
					}],
				})
			}
		})

		return {
			distinctErrors: Array.from(errorMap.values()).sort((a, b) => b.count - a.count),
			totalErrors: allErrors.length,
		}
	}, [allErrors])

	if (isLoading) {
		return (
			<div className="text-sm text-muted-foreground p-8 text-center">
				Loading deployment summary...
			</div>
		)
	}

	if (!summaryData?.models || summaryData.models.length === 0) {
		return (
			<div className="text-sm text-muted-foreground p-8 text-center">
				No items to deploy.
			</div>
		)
	}

	return (
		<div className="h-full flex flex-col">
			{/* Count Summary */}
			<div className="mb-4 py-3 px-6 bg-muted/30 rounded-md border">
				<div className="flex items-center justify-between flex-wrap gap-4">
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium uppercase text-muted-foreground tracking-wide">
							Total Items
						</span>
						<span className="text-lg font-semibold">{totalItemCount}</span>
					</div>
					{totalCounts.staging > 0 && (
						<div className="flex items-center gap-2">
							{getStepIcon('staging')}
							<span className="text-xs text-muted-foreground">Staging</span>
							<span className="text-sm font-semibold">{totalCounts.staging}</span>
						</div>
					)}
					{totalCounts.data_processing > 0 && (
						<div className="flex items-center gap-2">
							{getStepIcon('data_processing')}
							<span className="text-xs text-muted-foreground">Data Processing</span>
							<span className="text-sm font-semibold">{totalCounts.data_processing}</span>
						</div>
					)}
					{totalCounts.key_storage > 0 && (
						<div className="flex items-center gap-2">
							{getStepIcon('key_storage')}
							<span className="text-xs text-muted-foreground">Keys</span>
							<span className="text-sm font-semibold">{totalCounts.key_storage}</span>
						</div>
					)}
					{totalCounts.build_relationships > 0 && (
						<div className="flex items-center gap-2">
							{getStepIcon('build_relationships')}
							<span className="text-xs text-muted-foreground">Relationships</span>
							<span className="text-sm font-semibold">{totalCounts.build_relationships}</span>
						</div>
					)}
					{totalCounts.data_storage > 0 && (
						<div className="flex items-center gap-2">
							{getStepIcon('data_storage')}
							<span className="text-xs text-muted-foreground">Data</span>
							<span className="text-sm font-semibold">{totalCounts.data_storage}</span>
						</div>
					)}
					{totalCounts.supporting_artefacts > 0 && (
						<div className="flex items-center gap-2">
							{getStepIcon('supporting_artefacts')}
							<span className="text-xs text-muted-foreground">Artefacts</span>
							<span className="text-sm font-semibold">{totalCounts.supporting_artefacts}</span>
						</div>
					)}
					{totalCounts.model_deployment > 0 && (
						<div className="flex items-center gap-2">
							{getStepIcon('model_deployment')}
							<span className="text-xs text-muted-foreground">Models</span>
							<span className="text-sm font-semibold">{totalCounts.model_deployment}</span>
						</div>
					)}
					{totalCounts.seed_load > 0 && (
						<div className="flex items-center gap-2">
							{getStepIcon('seed_load')}
							<span className="text-xs text-muted-foreground">Initial Load</span>
							<span className="text-sm font-semibold">{totalCounts.seed_load}</span>
						</div>
					)}
				</div>
			</div>

			{/* Progress Bar */}
			{wizard.isDeploying && (
				<div className="mb-4">
					<Progress value={deploymentProgress} className="h-2" />
					<div className="text-xs text-muted-foreground mt-1 text-right">
						{Math.round(deploymentProgress)}% complete
					</div>
				</div>
			)}

			{/* Error Alert */}
			{totalErrors > 0 && (
				<div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center justify-between">
					<div className="flex items-center gap-2">
						<AlertTriangle className="h-5 w-5 text-red-600" />
						<span className="text-sm font-medium text-red-900">
							{distinctErrors.length} distinct error{distinctErrors.length !== 1 ? 's' : ''} ({totalErrors} total occurrence{totalErrors !== 1 ? 's' : ''})
						</span>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setErrorModalOpen(true)}
						className="text-red-700 border-red-300 hover:bg-red-100"
					>
						View Errors
					</Button>
				</div>
			)}

			{/* Main Content Area with Sliding Panel */}
			<div className="flex-1 overflow-hidden flex gap-4 min-h-0">
				{/* Deployment Summary Checklist */}
				<div
					className={`flex-1 overflow-y-auto space-y-6 transition-all duration-300 ease-in-out ${
						isLogPanelOpen ? 'mr-0' : ''
					}`}
					style={{
						width: isLogPanelOpen ? '50%' : '100%',
					}}
				>
				{summaryData.models.map((model) => {
					const modelStatus = deploymentStatuses[model.model_id] || {
						modelId: model.model_id,
						stepStatuses: {
							staging: {},
							data_processing: {},
							key_storage: {},
							build_relationships: {},
							data_storage: {},
							supporting_artefacts: {},
							model_deployment: {},
							seed_load: {},
							apply_tags: {},
							apply_grants: {},
						},
						errors: [],
					}

					return (
						<Card key={model.model_id} className="rounded-md overflow-hidden">
							{/* Header similar to deployment logs */}
							<div className="flex items-center justify-between px-4 py-3 border-b bg-muted/40 shrink-0">
								<div className="flex items-center gap-2">
									{getCheckbox(
										Object.values(modelStatus.stepStatuses).every((step) =>
											Object.values(step).every((s) => s === 'completed')
										)
											? 'completed'
											: Object.values(modelStatus.stepStatuses).some((step) =>
													Object.values(step).some((s) => s === 'error')
												)
												? 'error'
												: Object.values(modelStatus.stepStatuses).some((step) =>
													Object.values(step).some((s) => s === 'in_progress')
												)
												? 'in_progress'
												: 'pending',
										'large'
									)}
									<h3 className="text-sm font-medium">{model.model_name}</h3>
									<Badge variant="secondary" className="bg-slate-200 text-slate-700">
										{model.model_type}
									</Badge>
								</div>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => toggleModelCollapse(model.model_id)}
									className="h-8 w-8 p-0"
									title={collapsedModels.has(model.model_id) ? "Expand" : "Collapse"}
								>
									<ChevronDown className={`h-4 w-4 transition-transform ${collapsedModels.has(model.model_id) ? '-rotate-90' : ''}`} />
								</Button>
							</div>
							<CardContent className={`p-6 ${collapsedModels.has(model.model_id) ? 'hidden' : ''}`}>
								{/* Steps (inset) */}
								<div className="space-y-4">
									{/* Staging */}
									{model.staging.count > 0 && (
										<div className="flex items-center gap-2">
											{getStepIcon('staging')}
											<span className="font-medium text-sm">Staging ({model.staging.count})</span>
											{isStepComplete(model.model_id, 'staging') && (
												<CheckCircle2 className="h-4 w-4 text-green-600" />
											)}
											{hasStepErrors(model.model_id, 'staging') && (
												<XCircle className="h-4 w-4 text-red-600" />
											)}
										</div>
									)}

									{/* Data Processing */}
									{model.data_processing.count > 0 && (
										<div className="flex items-center gap-2">
											{getStepIcon('data_processing')}
											<span className="font-medium text-sm">
												Data Processing ({model.data_processing.count})
											</span>
											{isStepComplete(model.model_id, 'data_processing') && (
												<CheckCircle2 className="h-4 w-4 text-green-600" />
											)}
											{hasStepErrors(model.model_id, 'data_processing') && (
												<XCircle className="h-4 w-4 text-red-600" />
											)}
										</div>
									)}

									{/* Keys */}
									{model.key_storage.count > 0 && (
										<div className="space-y-2">
											<div className="flex items-center gap-2">
												{getStepIcon('key_storage')}
												<span className="font-medium text-sm">Keys ({model.key_storage.count})</span>
												{isStepComplete(model.model_id, 'key_storage') && (
													<CheckCircle2 className="h-4 w-4 text-green-600" />
												)}
												{hasStepErrors(model.model_id, 'key_storage') && (
													<XCircle className="h-4 w-4 text-red-600" />
												)}
											</div>
											<div className="ml-6 space-y-1">
												{model.key_storage.items.map((item) => (
													<div key={item.name} className="flex items-center gap-2">
														{getCheckbox(modelStatus.stepStatuses.key_storage[item.name] || 'pending')}
														<span className="text-sm text-muted-foreground">{item.name}</span>
													</div>
												))}
											</div>
										</div>
									)}

									{/* Relationships */}
									{model.build_relationships.count > 0 && (
										<div className="space-y-2">
											<div className="flex items-center gap-2">
												{getStepIcon('build_relationships')}
												<span className="font-medium text-sm">
													Relationships ({model.build_relationships.count})
												</span>
												{isStepComplete(model.model_id, 'build_relationships') && (
													<CheckCircle2 className="h-4 w-4 text-green-600" />
												)}
												{hasStepErrors(model.model_id, 'build_relationships') && (
													<XCircle className="h-4 w-4 text-red-600" />
												)}
											</div>
											<div className="ml-6 space-y-1">
												{model.build_relationships.items.map((item) => (
													<div key={item.name} className="flex items-center gap-2">
														{getCheckbox(modelStatus.stepStatuses.build_relationships[item.name] || 'pending')}
														<span className="text-sm text-muted-foreground">{item.name}</span>
													</div>
												))}
											</div>
										</div>
									)}

									{/* Data */}
									{model.data_storage.count > 0 && (
										<div className="space-y-2">
											<div className="flex items-center gap-2">
												{getStepIcon('data_storage')}
												<span className="font-medium text-sm">Data ({model.data_storage.count})</span>
												{isStepComplete(model.model_id, 'data_storage') && (
													<CheckCircle2 className="h-4 w-4 text-green-600" />
												)}
												{hasStepErrors(model.model_id, 'data_storage') && (
													<XCircle className="h-4 w-4 text-red-600" />
												)}
											</div>
											<div className="ml-6 space-y-1">
												{model.data_storage.items.map((item) => (
													<div key={item.name} className="flex items-center gap-2">
														{getCheckbox(modelStatus.stepStatuses.data_storage[item.name] || 'pending')}
														<span className="text-sm text-muted-foreground">{item.name}</span>
													</div>
												))}
											</div>
										</div>
									)}

									{/* Supporting Artefacts */}
									{model.supporting_artefacts.count > 0 && (
										<div className="space-y-2">
											<div className="flex items-center gap-2">
												{getStepIcon('supporting_artefacts')}
												<span className="font-medium text-sm">
													Supporting Artefacts ({model.supporting_artefacts.count})
												</span>
												{isStepComplete(model.model_id, 'supporting_artefacts') && (
													<CheckCircle2 className="h-4 w-4 text-green-600" />
												)}
												{hasStepErrors(model.model_id, 'supporting_artefacts') && (
													<XCircle className="h-4 w-4 text-red-600" />
												)}
											</div>
											<div className="ml-6 space-y-1">
												{model.supporting_artefacts.items.map((item) => (
													<div key={item.name} className="flex items-center gap-2">
														{getCheckbox(modelStatus.stepStatuses.supporting_artefacts[item.name] || 'pending')}
														<span className="text-sm text-muted-foreground">{item.name}</span>
													</div>
												))}
											</div>
										</div>
									)}

									{/* Model Deployment */}
									<div className="space-y-2">
										<div className="flex items-center gap-2">
											{getStepIcon('model_deployment')}
											<span className="font-medium text-sm">Model Deployment</span>
											{isStepComplete(model.model_id, 'model_deployment') && (
												<CheckCircle2 className="h-4 w-4 text-green-600" />
											)}
											{hasStepErrors(model.model_id, 'model_deployment') && (
												<XCircle className="h-4 w-4 text-red-600" />
											)}
										</div>
										<div className="ml-6 space-y-1">
											<div className="flex items-center gap-2">
												{getCheckbox(
													modelStatus.stepStatuses.model_deployment[model.model_deployment.name] || 'pending'
												)}
												<span className="text-sm text-muted-foreground">{model.model_deployment.name}</span>
											</div>
										</div>
									</div>

									{/* Governance */}
									{((model.apply_tags && model.apply_tags.count > 0) || (model.apply_grants && model.apply_grants.count > 0)) && (
										<div className="space-y-2">
											<div className="flex items-center gap-2">
												{getStepIcon('apply_tags')}
												<span className="font-medium text-sm">Governance</span>
											</div>
											<div className="ml-6 space-y-1">
												{/* Apply Tags - Aggregated Status */}
												{model.apply_tags && model.apply_tags.count > 0 && (
													<div className="flex items-center gap-2">
														{(() => {
															const tagStatuses = model.apply_tags.items?.map(item =>
																modelStatus.stepStatuses.apply_tags[item.name] || 'pending'
															) || []
															const allCompleted = tagStatuses.length > 0 && tagStatuses.every(s => s === 'completed')
															const anyInProgress = tagStatuses.some(s => s === 'in_progress')
															const anyError = tagStatuses.some(s => s === 'error')

															const status = anyError ? 'error' : allCompleted ? 'completed' : anyInProgress ? 'in_progress' : 'pending'
															return getCheckbox(status)
														})()}
														<span className="text-sm text-muted-foreground">Apply Tags ({model.apply_tags.count})</span>
													</div>
												)}
												{/* Apply Grants - Aggregated Status */}
												{model.apply_grants && model.apply_grants.count > 0 && (
													<div className="flex items-center gap-2">
														{(() => {
															const grantStatuses = model.apply_grants.items?.map(item =>
																modelStatus.stepStatuses.apply_grants[item.name] || 'pending'
															) || []
															const allCompleted = grantStatuses.length > 0 && grantStatuses.every(s => s === 'completed')
															const anyInProgress = grantStatuses.some(s => s === 'in_progress')
															const anyError = grantStatuses.some(s => s === 'error')

															const status = anyError ? 'error' : allCompleted ? 'completed' : anyInProgress ? 'in_progress' : 'pending'
															return getCheckbox(status)
														})()}
														<span className="text-sm text-muted-foreground">Apply Grants ({model.apply_grants.count})</span>
													</div>
												)}
											</div>
										</div>
									)}

									{/* Initial Load */}
									{model.seed_load.available && (
										<div className="space-y-2">
											<div className="flex items-center gap-2">
												{getStepIcon('seed_load')}
												<span className="font-medium text-sm">Initial Load</span>
												{isStepComplete(model.model_id, 'seed_load') && (
													<CheckCircle2 className="h-4 w-4 text-green-600" />
												)}
												{hasStepErrors(model.model_id, 'seed_load') && (
													<XCircle className="h-4 w-4 text-red-600" />
												)}
											</div>
											<div className="ml-6 space-y-1">
												{model.seed_load.blueprints.map((bp) => (
													<div key={bp.blueprint_id} className="flex items-center gap-2">
														{getCheckbox(
															modelStatus.stepStatuses.seed_load[`${bp.blueprint_id}_refresh`] || 'pending'
														)}
														<span className="text-sm text-muted-foreground">
															Full refresh for {bp.blueprint_id}
														</span>
													</div>
												))}
											</div>
										</div>
									)}
								</div>
							</CardContent>
						</Card>
					)
				})}
				</div>

				{/* Expandable Log Panel */}
				<div
					className={`transition-all duration-300 ease-in-out overflow-hidden ${
						isLogPanelOpen ? 'w-1/2' : 'w-0'
					}`}
				>
					{isLogPanelOpen && (
						<div className="h-full">
							<DeploymentLogs
						isLogPanelOpen={isLogPanelOpen}
						onToggle={() => setIsLogPanelOpen(!isLogPanelOpen)}
					/>
						</div>
					)}
				</div>

				{/* Collapse toggle button when panel is closed */}
				{!isLogPanelOpen && (
					<Button
						variant="outline"
						size="icon"
						onClick={() => setIsLogPanelOpen(true)}
						className="fixed right-4 top-1/2 -translate-y-1/2 z-10 shadow-lg"
						title="Show deployment logs"
					>
						<PanelRightOpen className="h-4 w-4" />
					</Button>
				)}

			</div>

			{/* Error Modal */}
			<Dialog open={errorModalOpen} onOpenChange={setErrorModalOpen}>
				<DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
					<DialogHeader>
						<DialogTitle>Deployment Errors</DialogTitle>
						<DialogDescription>
							{distinctErrors.length} distinct error{distinctErrors.length !== 1 ? 's' : ''} with {totalErrors} total occurrence{totalErrors !== 1 ? 's' : ''}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3 mt-4 overflow-y-auto pr-2">
						{distinctErrors.map((error, idx) => (
							<Card key={idx} className="border-red-200">
								<CardContent className="p-4">
									<div className="space-y-2">
										<div className="flex items-start gap-2">
											<XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2 mb-1">
													<span className="font-medium text-sm text-red-900">
														Error Message
													</span>
													{error.count > 1 && (
														<Badge variant="destructive" className="text-xs">
															{error.count} occurrences
														</Badge>
													)}
												</div>
												<p className="text-sm text-red-700 break-words">{error.message}</p>
											</div>
										</div>
										{error.occurrences.length > 0 && (
											<div className="ml-6 pt-2 border-t border-red-100">
												<p className="text-xs font-medium text-muted-foreground mb-1.5">
													Affected items:
												</p>
												<div className="space-y-1">
													{error.occurrences.map((occ, occIdx) => (
														<div key={occIdx} className="flex items-center gap-2 text-xs">
															<span className="text-muted-foreground">•</span>
															<span className="font-medium">{occ.model}</span>
															<span className="text-muted-foreground">→</span>
															<span className="text-muted-foreground">{occ.step}</span>
															<span className="text-muted-foreground">→</span>
															<span className="text-muted-foreground">{occ.item}</span>
														</div>
													))}
												</div>
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				</DialogContent>
			</Dialog>
		</div>
	)
}
