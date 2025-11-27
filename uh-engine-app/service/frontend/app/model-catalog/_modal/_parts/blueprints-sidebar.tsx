'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useModelCatalogWizard } from '@/lib/state/model-catalog-wizard'
import { getModalLoaderData } from '@/lib/api/model-catalog'
import { Check, Clock, Circle, AlertTriangle } from 'lucide-react'

export default function BlueprintsSidebar() {
	const wizard = useModelCatalogWizard()
	const loadedRef = useRef(false)
	const loadedModelIdsRef = useRef<string>('')
	const [showUnsavedWarning, setShowUnsavedWarning] = useState(false)
	const [pendingBlueprintKey, setPendingBlueprintKey] = useState<string | null>(null)

	// Load all modal data using modal loader (only once per modal open)
	useEffect(() => {
		if (!wizard.isOpen || wizard.selectedModelIds.length === 0) return

		// Create a stable key from model IDs
		const modelIdsKey = wizard.selectedModelIds.sort().join(',')

		// Check if data is already in wizard state (e.g., when navigating back from summary)
		// If blueprint catalog and databases are already loaded, skip the loading spinner
		const hasExistingData = wizard.blueprintCatalog.length > 0 && wizard.databasesSchemas.length > 0
		if (hasExistingData) {
			// Data already exists in wizard state, just mark as loaded without showing spinner
			loadedRef.current = true
			loadedModelIdsRef.current = modelIdsKey
			return
		}

		// Skip if already loaded for these models (check refs as secondary check)
		if (loadedRef.current && loadedModelIdsRef.current === modelIdsKey) {
			return
		}

		let cancelled = false
		wizard.setIsLoadingModalData(true)
		;(async () => {
			try {
				const res = await getModalLoaderData(wizard.selectedModelIds)

				if (!cancelled) {
					// Set databases with pre-loaded schemas for bound databases
					const databases = res?.databases || []
					const schemasMap = res?.databases_schemas_map || {}

					// Merge databases with their pre-loaded schemas (if any)
					const databasesSchemas = databases.map((db: string) => ({
						database: db,
						schemas: schemasMap[db] || []  // Use pre-loaded schemas if available
					}))

					wizard.setDatabasesSchemas(databasesSchemas)

					// Set blueprints
					const blueprintsData = res?.blueprints || {}
					const list: any[] = []
					Object.keys(blueprintsData).forEach((source) => {
						;(blueprintsData[source] || []).forEach((bp: any) => list.push(bp))
					})
					wizard.setBlueprintCatalog(list)

					// Store preloaded schema tables
					const schemaTables = res?.schema_tables || {}
					Object.keys(schemaTables).forEach((schemaKey) => {
						wizard.setSchemaTables(schemaKey, schemaTables[schemaKey])
					})

					// Store preloaded table fields
					const tableFields = res?.table_fields || {}
					Object.keys(tableFields).forEach((tableKey) => {
						wizard.setTableFields(tableKey, tableFields[tableKey])
					})

					// Pre-populate blueprint database bindings from blueprint data (don't mark as dirty)
					list.forEach((bp: any) => {
						const key = `${bp.source}.${bp.id || bp.name}`
						const binding_db = bp.binding_db || ''
						const binding_schema = bp.binding_schema || ''
						const binding_table = bp.binding_object || bp.binding_table || ''

						if (binding_db || binding_schema || binding_table) {
							wizard.setDatabaseBinding(key, binding_db, binding_schema, binding_table, false) // Don't mark as dirty during initial load
						}
					})

					// Note: We no longer preload statuses into runtime state
					// Sidebar status is now determined solely from blueprint.mapping_complete
					// Runtime status updates only happen when mappings are saved

					if (list.length > 0 && !wizard.selectedBlueprintKey) {
						const first = list[0]
						if (first?.source && (first?.id || first?.name)) {
							wizard.setSelectedBlueprintKey(`${first.source}.${first.id || first.name}`)
						}
					}

					// Mark as loaded
					loadedRef.current = true
					loadedModelIdsRef.current = modelIdsKey
				}
			} catch (e) {
				wizard.setBlueprintCatalog([])
			} finally {
				if (!cancelled) {
					wizard.setIsLoadingModalData(false)
				}
			}
		})()
		return () => {
			cancelled = true
		}
	}, [wizard.isOpen, wizard.selectedModelIds])

	// Reset loaded flag when modal closes
	useEffect(() => {
		if (!wizard.isOpen) {
			loadedRef.current = false
			loadedModelIdsRef.current = ''
		}
	}, [wizard.isOpen])

	const items = useMemo(() => {
		return (wizard.blueprintCatalog || []).map((bp: any) => {
			const key = `${bp.source}.${bp.id || bp.name}`
			// Use only persisted status from blueprint data (mapping_complete)
			// Status only changes when mapping is saved to the blueprint
			const persistedStatus = bp?.mapping_complete === true ? 'green' : bp?.mapping_complete === false ? 'orange' : 'grey'
			const status = persistedStatus
			const label = String(bp.name || bp.id || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
			return { key, label, status }
		})
	}, [wizard.blueprintCatalog])

	// Handle blueprint selection with unsaved changes check
	const handleBlueprintSelect = (newKey: string) => {
		const currentKey = wizard.selectedBlueprintKey

		// If already on this blueprint, do nothing
		if (currentKey === newKey) return

		// Check if current blueprint has unsaved changes
		const isDirty = currentKey ? wizard.getDirtyState(currentKey) : false

		if (isDirty) {
			// Show warning dialog
			setPendingBlueprintKey(newKey)
			setShowUnsavedWarning(true)
		} else {
			// No unsaved changes, switch immediately
			wizard.setSelectedBlueprintKey(newKey)
		}
	}

	// Confirm switching without saving
	const handleConfirmSwitch = () => {
		if (pendingBlueprintKey) {
			// Clear dirty state for the current blueprint (discarding changes)
			if (wizard.selectedBlueprintKey) {
				wizard.setDirtyState(wizard.selectedBlueprintKey, false)
			}
			// Switch to the new blueprint
			wizard.setSelectedBlueprintKey(pendingBlueprintKey)
		}
		setShowUnsavedWarning(false)
		setPendingBlueprintKey(null)
	}

	// Cancel switching
	const handleCancelSwitch = () => {
		setShowUnsavedWarning(false)
		setPendingBlueprintKey(null)
	}

	if (items.length === 0) {
		return (
			<div className="text-xs text-muted-foreground">No components found.</div>
		)
	}

	return (
		<TooltipProvider>
			<div className="space-y-2">
				<div className="text-sm font-medium">Source Table Mappings</div>
				<div className="space-y-1">
					{items.map((it) => {
						const active = wizard.selectedBlueprintKey === it.key

						// Determine icon and color based on status
						let StatusIcon = Circle
						let iconColor = 'text-muted-foreground/40'
						let tooltipMessage = null

						if (it.status === 'green') {
							StatusIcon = Check
							iconColor = 'text-emerald-500'
						} else if (it.status === 'orange') {
							StatusIcon = Clock
							iconColor = 'text-amber-500'
							tooltipMessage = 'Mapping incomplete: Please map all required fields or set this blueprint as optional'
						}
						// Grey dot (Circle with text-muted-foreground/40) is default for everything else

						const buttonContent = (
							<Button
								key={it.key}
								variant={active ? 'secondary' : 'ghost'}
								className="w-full justify-between"
								onClick={() => handleBlueprintSelect(it.key)}
							>
								<span className="truncate text-left">{it.label}</span>
								<StatusIcon className={`ml-3 h-4 w-4 ${iconColor}`} />
							</Button>
						)

						// Wrap orange status items with tooltip
						if (tooltipMessage) {
							return (
								<Tooltip key={it.key}>
									<TooltipTrigger asChild>
										{buttonContent}
									</TooltipTrigger>
									<TooltipContent>
										<p className="max-w-xs">{tooltipMessage}</p>
									</TooltipContent>
								</Tooltip>
							)
						}

						return buttonContent
					})}
				</div>
			</div>

			{/* Unsaved Changes Warning Dialog */}
			<Dialog open={showUnsavedWarning} onOpenChange={setShowUnsavedWarning}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AlertTriangle className="h-5 w-5 text-amber-500" />
							Unsaved Changes
						</DialogTitle>
						<DialogDescription>
							You have unsaved changes in the current blueprint. If you switch to another blueprint now, your changes will be lost.
						</DialogDescription>
					</DialogHeader>
					<div className="py-4">
						<p className="text-sm text-muted-foreground">
							Would you like to go back and save your changes, or discard them and continue?
						</p>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={handleCancelSwitch}>
							Go Back
						</Button>
						<Button variant="destructive" onClick={handleConfirmSwitch}>
							Discard Changes
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</TooltipProvider>
	)
}


