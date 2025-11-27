'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useModelCatalogWizard } from '@/lib/state/model-catalog-wizard'
import { listTables, getBlueprintBindings, updateBlueprintBindings } from '@/lib/api/model-catalog'
import DbSchemaCombobox from './db-schema-combobox'
import { useToast } from '@/hooks/use-toast'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'

function normalizeName(item: any): string {
	if (typeof item === 'string') return item
	if (item?.name) return item.name
	if (item?.database) return item.database
	if (item?.database_name) return item.database_name
	return String(item || '').toUpperCase()
}

export default function SourceSelectors() {
	const wizard = useModelCatalogWizard()
	const k = wizard.selectedBlueprintKey
	const queryClient = useQueryClient()
	const { toast } = useToast()

	const [tables, setTables] = useState<string[]>([])
	const [tableOpen, setTableOpen] = useState(false)
	const [pendingTable, setPendingTable] = useState<string | null>(null)
	const [showConfirmDialog, setShowConfirmDialog] = useState(false)
	const [isClearing, setIsClearing] = useState(false)

	const binding = wizard.blueprintDatabaseBindings[k || ''] || { db: '', schema: '', table: '' }

	// Load blueprint bindings to check if there are existing bindings
	const { data: blueprintBindingsData } = useQuery({
		queryKey: ['blueprint-bindings', k],
		queryFn: async () => {
			if (!k) return null
			const [source, name] = k.split('.')
			const res = await getBlueprintBindings(source, name)
			return res?.bindings || res
		},
		enabled: !!k,
	})

	// Helper function to check if there are existing bindings
	const hasExistingBindings = () => {
		if (!k) return false
		
		// Check 1: If there are bindings in local state (user modifications)
		const bindingKeys = Object.keys(wizard.bindingMappings)
		const hasLocalBindings = bindingKeys.some((key) => {
			const value = wizard.bindingMappings[key]
			return value && typeof value === 'string' && value.trim() !== '' && value !== '__none__'
		})
		if (hasLocalBindings) {
			return true
		}
		
		// Check 2: If there are bindings from server data (actual field bindings, not just table selection)
		if (blueprintBindingsData) {
			// Check if any fields have bindings
			const hasColumnBindings = (blueprintBindingsData.columns || []).some((col: any) => 
				col.binding && col.binding.trim() !== ''
			)
			const hasPrimaryNodeBindings = blueprintBindingsData.primary_node?.bindings?.some((b: any) => 
				b.binding && b.binding.trim() !== ''
			)
			const hasSecondaryNodeBindings = (blueprintBindingsData.secondary_nodes || []).some((node: any) =>
				(node.bindings || []).some((b: any) => b.binding && b.binding.trim() !== '')
			)
			const hasTablePkBindings = (blueprintBindingsData.table_pk || []).some((pk: any) =>
				pk.binding && pk.binding.trim() !== ''
			)
			const hasIngestTimeBinding = (blueprintBindingsData.ingest_time_binding && blueprintBindingsData.ingest_time_binding.trim() !== '') || 
				(blueprintBindingsData.ingest_time && blueprintBindingsData.ingest_time.trim() !== '')
			
			if (hasColumnBindings || hasPrimaryNodeBindings || hasSecondaryNodeBindings || hasTablePkBindings || hasIngestTimeBinding) {
				return true
			}
		}
		
		// No actual field bindings found - just having a table selected doesn't count as having bindings
		return false
	}

	// Reset tables when blueprint key changes
	useEffect(() => {
		if (!k) { setTables([]) }
	}, [k])

	// Load tables when schema changes (check wizard cache first, then use FAST API)
	useEffect(() => {
		let cancelled = false
		if (!k || !binding.db || !binding.schema) { setTables([]); return }

		const schemaKey = `${binding.db.toUpperCase()}.${binding.schema.toUpperCase()}`

		// Check wizard cache first (from modal_loader)
		const cachedTables = wizard.schemaTables[schemaKey]
		if (cachedTables && cachedTables.length > 0) {
			console.log(`✓ Using cached tables for ${schemaKey} (${cachedTables.length} tables)`)
			const tableNames = cachedTables.map((t: any) => String(t.name || t.TABLE_NAME).toUpperCase())
			setTables(tableNames)
			return
		}

		// If not in cache, fetch tables
		;(async () => {
			try {
				const startTime = performance.now()
				console.log(`⚡ Fetching tables for ${schemaKey}...`)

				const result = await listTables(binding.db, binding.schema)
				const clientElapsed = performance.now() - startTime

				if (!cancelled) {
					const tableNames = (result.data || []).map((t: any) => String(t.name || t).toUpperCase())
					setTables(tableNames)

					// Store in wizard cache for future use
					wizard.setSchemaTables(schemaKey, (result.data || []).map((t: any) => ({ name: t.name || t })))

					console.log(`✓ Loaded ${tableNames.length} tables in ${Math.round(clientElapsed)}ms total`)
				}
			} catch (e) {
				console.error('❌ Error loading tables:', e)
				if (!cancelled) setTables([])
			}
		})()
		return () => { cancelled = true }
	}, [k, binding.db, binding.schema, wizard.schemaTables])

	return (
		<div className="grid gap-3 sm:grid-cols-2">
			<div className="grid gap-1">
				<DbSchemaCombobox
					value={{ db: binding.db || '', schema: binding.schema || '' }}
					onChange={(v) => wizard.setDatabaseBinding(k, v.db, v.schema, '')}
					disabled={!k}
				/>
			</div>
			<div className="grid gap-1">
				<Label className="text-xs">Table</Label>
				<Popover open={tableOpen} onOpenChange={setTableOpen}>
					<PopoverTrigger asChild>
						<Button
							variant="outline"
							role="combobox"
							aria-expanded={tableOpen}
							disabled={!binding.db || !binding.schema}
							className="w-full justify-between"
						>
							{binding.table || 'Select table...'}
							<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-[300px] p-0">
						<Command>
							<CommandInput placeholder="Search table..." className="focus:ring-0 focus-visible:ring-0 focus:outline-none focus-visible:outline-none focus:shadow-none focus-visible:shadow-none" />
							<CommandList className="max-h-[300px] overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
								<CommandEmpty>No tables found.</CommandEmpty>
								<CommandGroup>
									{tables.map((table) => (
										<CommandItem
											key={table}
											value={table}
											onSelect={() => {
												// Check if switching to a different table and if there are existing bindings
												if (table !== binding.table && hasExistingBindings()) {
													// Store the pending table and show confirmation dialog
													setPendingTable(table)
													setShowConfirmDialog(true)
													setTableOpen(false)
												} else {
													// No bindings or same table, proceed with switch
													wizard.setDatabaseBinding(k, binding.db, binding.schema, table)
													setTableOpen(false)
												}
											}}
										>
											<Check className={cn('mr-2 h-4 w-4', binding.table === table ? 'opacity-100' : 'opacity-0')} />
											{table}
										</CommandItem>
									))}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			</div>

			{/* Confirmation Dialog */}
			<Dialog open={showConfirmDialog} onOpenChange={(open) => {
				if (!open) {
					// Dialog is being closed - cancel the operation
					setShowConfirmDialog(false)
					setPendingTable(null)
				} else {
					setShowConfirmDialog(open)
				}
			}}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Clear Field Bindings?</DialogTitle>
						<DialogDescription>
							Switching to a different table will clear all existing field bindings for this blueprint. 
							You will need to map the fields again for the new table.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setShowConfirmDialog(false)
								setPendingTable(null)
							}}
						>
							Cancel
						</Button>
						<Button
							variant="default"
							disabled={isClearing}
							onClick={async () => {
								if (pendingTable && k && blueprintBindingsData) {
									setIsClearing(true)
									try {
										const [source, blueprintName] = k.split('.')
										
										// Clear all field bindings by setting them to empty strings
										const clearedPk = (blueprintBindingsData.table_pk || []).map((pk: any) => ({
											...pk,
											binding: '',
										}))
										
										const clearedPrimaryNode = blueprintBindingsData.primary_node
											? {
												...blueprintBindingsData.primary_node,
												bindings: (blueprintBindingsData.primary_node.bindings || []).map((b: any) => ({
													...b,
													binding: '',
												})),
											}
											: undefined
										
										const clearedSecondaryNodes = (blueprintBindingsData.secondary_nodes || []).map((node: any) => ({
											...node,
											bindings: (node.bindings || []).map((b: any) => ({
												...b,
												binding: '',
											})),
										}))
										
										const clearedColumns = (blueprintBindingsData.columns || []).map((col: any) => ({
											...col,
											binding: '',
										}))
										
										// Build payload with cleared bindings and new table
										const payload: Record<string, any> = {
											binding_db: binding.db || '',
											binding_schema: binding.schema || '',
											binding_object: pendingTable, // New table
											table_pk: clearedPk,
											secondary_nodes: clearedSecondaryNodes,
											columns: clearedColumns,
											mapping_complete: false,
										}
										
										if (clearedPrimaryNode) {
											payload.primary_node = clearedPrimaryNode
										}
										
										// Always clear ingest_time_binding if ingest_time is configured
										if (blueprintBindingsData.ingest_time || blueprintBindingsData.ingest_time_binding) {
											payload.ingest_time_binding = ''
										}
										
										// Update bindings on server
										await updateBlueprintBindings(source, blueprintName, payload)
										
										// Clear local bindings state
										wizard.clearBlueprintBindings(k)
										
										// Switch to the new table
										wizard.setDatabaseBinding(k, binding.db, binding.schema, pendingTable)
										
										// Invalidate and refetch query cache so field-bindings reloads with cleared data
										await queryClient.invalidateQueries({ queryKey: ['blueprint-bindings', k] })
										await queryClient.refetchQueries({ queryKey: ['blueprint-bindings', k] })
										
										// Update blueprint catalog status
										wizard.setBlueprintCatalog(
											wizard.blueprintCatalog.map((bp: any) => {
												const bpKey = `${bp.source}.${bp.id || bp.name}`
												if (bpKey === k) {
													return { ...bp, mapping_complete: false }
												}
												return bp
											})
										)
										
										toast({
											title: 'Bindings cleared',
											description: 'All field bindings have been cleared. Please map fields for the new table.',
										})
										
										setShowConfirmDialog(false)
										setPendingTable(null)
									} catch (error: any) {
										const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to clear bindings'
										toast({
											title: 'Error',
											description: errorMessage,
											variant: 'destructive',
										})
									} finally {
										setIsClearing(false)
									}
								}
							}}
						>
							{isClearing ? 'Clearing...' : 'Clear and Switch'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}


