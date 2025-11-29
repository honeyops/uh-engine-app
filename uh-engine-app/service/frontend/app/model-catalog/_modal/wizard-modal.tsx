'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, AlertTriangle, Clock, Minimize2 } from 'lucide-react'
import { IconCircleDashed, IconLoader3, IconCircleCheckFilled } from '@tabler/icons-react'
import { StatusBadge } from '@/components/badges/status-badge'
import { useModelCatalogWizard } from '@/lib/state/model-catalog-wizard'
import BlueprintsSidebar from './_parts/blueprints-sidebar'
import SourceSelectors from './_parts/source-selectors'
import FieldBindings from './_parts/field-bindings'
import DeploymentSummary from './_parts/deployment-summary'
import DeploymentLogs from './_parts/deployment-logs'
import { deployBlueprintsWithStreaming, deployDimensionalModelsWithStreaming, getDimensions, getFacts, type DimensionsResponse, type FactsResponse, type Dimension, type Fact } from '@/lib/api/model-catalog'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useToast } from '@/hooks/use-toast'

type WizardModalProps = {
	onDeploymentSuccess?: (modelIds: string[]) => void
}

export default function WizardModal({ onDeploymentSuccess }: WizardModalProps) {
	const wizard = useModelCatalogWizard()
	const queryClient = useQueryClient()
	const { toast } = useToast()
	const [showUnsavedWarningNext, setShowUnsavedWarningNext] = useState(false)

	// Get database name - use output database from config or default
	// Database config endpoint doesn't exist, so we'll use a default
	const databaseName = useMemo(() => {
		// Default to UNIFIED_HONEY - this should match the output_database config
		return 'UNIFIED_HONEY'
	}, [])

	// Check if any blueprint has unsaved changes
	const hasAnyUnsavedChanges = useMemo(() => {
		return wizard.blueprintCatalog.some((bp: any) => {
			const key = `${bp.source}.${bp.id || bp.name}`
			return wizard.getDirtyState(key)
		})
	}, [wizard.blueprintCatalog, wizard.blueprintDirtyState])

	// Fetch dimensions and facts to determine model types
	const { data: dimensionsData } = useQuery<DimensionsResponse>({
		queryKey: ['dimensions'],
		queryFn: () => getDimensions(),
		enabled: wizard.isOpen && (wizard.step === 'summary' || wizard.step === 'deploy'),
	})

	const { data: factsData } = useQuery<FactsResponse>({
		queryKey: ['facts'],
		queryFn: () => getFacts(),
		enabled: wizard.isOpen && (wizard.step === 'summary' || wizard.step === 'deploy'),
	})

	// Check if all blueprints are mapped (all have green status)
	// Use only persisted status from blueprint data (mapping_complete)
	const allBlueprintsMapped = useMemo(() => {
		if (!wizard.blueprintCatalog || wizard.blueprintCatalog.length === 0) return false
		return wizard.blueprintCatalog.every((bp: any) => {
			// Use only persisted status from blueprint data
			return bp?.mapping_complete === true
		})
	}, [wizard.blueprintCatalog])

	// Track if summary is loading - will be set by DeploymentSummary component
	const [isSummaryLoading, setIsSummaryLoading] = React.useState(false)

	// Deployment handler - triggers staged deployment via summary component
	const handleDeploy = useCallback(() => {
		// Just set isDeploying to true - the DeploymentSummary component will handle the actual deployment
		// This runs the new deploy-staged endpoint in the background with no UI logs
		wizard.setIsDeploying(true)
		wizard.clearLogs()
	}, [wizard])

	// Cancel deployment handler
	const handleCancelDeployment = useCallback(() => {
		wizard.setIsDeploying(false)
		wizard.setIsMinimized(false) // Clear minimized state when canceling
		// Note: This doesn't actually stop the backend deployment, just stops the UI tracking
		toast({
			title: "Deployment Cancelled",
			description: "The deployment has been cancelled. Some operations may still complete in the background.",
			variant: "destructive",
		})
	}, [wizard, toast])

	// Minimize modal handler
	const handleMinimize = useCallback(() => {
		wizard.setIsMinimized(true)
	}, [wizard])

	// Check if current blueprint has unsaved changes
	const currentBlueprintDirty = useMemo(() => {
		const k = wizard.selectedBlueprintKey
		return k ? wizard.getDirtyState(k) : false
	}, [wizard.selectedBlueprintKey, wizard.blueprintDirtyState])

	// Handle save button click
	const [isSaving, setIsSaving] = useState(false)
	const [isSavingAndNext, setIsSavingAndNext] = useState(false)

	const handleSave = useCallback(async () => {
		if (!wizard.currentBlueprintSaveHandler) return false

		setIsSaving(true)
		try {
			const result = await wizard.currentBlueprintSaveHandler()
			return result
		} finally {
			setIsSaving(false)
		}
	}, [wizard.currentBlueprintSaveHandler])

	// Handle save & next button click
	const handleSaveAndNext = useCallback(async () => {
		if (!wizard.currentBlueprintSaveHandler) return

		setIsSavingAndNext(true)
		try {
			const saved = await wizard.currentBlueprintSaveHandler()
			if (saved) {
				wizard.setStep('summary')
			}
		} finally {
			setIsSavingAndNext(false)
		}
	}, [wizard])

	// Handle next button click with unsaved changes check
	const handleNext = useCallback(() => {
		if (hasAnyUnsavedChanges) {
			setShowUnsavedWarningNext(true)
		} else {
			wizard.setStep('summary')
		}
	}, [hasAnyUnsavedChanges, wizard])

	// Confirm proceeding to next step without saving
	const handleConfirmNext = useCallback(() => {
		setShowUnsavedWarningNext(false)
		wizard.setStep('summary')
	}, [wizard])

	// Cancel proceeding to next step
	const handleCancelNext = useCallback(() => {
		setShowUnsavedWarningNext(false)
	}, [])

	return (
		<>
			<Dialog 
				open={wizard.isOpen && !wizard.isMinimized} 
				onOpenChange={(o) => { 
					if (!o) { 
						// If deploying, minimize instead of closing
						if (wizard.isDeploying) {
							wizard.setIsMinimized(true)
						} else {
							wizard.close()
						}
					}
				}}
			>
				<DialogContent className="max-w-[80vw] w-[80vw] h-[85vh] p-0 flex flex-col overflow-hidden">
				{/* Loading Overlay */}
				{wizard.isLoadingModalData && (
					<div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
						<div className="flex flex-col items-center gap-3">
							<Loader2 className="h-8 w-8 animate-spin text-primary" />
							<p className="text-sm text-muted-foreground">Loading modal data...</p>
						</div>
					</div>
				)}
				<DialogHeader className="px-6 py-4 shrink-0">
					<DialogTitle className="flex items-center gap-3">
						{wizard.step === 'mapping' && 'Model Deployment Wizard - Mapping'}
						{wizard.step === 'summary' && (
							<>
								<span>
									{wizard.isDeploying
										? 'Model Deployment - Deploying...'
										: wizard.logLines.length > 0
											? 'Model Deployment - Summary'
											: 'Model Deployment - Summary'}
								</span>
								{!isSummaryLoading && !wizard.isDeploying && wizard.logLines.length === 0 && (
									<StatusBadge label="Ready" tone="grey" icon={IconCircleDashed} />
								)}
								{!isSummaryLoading && wizard.isDeploying && (
									<StatusBadge label="In Progress" tone="orange" icon={IconLoader3} />
								)}
								{!isSummaryLoading && !wizard.isDeploying && wizard.logLines.length > 0 && (
									<StatusBadge label="Complete" tone="green" icon={IconCircleCheckFilled} />
								)}
							</>
						)}
					</DialogTitle>
				</DialogHeader>
				<Separator className="shrink-0" />
				{wizard.step === 'mapping' ? (
					<div className="grid flex-1 min-h-0 grid-cols-[320px_1fr]">
						<aside className="bg-muted/40">
							<ScrollArea className="h-full p-4">
								<BlueprintsSidebar />
							</ScrollArea>
						</aside>
						<main className="flex flex-col min-w-0 min-h-0 flex-1">
							<ScrollArea className="flex-1 min-h-0 p-6">
								<div className="space-y-6 pb-4">
									{/* Database/Schema/Table Selectors */}
									<div className="border-b pb-4">
										<SourceSelectors />
									</div>
									<FieldBindings />
								</div>
							</ScrollArea>
						</main>
					</div>
				) : (
					<div className="flex-1 min-h-0 p-6">
						<DeploymentSummary
							onLoadingChange={setIsSummaryLoading}
							onDeploymentSuccess={onDeploymentSuccess}
						/>
					</div>
				)}
				<Separator className="shrink-0" />
				<div
					className={`flex items-center gap-2 p-4 shrink-0 ${
						wizard.step === 'mapping' ? 'justify-between' : 'justify-end'
					}`}
				>
					{wizard.step === 'mapping' ? (
						<>
							{/* Left side - unsaved changes indicator */}
							<div className="flex items-center gap-2">
								{currentBlueprintDirty && (
									<span className="text-sm font-medium text-amber-600 flex items-center gap-2">
										<Clock className="h-4 w-4" />
										Unsaved changes
									</span>
								)}
							</div>

							{/* Right side - action buttons */}
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										wizard.close()
									}}
									disabled={isSaving || isSavingAndNext}
								>
									Cancel
								</Button>
								{(currentBlueprintDirty || isSaving) && (
									<Button
										variant="default"
										size="sm"
										onClick={handleSave}
										disabled={isSaving || isSavingAndNext}
									>
										{isSaving ? (
											<>
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												Saving...
											</>
										) : (
											'Save'
										)}
									</Button>
								)}
								<Button
									variant="default"
									size="sm"
									onClick={currentBlueprintDirty ? handleSaveAndNext : handleNext}
									disabled={!allBlueprintsMapped || isSaving || isSavingAndNext}
								>
									{isSavingAndNext ? (
										<>
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											Saving...
										</>
									) : currentBlueprintDirty ? (
										'Save & Next'
									) : (
										'Next'
									)}
								</Button>
							</div>
						</>
					) : (
						<>
							{/* During deployment, show Minimize and Cancel buttons */}
							{wizard.isDeploying ? (
								<>
									<Button
										variant="secondary"
										onClick={handleMinimize}
									>
										<Minimize2 className="mr-2 h-4 w-4" />
										Minimize
									</Button>
									<Button
										variant="destructive"
										onClick={handleCancelDeployment}
									>
										Cancel Deployment
									</Button>
								</>
							) : wizard.logLines.length === 0 ? (
								<>
									{/* Before deployment: Cancel, Back, Deploy */}
									<Button
										variant="secondary"
										onClick={() => {
											wizard.close()
										}}
										disabled={wizard.isLoadingModalData || isSummaryLoading}
									>
										Cancel
									</Button>
									<Button
										variant="secondary"
										onClick={() => wizard.setStep('mapping')}
										disabled={wizard.isLoadingModalData || isSummaryLoading}
									>
										Back
									</Button>
									<Button
										onClick={() => handleDeploy()}
										disabled={wizard.isLoadingModalData || isSummaryLoading}
									>
										Deploy
									</Button>
								</>
							) : (
								/* After deployment: only Close button */
								<Button
									onClick={() => {
										queryClient.invalidateQueries()
										wizard.reset()
									}}
								>
									Close
								</Button>
							)}
						</>
					)}
				</div>
				</DialogContent>
			</Dialog>

			{/* Unsaved Changes Warning for Next Step - Separate Dialog to avoid nested portals */}
			<Dialog open={showUnsavedWarningNext} onOpenChange={setShowUnsavedWarningNext}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="h-5 w-5 text-amber-500" />
							Unsaved Changes
						</DialogTitle>
						<DialogDescription>
							You have unsaved changes in one or more blueprints. If you proceed to the next step now, your changes will be lost.
						</DialogDescription>
					</DialogHeader>
					<div className="py-4">
						<p className="text-sm text-muted-foreground">
							Would you like to go back and save your changes, or discard them and continue?
						</p>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={handleCancelNext}>
							Go Back
						</Button>
						<Button variant="destructive" onClick={handleConfirmNext}>
							Discard Changes
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}


