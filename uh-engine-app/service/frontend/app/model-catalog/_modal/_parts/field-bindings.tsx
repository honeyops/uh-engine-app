'use client'

import React, { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CheckCircle2, XCircle, AlertCircle, Check, Clock, ChevronsUpDown, X, Pencil, Plus, Loader2, Info } from 'lucide-react'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useModelCatalogWizard } from '@/lib/state/model-catalog-wizard'
import { getBlueprintBindings, listColumnsCached, updateBlueprintBindings, listTables } from '@/lib/api/model-catalog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

interface BlueprintField {
	fieldName: string
	fieldType: 'primary' | 'secondary' | 'attribute' | 'ingest_time'
	binding: string
	category: string // 'table_pk', 'primary_node', 'secondary_node', 'columns', 'ingest_time'
	node?: string // For secondary nodes
	bindingName?: string // For individual binding names within a node
	isSubheading?: boolean // Flag to identify subheading rows
	bindingIndex?: number // Track position in multi-binding nodes
}

// Multi-select component for column bindings - memoized for performance
const MultiSelectCombo = React.memo(function MultiSelectCombo({
	selectedValues,
	options,
	onChange,
	disabled,
	placeholder = 'Select columns...',
}: {
	selectedValues: string[]
	options: { name: string; display: string; type?: string }[]
	onChange: (values: string[]) => void
	disabled?: boolean
	placeholder?: string
}) {
	const [open, setOpen] = useState(false)

	const toggleOption = useCallback((value: string) => {
		if (selectedValues.includes(value)) {
			onChange(selectedValues.filter((v) => v !== value))
		} else {
			onChange([...selectedValues, value])
		}
	}, [onChange, selectedValues])

	const removeValue = useCallback((value: string) => {
		onChange(selectedValues.filter((v) => v !== value))
	}, [onChange, selectedValues])

	// Memoize filtered options
	const filteredOptions = useMemo(() =>
		options.filter((opt) => opt.name !== '__none__'),
		[options]
	)

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					disabled={disabled}
					className="w-full justify-between h-auto min-h-[2.5rem] py-1 px-3"
				>
					<div className="flex flex-wrap gap-1 flex-1">
						{selectedValues.length === 0 ? (
							<span className="text-muted-foreground">{placeholder}</span>
						) : (
							selectedValues.map((value) => {
								const option = options.find((opt) => opt.name === value)
								return (
									<Badge
										key={value}
										variant="secondary"
										className="mr-1 px-2 py-0.5 text-xs flex items-center gap-1"
									>
										{option?.display || value}
										<button
											onClick={(e) => {
												e.stopPropagation()
												removeValue(value)
											}}
											className="ml-1 hover:bg-gray-300 rounded-full"
										>
											<X className="h-3 w-3" />
										</button>
									</Badge>
								)
							})
						)}
					</div>
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[400px] p-0" align="start">
				<Command>
					<CommandInput placeholder="Search columns..." />
					<CommandList>
						<CommandEmpty>No columns found.</CommandEmpty>
						<CommandGroup>
							{filteredOptions.map((option) => (
								<CommandItem
									key={option.name}
									onSelect={() => toggleOption(option.name)}
									className="cursor-pointer"
								>
									<Checkbox
										checked={selectedValues.includes(option.name)}
										className="mr-2"
									/>
									{option.display}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	)
})

function sanitizeBindingValue(value: unknown): string {
	if (value === null || value === undefined) return ''
	return String(value).trim()
}

function canonicalizeColumnName(value: unknown): string {
	return sanitizeBindingValue(value).toUpperCase()
}

// Convert display format (e.g., "Material Category") to snake_case (e.g., "material_category")
function toSnakeCase(value: string): string {
	return value
		.trim()
		.replace(/\s+/g, '_')
		.replace(/[A-Z]/g, (letter, index) => {
			return index === 0 ? letter.toLowerCase() : '_' + letter.toLowerCase()
		})
		.replace(/__+/g, '_')
		.toLowerCase()
}

// Convert snake_case (e.g., "material_category") to display format (e.g., "Material Category")
function toDisplayFormat(value: string): string {
	return value
		.toLowerCase() // First convert to lowercase
		.replace(/_/g, ' ') // Replace underscores with spaces
		.replace(/\b\w/g, (m: string) => m.toUpperCase()) // Uppercase first letter of each word
}

function normalizeDataType(dataType: string): string {
	if (!dataType) return ''
	const type = dataType.toLowerCase().trim()
	if (type.includes('varchar') || type.includes('char') || type.includes('text') || type.includes('string') || type === 'str') {
		return 'string'
	}
	if (type.includes('int') || type.includes('integer') || type.includes('number') || type.includes('numeric') || type.includes('decimal') || type.includes('float') || type.includes('double') || type.includes('bigint') || type.includes('smallint')) {
		return 'number'
	}
	if (type.includes('timestamp') || type.includes('datetime') || type.includes('date') || type.includes('time')) {
		return 'datetime'
	}
	if (type.includes('bool') || type.includes('bit')) {
		return 'boolean'
	}
	return type
}

// Format data type for display - simplifies and capitalizes (e.g., "number(18,4)" -> "Number")
function formatDataTypeForDisplay(dataType: string): string {
	if (!dataType) return ''
	const normalized = normalizeDataType(dataType)
	if (!normalized) return ''
	// Capitalize first letter
	return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export default function FieldBindings() {
	const wizard = useModelCatalogWizard()
	const k = wizard.selectedBlueprintKey

	const binding = wizard.blueprintDatabaseBindings[k || ''] || { db: '', schema: '', table: '' }

	const [isSaving, setIsSaving] = useState(false)
	const [editingAlias, setEditingAlias] = useState<string | null>(null)
	const [aliasValue, setAliasValue] = useState<string>('')
	const [newRows, setNewRows] = useState<Array<{id: string, sourceColumn: string, modelField: string, dataType: string}>>([])
	const [savingRowId, setSavingRowId] = useState<string | null>(null)
	const [openInfoModal, setOpenInfoModal] = useState<'keyMappings' | 'tableMeta' | 'columnMapping' | 'deleteCondition' | 'whereClause' | null>(null)
	const isProcessingBindingRef = useRef(false)
	const processedBindingKeyRef = useRef<string>('')
	const prevBindingMappingsRef = useRef<string>('')
	const prevBindingRef = useRef<{ db: string; schema: string; table: string }>({ db: '', schema: '', table: '' })
	const initialLoadCompleteRef = useRef(false)

	const { toast } = useToast()
	const queryClient = useQueryClient()
	
	// Get stable references to wizard setters
	const setDatabaseBinding = wizard.setDatabaseBinding
	const setBlueprintStatus = wizard.setBlueprintStatus

	// Load blueprint bindings (with caching to avoid re-fetching)
	const { data: blueprintBindingsData, refetch: refetchBlueprintBindings } = useQuery({
		queryKey: ['blueprint-bindings', k],
		queryFn: async () => {
			if (!k) return null

			// Check cache first
			const cached = wizard.blueprintBindingsCache[k]
			if (cached) {
				console.log(`Using cached bindings for ${k}`)
				return cached
			}

			// Fetch from server and cache
			console.log(`Fetching bindings from server for ${k}`)
			const [source, name] = k.split('.')
			const res = await getBlueprintBindings(source, name)
			const data = res?.bindings || res

			// Cache the result
			wizard.setBlueprintBindingsCache(k, data)

			// Clear dirty state since this is fresh data from server
			wizard.setDirtyState(k, false)

			return data
		},
		enabled: !!k,
		staleTime: Infinity, // Never consider cache stale
		cacheTime: Infinity, // Keep in cache forever
	})

	// Default database/schema/table from bindings when present
	useEffect(() => {
		if (!k || !blueprintBindingsData || isProcessingBindingRef.current) return;

		const incomingDb = String(blueprintBindingsData.binding_db || '').toUpperCase();
		const incomingSchema = String(blueprintBindingsData.binding_schema || '').toUpperCase();
		const incomingTable = String(blueprintBindingsData.binding_object || '').toUpperCase();

		// Create a unique key for this binding attempt
		const bindingKey = `${k}:${incomingDb}:${incomingSchema}:${incomingTable}`;

		// Skip if we've already processed this exact binding
		if (processedBindingKeyRef.current === bindingKey) {
			return;
		}

		// Check if binding is already set to avoid unnecessary API calls
		if (binding.db === incomingDb && binding.schema === incomingSchema && binding.table === incomingTable) {
			processedBindingKeyRef.current = bindingKey;
			return; // Already set correctly
		}

		// If we don't have all three parts, don't proceed
		if (!incomingDb || !incomingSchema || !incomingTable) {
			return;
		}

		// Reset processed key if blueprint key changed
		if (processedBindingKeyRef.current && !processedBindingKeyRef.current.startsWith(k + ':')) {
			processedBindingKeyRef.current = '';
		}

		isProcessingBindingRef.current = true;
		processedBindingKeyRef.current = bindingKey;

		// Use cached data from wizard (loaded by modal_loader)
		const dbSchemas = wizard.databasesSchemas;
		const dbExists = dbSchemas.some((db: { database: string; schemas: string[] }) => db.database.toUpperCase() === incomingDb);
		if (!dbExists) {
			isProcessingBindingRef.current = false;
			return;
		}

		const schemaExists = dbSchemas.some((db: { database: string; schemas: string[] }) =>
			db.database.toUpperCase() === incomingDb && db.schemas.some((s: string) => s.toUpperCase() === incomingSchema)
		);
		if (!schemaExists) {
			setDatabaseBinding(k, incomingDb, '', '', false); // Don't mark as dirty when loading initial data
			isProcessingBindingRef.current = false;
			return;
		}

		// Check cached tables
		const schemaKey = `${incomingDb}.${incomingSchema}`;
		const cachedTables = wizard.schemaTables[schemaKey];
		const tables = cachedTables ? cachedTables.map((t: any) => String(t.name || t.TABLE_NAME).toUpperCase()) : [];
		const tableExists = tables.includes(incomingTable);

		if (tableExists) {
			setDatabaseBinding(k, incomingDb, incomingSchema, incomingTable, false); // Don't mark as dirty when loading initial data
		} else {
			setDatabaseBinding(k, incomingDb, incomingSchema, '', false); // Don't mark as dirty when loading initial data
		}

		isProcessingBindingRef.current = false;
	}, [k, blueprintBindingsData, setDatabaseBinding, wizard.databasesSchemas, wizard.schemaTables]);

	// Track the last blueprint key to detect blueprint switches
	const prevBlueprintKeyRef = useRef<string>('')

		// Migrate old-format secondary node bindings to new format and load delete_condition/where_clause
		useEffect(() => {
		if (!k || !blueprintBindingsData) return

		// Check if we switched to a different blueprint
		const blueprintChanged = prevBlueprintKeyRef.current !== k

		// Migrate old combined-format bindings to individual binding keys
		// Group nodes by node name first to avoid processing duplicates
		const nodesByNodeName = new Map<string, any>()
		;(blueprintBindingsData.secondary_nodes || []).forEach((node: any) => {
			if (!node.node) return
			if (!nodesByNodeName.has(node.node)) {
				nodesByNodeName.set(node.node, node)
			}
		})
		
		nodesByNodeName.forEach((node: any) => {
			const combinedBindingKey = `secondary_${node.node}`
			const hasCombinedBinding = combinedBindingKey in wizard.bindingMappings
			
			// If we have a combined binding (old format), split it into individual bindings
			if (hasCombinedBinding && node.bindings && node.bindings.length > 0) {
				const combinedBinding = wizard.bindingMappings[combinedBindingKey]
				if (combinedBinding && typeof combinedBinding === 'string' && combinedBinding.trim()) {
					const bindingValues = combinedBinding.split(',').map((v: string) => v.trim().toUpperCase()).filter(Boolean)
					
					wizard.setBindingMappings((prev) => {
						const updated = { ...prev }
						// Split combined binding into individual keys
						node.bindings.forEach((b: any, index: number) => {
							const individualKey = `secondary_${node.node}_${b.name}`
							const bindingValue = index < bindingValues.length ? bindingValues[index] : (b.binding || '')
							updated[individualKey] = canonicalizeColumnName(bindingValue)
						})
						// Remove combined binding key
						delete updated[combinedBindingKey]
						return updated
					}, false) // Don't mark as dirty during migration
				}
			}
		})

		if (blueprintChanged) {
			// Blueprint switched - always load values from the new blueprint (don't mark as dirty)
			wizard.setBindingMappings((prev) => ({
				...prev,
				delete_condition: blueprintBindingsData.delete_condition || '',
				where_clause: blueprintBindingsData.where_clause || '',
			}), false)
			prevBlueprintKeyRef.current = k
		} else {
			// Same blueprint - only set if not already in bindingMappings (to avoid overwriting user changes)
			const currentDeleteCondition = wizard.bindingMappings['delete_condition']
			const currentWhereClause = wizard.bindingMappings['where_clause']

			if (!currentDeleteCondition && blueprintBindingsData.delete_condition) {
				wizard.setBindingMappings((prev) => ({
					...prev,
					delete_condition: blueprintBindingsData.delete_condition,
				}), false)
			}

			if (!currentWhereClause && blueprintBindingsData.where_clause) {
				wizard.setBindingMappings((prev) => ({
					...prev,
					where_clause: blueprintBindingsData.where_clause,
				}), false)
			}
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [k, blueprintBindingsData])

	// Load table columns when table is selected (check cache first)
	const { data: columnsData } = useQuery({
		queryKey: ['table-columns', binding.db, binding.schema, binding.table],
		queryFn: async () => {
			if (!binding.db || !binding.schema || !binding.table) return []

			// Check wizard cache first (from modal_loader)
			const tableKey = `${binding.db.toUpperCase()}.${binding.schema.toUpperCase()}.${binding.table.toUpperCase()}`
			const cachedFields = wizard.tableFields[tableKey]

			if (cachedFields && cachedFields.length > 0) {
				console.log(`Using cached fields for ${tableKey}`)
				return cachedFields
			}

			// If not in cache, fetch and cache
			console.log(`Fetching fields for ${tableKey}`)
			const fields = await listColumnsCached(binding.db, binding.schema, binding.table)
			wizard.setTableFields(tableKey, fields)
			return fields
		},
		enabled: !!(binding.db && binding.schema && binding.table),
	})

	const tableColumns = columnsData || []

	// Memoize available options for multi-select to avoid recalculating on every render
	const availableColumnsForMultiSelect = useMemo(() => {
		return tableColumns.map((col: any) => {
			const rawName = col.name || col.column_name || String(col)
			const name = canonicalizeColumnName(rawName)
			return {
				name,
				type: col.type || col.data_type || '',
				display: rawName, // Remove data type from display
			}
		})
	}, [tableColumns])

	// Get columns used by nodes (primary/secondary) - nodes can bind to any column
	const columnsUsedByNodes = useMemo(() => {
		const used = new Set<string>()

		// Add columns from existing node bindings (includes user-modified mappings)
		Object.entries(wizard.bindingMappings).forEach(([key, value]) => {
			// Only track primary and secondary node bindings
			if (key.startsWith('primary_') || key.startsWith('secondary_')) {
				if (typeof value === 'string' && value) {
					// Handle both single and multi-select (comma-separated)
					value.split(',').forEach((v) => {
						const canonical = canonicalizeColumnName(v.trim())
						if (canonical) used.add(canonical)
					})
				}
			}
		})

		// Add columns from blueprint data (default bindings that haven't been modified)
		if (blueprintBindingsData) {
			// Add columns from primary node
			if (blueprintBindingsData.primary_node?.bindings) {
				blueprintBindingsData.primary_node.bindings.forEach((b: any) => {
					const bindingKey = `primary_${b.name}`
					if (!(bindingKey in wizard.bindingMappings)) {
						const binding = b.binding || ''
						binding.split(',').forEach((v: string) => {
							const canonical = canonicalizeColumnName(v.trim())
							if (canonical) used.add(canonical)
						})
					}
				})
			}

			// Add columns from secondary nodes (using individual binding keys)
			;(blueprintBindingsData.secondary_nodes || []).forEach((node: any) => {
				;(node.bindings || []).forEach((b: any) => {
					const bindingKey = `secondary_${node.node}_${b.name}`
					if (!(bindingKey in wizard.bindingMappings)) {
						const binding = b.binding || ''
						const canonical = canonicalizeColumnName(binding.trim())
						if (canonical) used.add(canonical)
					}
				})
			})
		}

		return used
	}, [wizard.bindingMappings, blueprintBindingsData])

	// Get columns used by data columns - data columns cannot bind to columns used by nodes or other data columns
	const columnsUsedByDataColumns = useMemo(() => {
		const used = new Set<string>()

		// Add columns from existing data column bindings (includes user-modified mappings)
		Object.entries(wizard.bindingMappings).forEach(([key, value]) => {
			// Only track data column bindings
			if (key.startsWith('column_')) {
				if (typeof value === 'string' && value) {
					const canonical = canonicalizeColumnName(value.trim())
					if (canonical) used.add(canonical)
				}
			}
		})

		// Add columns from blueprint data (default bindings that haven't been modified)
		if (blueprintBindingsData) {
			;(blueprintBindingsData.columns || []).forEach((col: any) => {
				const bindingKey = `column_${col.name}`
				// Only add if not already in wizard.bindingMappings (to avoid duplicates)
				if (!(bindingKey in wizard.bindingMappings)) {
					const binding = canonicalizeColumnName(col.binding)
					if (binding) used.add(binding)
				}
			})
		}

		// Add columns from new rows
		newRows.forEach((row) => {
			if (row.sourceColumn) {
				const canonical = canonicalizeColumnName(row.sourceColumn)
				if (canonical) used.add(canonical)
			}
		})

		return used
	}, [wizard.bindingMappings, newRows, blueprintBindingsData])

	// Get options for a new row combobox (ensures current selection is always visible)
	const getOptionsForNewRow = useCallback((currentValue: string) => {
		const canonicalCurrent = canonicalizeColumnName(currentValue)
		const availableColumns = tableColumns.filter((col: any) => {
			const rawName = col.name || col.column_name || String(col)
			const colName = canonicalizeColumnName(rawName)
			// Always include the currently selected column
			if (colName === canonicalCurrent) return true
			// Data columns cannot bind to columns used by nodes or other data columns
			return !columnsUsedByNodes.has(colName) && !columnsUsedByDataColumns.has(colName)
		})

		const options = [
			{ name: '__none__', type: '', display: '-- Select Column --' },
			...availableColumns.map((col: any) => {
				const rawName = col.name || col.column_name || String(col)
				const name = canonicalizeColumnName(rawName) || canonicalizeColumnName(col)
				return {
					name,
					type: col.type || col.data_type || '',
					display: rawName,
				}
			}),
		]

		// If current value exists but wasn't found in available columns, add it
		if (canonicalCurrent && !options.some((opt) => opt.name === canonicalCurrent)) {
			const col = tableColumns.find((c: any) => {
				const rawName = c.name || c.column_name || String(c)
				return canonicalizeColumnName(rawName) === canonicalCurrent
			})
			const rawName = col?.name || col?.column_name || canonicalCurrent
			options.splice(1, 0, {
				name: canonicalCurrent,
				type: col?.type || col?.data_type || '',
				display: rawName,
			})
		}

		return options
	}, [tableColumns, columnsUsedByNodes, columnsUsedByDataColumns])

	// Build fields array from blueprint bindings, grouped by section
	const fieldGroups = useMemo(() => {
		if (!blueprintBindingsData) return { keyMappings: [], tableMeta: [], blueprintColumns: [] }

		const keyMappings: BlueprintField[] = []
		const tableMeta: BlueprintField[] = []
		const blueprintColumns: BlueprintField[] = []

		const availableColumns = new Set(tableColumns.map((c: any) => canonicalizeColumnName(c.name || c.column_name || String(c))))

		// Section 1: Key Mappings (Primary and Secondary Nodes)
		// Primary node bindings - always show subheading
		if (blueprintBindingsData.primary_node?.bindings) {
			const primaryBindings = blueprintBindingsData.primary_node.bindings || []
			const primaryNodeName = blueprintBindingsData.primary_node.node || 'primary'
			
			// Always add subheading row (only show bracketed suffix if multiple bindings)
			keyMappings.push({
				fieldName: primaryNodeName,
				fieldType: 'primary',
				binding: '',
				category: 'primary_node',
				isSubheading: true,
			})
			
			// Add individual binding rows
			primaryBindings.forEach((b: any, index: number) => {
				const bindingKey = `primary_${b.name}`
				const hasStoredBinding = bindingKey in wizard.bindingMappings
				const storedBinding = canonicalizeColumnName(wizard.bindingMappings[bindingKey] || '')
				const fallbackBinding = canonicalizeColumnName(b.binding || '')
				const currentBinding = hasStoredBinding ? storedBinding : fallbackBinding
				
				keyMappings.push({
					fieldName: b.name,
					fieldType: 'primary',
					binding: currentBinding,
					category: 'primary_node',
					bindingName: b.name,
					bindingIndex: index,
				})
			})
		}

		// Secondary nodes bindings - handle multiple bindings with subheadings
		// Group nodes by node name to handle any duplicates in the data
		const nodesByNodeName = new Map<string, any>()
		;(blueprintBindingsData.secondary_nodes || []).forEach((node: any) => {
			if (!node.node) return
			
			// If we've seen this node before, merge bindings
			if (nodesByNodeName.has(node.node)) {
				const existingNode = nodesByNodeName.get(node.node)!
				// Merge bindings arrays
				const existingBindings = existingNode.bindings || []
				const newBindings = node.bindings || []
				// Combine bindings, avoiding duplicates by name
				const combinedBindings = [...existingBindings]
				newBindings.forEach((newB: any) => {
					if (!existingBindings.some((existingB: any) => existingB.name === newB.name)) {
						combinedBindings.push(newB)
					}
				})
				nodesByNodeName.set(node.node, {
					...existingNode,
					bindings: combinedBindings,
				})
			} else {
				nodesByNodeName.set(node.node, node)
			}
		})
		
		// Process each unique node
		const processedSecondaryNodes = new Set<string>()
		nodesByNodeName.forEach((node: any) => {
			// Skip if already processed
			if (processedSecondaryNodes.has(node.node)) {
				return
			}
			processedSecondaryNodes.add(node.node)
			
			const nodeBindings = node.bindings || []
			
			// Always add subheading row (only show bracketed suffix if multiple bindings)
			keyMappings.push({
				fieldName: node.node,
				fieldType: 'secondary',
				binding: '',
				category: 'secondary_node',
				node: node.node,
				isSubheading: true,
			})
			
			// Add individual binding rows
			nodeBindings.forEach((b: any, index: number) => {
				const bindingKey = `secondary_${node.node}_${b.name}`
				const hasStoredBinding = bindingKey in wizard.bindingMappings
				const storedBinding = canonicalizeColumnName(wizard.bindingMappings[bindingKey] || '')
				const fallbackBinding = canonicalizeColumnName(b.binding || '')
				const currentBinding = hasStoredBinding ? storedBinding : fallbackBinding
				
				keyMappings.push({
					fieldName: b.name,
					fieldType: 'secondary',
					binding: currentBinding,
					category: 'secondary_node',
					node: node.node,
					bindingName: b.name,
					bindingIndex: index,
				})
			})
		})

		// Section 2: Table Meta (TABLE_PK and INGEST_TIME_BINDING)
		// Table PK fields - always show subheading
		const tablePkFields = blueprintBindingsData.table_pk || []
		if (tablePkFields.length > 0) {
			// Always add subheading row (only show bracketed suffix if multiple PK fields)
			tableMeta.push({
				fieldName: 'Primary Key',
				fieldType: 'primary',
				binding: '',
				category: 'table_pk',
				isSubheading: true,
			})
			
			// Add individual PK field rows
			tablePkFields.forEach((pk: any, index: number) => {
				const bindingKey = `table_pk_${pk.name}`
				const hasStoredBinding = bindingKey in wizard.bindingMappings
				const storedBinding = canonicalizeColumnName(wizard.bindingMappings[bindingKey] || '')
				const fallbackBinding = canonicalizeColumnName(pk.binding || '')
				const currentBinding = hasStoredBinding ? storedBinding : fallbackBinding
				
				tableMeta.push({
					fieldName: pk.name,
					fieldType: 'primary',
					binding: currentBinding,
					category: 'table_pk',
					bindingName: pk.name,
					bindingIndex: index,
				})
			})
		}

		// Ingest time field (if present)
		if (blueprintBindingsData.ingest_time) {
			const bindingKey = 'ingest_time'
			const hasStoredBinding = bindingKey in wizard.bindingMappings
			const storedBinding = canonicalizeColumnName(wizard.bindingMappings[bindingKey])
			const fallbackBinding = canonicalizeColumnName(blueprintBindingsData.ingest_time_binding || blueprintBindingsData.ingest_time)
			const currentBinding = hasStoredBinding ? storedBinding : fallbackBinding
			tableMeta.push({
				fieldName: 'ingest_time',
				fieldType: 'ingest_time',
				binding: currentBinding,
				category: 'ingest_time',
			})
		}

		// Section 3: Blueprint Columns (Attributes)
		;(blueprintBindingsData.columns || []).forEach((col: any) => {
			const bindingKey = `column_${col.name}`
			const hasStoredBinding = bindingKey in wizard.bindingMappings
			const storedBinding = canonicalizeColumnName(wizard.bindingMappings[bindingKey])
			const fallbackBinding = canonicalizeColumnName(col.binding)
			const currentBinding = hasStoredBinding ? storedBinding : fallbackBinding
			blueprintColumns.push({
				fieldName: col.name,
				fieldType: 'attribute',
				binding: currentBinding,
				category: 'columns',
			})
		})

		return { keyMappings, tableMeta, blueprintColumns }
	}, [blueprintBindingsData, wizard.bindingMappings, tableColumns])

	// Flatten all fields for compatibility with existing logic
	const fields: BlueprintField[] = useMemo(() => {
		return [...fieldGroups.keyMappings, ...fieldGroups.tableMeta, ...fieldGroups.blueprintColumns]
	}, [fieldGroups])

	// Save bindings (placed after queries to avoid TDZ issues)
	const handleSave = useCallback(async () => {
		if (!k || !blueprintBindingsData) {
			toast({
				title: 'Error',
				description: 'Select a blueprint and table to save mappings',
				variant: 'destructive',
			})
			return false
		}

		setIsSaving(true)
		try {
			const [source, blueprintName] = k.split('.')

			// Build minimal payload - only include what changed
			const payload: Record<string, any> = {}

			// Check if database binding changed
			const dbChanged = binding.db !== (blueprintBindingsData.binding_db || '')
			const schemaChanged = binding.schema !== (blueprintBindingsData.binding_schema || '')
			const tableChanged = binding.table !== (blueprintBindingsData.binding_object || '')

			if (dbChanged || schemaChanged || tableChanged) {
				payload.binding_db = binding.db || ''
				payload.binding_schema = binding.schema || ''
				payload.binding_object = binding.table || ''
			}

			// Check if delete_condition or where_clause changed
			const deleteCondition = wizard.bindingMappings['delete_condition'] || ''
			const whereClause = wizard.bindingMappings['where_clause'] || ''
			const deleteConditionChanged = deleteCondition !== (blueprintBindingsData.delete_condition || '')
			const whereClauseChanged = whereClause !== (blueprintBindingsData.where_clause || '')

			if (deleteConditionChanged) {
				payload.delete_condition = deleteCondition
			}
			if (whereClauseChanged) {
				payload.where_clause = whereClause
			}

			// Build updated structures with overrides from bindingMappings
			// Use individual binding keys (e.g., table_pk_name, primary_name, secondary_node_name)
			const updatedPk = (blueprintBindingsData.table_pk || []).map((pk: any) => {
				const bindingKey = `table_pk_${pk.name}`
				const bindingValue = canonicalizeColumnName(wizard.bindingMappings[bindingKey] || pk.binding || '')
				return {
					...pk,
					binding: bindingValue,
				}
			})

			const updatedPrimaryNode = blueprintBindingsData.primary_node
				? {
					...blueprintBindingsData.primary_node,
					bindings: (blueprintBindingsData.primary_node.bindings || []).map((b: any) => {
						const bindingKey = `primary_${b.name}`
						const bindingValue = canonicalizeColumnName(wizard.bindingMappings[bindingKey] || b.binding || '')
						return {
							...b,
							binding: bindingValue,
						}
					}),
				}
				: undefined

			const updatedSecondaryNodes = (blueprintBindingsData.secondary_nodes || []).map((node: any) => {
				// Get original bindings from blueprint
				const originalBindings = node.bindings || []
				
				// Reconstruct bindings from individual keys (secondary_node_bindingName)
				const updatedBindings = originalBindings.map((b: any) => {
					const bindingKey = `secondary_${node.node}_${b.name}`
					const bindingValue = canonicalizeColumnName(wizard.bindingMappings[bindingKey] || b.binding || '')
					return {
						name: b.name,
						binding: bindingValue,
					}
				})
				
				// Preserve all node properties (load, etc.)
				return {
					node: node.node,
					load: node.load !== undefined ? node.load : true,
					bindings: updatedBindings,
				}
			})

			// For columns, check if any changed
			const updatedColumns = (blueprintBindingsData.columns || []).map((col: any) => ({
				...col,
				binding: canonicalizeColumnName(
					wizard.bindingMappings[`column_${col.name}`] ?? col.binding ?? '',
				),
				excluded: col.excluded ?? false,
			}))

			// Check if columns changed (binding or excluded)
			const columnsChanged = updatedColumns.some((col: any) => {
				const original = (blueprintBindingsData.columns || []).find((c: any) => c.name === col.name)
				if (!original) return true
				return col.binding !== (original.binding || '') || col.excluded !== (original.excluded || false)
			})

			if (columnsChanged) {
				payload.columns = updatedColumns
			}

			// Check if table_pk changed
			const pkChanged = JSON.stringify(updatedPk) !== JSON.stringify(blueprintBindingsData.table_pk || [])
			if (pkChanged) {
				payload.table_pk = updatedPk
			}

			// Check if primary_node changed
			if (blueprintBindingsData.primary_node && updatedPrimaryNode) {
				const primaryNodeChanged = JSON.stringify(updatedPrimaryNode) !== JSON.stringify(blueprintBindingsData.primary_node)
				if (primaryNodeChanged) {
					payload.primary_node = updatedPrimaryNode
				}
			}

			// Check if secondary_nodes changed
			const secondaryNodesChanged = JSON.stringify(updatedSecondaryNodes) !== JSON.stringify(blueprintBindingsData.secondary_nodes || [])
			if (secondaryNodesChanged) {
				payload.secondary_nodes = updatedSecondaryNodes
			}

			// Check if ingest_time_binding changed
			const ingestTimeBinding = blueprintBindingsData.ingest_time
				? canonicalizeColumnName(wizard.bindingMappings['ingest_time'] ?? blueprintBindingsData.ingest_time_binding ?? blueprintBindingsData.ingest_time ?? '')
				: undefined

			if (ingestTimeBinding !== undefined) {
				const ingestTimeChanged = ingestTimeBinding !== (blueprintBindingsData.ingest_time_binding || '')
				if (ingestTimeChanged) {
					payload.ingest_time_binding = ingestTimeBinding
				}
			}

			// Determine mapping status based on field completion
			// Skip subheading rows and check individual bindings
			const allFieldsBound = fields.every((field) => {
				// Skip subheading rows
				if (field.isSubheading) {
					return true
				}
				
				const bindingKey = field.category === 'table_pk'
					? `table_pk_${field.bindingName || field.fieldName}`
					: field.category === 'primary_node'
					? `primary_${field.bindingName || field.fieldName}`
					: field.category === 'secondary_node'
					? `secondary_${field.node}_${field.bindingName || field.fieldName}` // Use individual binding key
					: field.category === 'ingest_time'
					? 'ingest_time'
					: `column_${field.fieldName}`
				const storedValue = canonicalizeColumnName(wizard.bindingMappings[bindingKey] || field.binding || '')
				const hasValue = storedValue.trim().length > 0 && storedValue !== '__none__'
				return hasValue
			})

			const deleteConditionProvided = deleteCondition.trim().length > 0
			const isMappingComplete = allFieldsBound && deleteConditionProvided

			// Always include mapping_complete
			payload.mapping_complete = isMappingComplete

			// If nothing changed, skip the API call
			if (Object.keys(payload).length === 1 && 'mapping_complete' in payload) {
				console.log('No changes detected, skipping save')
				wizard.setDirtyState(k, false)
				setIsSaving(false)
				return true
			}

			console.log(`Saving ${Object.keys(payload).length} fields:`, Object.keys(payload))
			await updateBlueprintBindings(source, blueprintName, payload)

			// Update blueprint catalog to reflect new mapping_complete status
			wizard.setBlueprintCatalog(
				wizard.blueprintCatalog.map((bp: any) => {
					const bpKey = `${bp.source}.${bp.id || bp.name}`
					if (bpKey === k) {
						return { ...bp, mapping_complete: isMappingComplete }
					}
					return bp
				})
			)

			// Update cache with the saved data
			const updatedBindingsData = {
				...blueprintBindingsData,
				...payload,
			}
			wizard.setBlueprintBindingsCache(k, updatedBindingsData)

			// Update the query cache directly instead of refetching
			queryClient.setQueryData(['blueprint-bindings', k], updatedBindingsData)

			// Clear dirty state since we just saved
			wizard.setDirtyState(k, false)

			// Show success toast
			toast({
				title: 'Saved',
				description: 'Field mappings saved successfully',
			})

			return true
		} catch (e: any) {
			const detail = e?.response?.data?.detail || e.message || 'Failed to save mappings'
			toast({
				title: 'Error',
				description: detail,
				variant: 'destructive',
			})
			return false
		} finally {
			setIsSaving(false)
		}
	}, [k, blueprintBindingsData, binding, wizard.bindingMappings, toast, queryClient, refetchBlueprintBindings, wizard])


	// Mark initial load as complete after first render and clear any spurious dirty state
	const hasRunInitialCleanup = useRef<Set<string>>(new Set())

	useEffect(() => {
		if (!k) {
			initialLoadCompleteRef.current = false
			prevStatusRef.current = null
			return
		}

		// Reset status ref when blueprint changes to avoid incorrect status comparisons
		prevStatusRef.current = null

		// Only run the cleanup once per blueprint
		if (!hasRunInitialCleanup.current.has(k)) {
			// Set a small delay to mark initial load complete
			const timer = setTimeout(() => {
				initialLoadCompleteRef.current = true
				// Clear dirty state after initial load - any dirty flags set during init are spurious
				wizard.setDirtyState(k, false)
				hasRunInitialCleanup.current.add(k)
			}, 1500) // Slightly longer delay to ensure all initial effects have run

			return () => clearTimeout(timer)
		} else {
			// Already ran cleanup for this blueprint
			initialLoadCompleteRef.current = true
		}
	}, [k, wizard])

	// Register save handler with wizard state using ref to avoid infinite loop
	const handleSaveRef = useRef(handleSave)
	handleSaveRef.current = handleSave

	useEffect(() => {
		// Wrap in a stable function that calls the ref
		const stableSaveHandler = () => handleSaveRef.current()
		useModelCatalogWizard.getState().setCurrentBlueprintSaveHandler(stableSaveHandler)
		return () => {
			useModelCatalogWizard.getState().setCurrentBlueprintSaveHandler(null)
		}
	}, [k]) // Only re-register when blueprint changes

	// Get options for a binding combobox (single-select for existing blueprint columns)
	// category: 'table_pk' | 'ingest_time' | 'primary_node' | 'secondary_node' | 'columns'
	const getOptionsForBinding = useCallback((currentValue: string, fieldName: string, category?: string) => {
		const canonicalCurrent = canonicalizeColumnName(currentValue)
		// Table PK and ingest time can reuse columns, so show all columns for them
		const canReuseColumns = category === 'table_pk' || category === 'ingest_time'
		// Nodes (primary/secondary) can bind to any column - no restrictions
		const isNode = category === 'primary_node' || category === 'secondary_node'
		
		const availableColumns = tableColumns.filter((col: any) => {
			const rawName = col.name || col.column_name || String(col)
			const colName = canonicalizeColumnName(rawName)
			if (colName === canonicalCurrent) return true // Keep current selection visible
			// Allow column whose name matches blueprint field (e.g., TASK_ID for task_id)
			const canonicalFieldName = canonicalizeColumnName(fieldName)
			if (canonicalFieldName && colName === canonicalFieldName) return true
			// Table PK and ingest time can reuse columns
			if (canReuseColumns) return true
			// Nodes can bind to any column
			if (isNode) return true
			// Data columns cannot bind to columns used by nodes or other data columns
			return !columnsUsedByNodes.has(colName) && !columnsUsedByDataColumns.has(colName)
		})

		const options = [
			{ name: '__none__', type: '', display: '-- Select Column --' },
			...availableColumns.map((col: any) => {
				const rawName = col.name || col.column_name || String(col)
				const name = canonicalizeColumnName(rawName) || canonicalizeColumnName(col)
				return {
					name,
					type: col.type || col.data_type || '',
					display: rawName, // Remove data type from display
				}
			}),
		]

		if (canonicalCurrent && !options.some((opt) => opt.name === canonicalCurrent)) {
			options.splice(1, 0, {
				name: canonicalCurrent,
				type: '',
				display: canonicalCurrent,
			})
		}

		return options
	}, [tableColumns, columnsUsedByNodes, columnsUsedByDataColumns])

	// Handle binding change (single select)
	const handleBindingChange = useCallback((bindingKey: string, columnName: string) => {
		const value = columnName === '__none__' ? '' : canonicalizeColumnName(columnName)
		wizard.setBindingMappings((prev) => ({
			...prev,
			[bindingKey]: value,
		}))
	}, [wizard])

	// Handle multi-select binding change
	const handleMultiBindingChange = useCallback((bindingKey: string, columnNames: string[]) => {
		const value = columnNames.length === 0 ? '' : columnNames.map(canonicalizeColumnName).join(',')
		wizard.setBindingMappings((prev) => ({
			...prev,
			[bindingKey]: value,
		}))
	}, [wizard])

	// Add new column mapping row
	const handleAddNewRow = useCallback(() => {
		const newId = `new_${Date.now()}`
		setNewRows((prev) => [{
			id: newId,
			sourceColumn: '',
			modelField: '',
			dataType: '',
		}, ...prev])
	}, [])

	// Update new row source column selection
	const handleNewRowSourceChange = useCallback((rowId: string, columnName: string) => {
		setNewRows((prev) => prev.map((row) => {
			if (row.id === rowId) {
				// If user selects "-- Select Column --", clear the row
				if (columnName === '__none__') {
					return {
						...row,
						sourceColumn: '',
						modelField: '',
						dataType: '',
					}
				}

				const column = tableColumns.find((col: any) => {
					const rawName = col.name || col.column_name || String(col)
					return canonicalizeColumnName(rawName) === columnName
				})
				const rawName = column?.name || column?.column_name || columnName
				const dataType = column?.type || column?.data_type || ''
				// Format the model field display: convert to proper case with spaces
				const formattedModelField = toDisplayFormat(rawName)
				return {
					...row,
					sourceColumn: columnName,
					modelField: formattedModelField, // Display as "Material Category" not "MATERIAL_CATEGORY"
					dataType,
				}
			}
			return row
		}))
	}, [tableColumns])

	// Update new row model field text
	const handleNewRowModelFieldChange = useCallback((rowId: string, value: string) => {
		setNewRows((prev) => prev.map((row) =>
			row.id === rowId ? { ...row, modelField: value } : row
		))
	}, [])

	// Save new row
	const handleSaveNewRow = useCallback(async (rowId: string) => {
		const row = newRows.find((r) => r.id === rowId)
		if (!row || !row.sourceColumn || !row.modelField || !blueprintBindingsData || savingRowId) return

		setSavingRowId(rowId)

		try {
			// Add new column to blueprint bindings
			// Include binding in the column object so backend can save it
			// Canonicalize the binding to match the format used elsewhere
			const canonicalBinding = canonicalizeColumnName(row.sourceColumn)
			const newColumn = {
				name: toSnakeCase(row.modelField),
				alias: toSnakeCase(row.modelField),
				binding: canonicalBinding, // Canonicalize binding to uppercase
				data_type: row.dataType || 'string', // Default to string if not provided
				description: null, // Allow null for description
				type: 'attribute', // Default type for custom columns (maps to column_type in DB)
				is_custom: true,
			}

			console.log('Adding new column:', newColumn)
			const updatedColumns = [...(blueprintBindingsData.columns || []), newColumn]
			const [source, blueprintName] = k!.split('.')

			// Build minimal payload - only send columns field for optimized update
			const payload: Record<string, any> = {
				columns: updatedColumns,
			}

			console.log('Updating blueprint bindings with payload (columns only):', JSON.stringify(payload, null, 2))
			await updateBlueprintBindings(source, blueprintName, payload)

			console.log('Blueprint bindings updated successfully')

			// Set the binding in wizard state for UI consistency
			const bindingKey = `column_${newColumn.name}`
			wizard.setBindingMappings((prev) => ({
				...prev,
				[bindingKey]: canonicalBinding,
			}), false) // Don't mark as dirty since we just saved

			// Update cache directly instead of refetching (much faster)
			const updatedBindingsData = {
				...blueprintBindingsData,
				columns: updatedColumns,
			}
			
			// Update both the query cache and the wizard cache
			queryClient.setQueryData(['blueprint-bindings', k], updatedBindingsData)
			wizard.setBlueprintBindingsCache(k, updatedBindingsData)

			// Clear dirty state since we just saved
			wizard.setDirtyState(k, false)

			// Remove from new rows immediately after successful save
			setNewRows((prev) => prev.filter((r) => r.id !== rowId))

			toast({
				title: 'Column added',
				description: `Column "${newColumn.name}" added successfully`,
			})
		} catch (e: any) {
			console.error('Error adding new column:', e)
			const errorMessage = e?.response?.data?.detail || e?.message || 'Failed to add new column'
			console.error('Error details:', errorMessage)
			toast({
				title: 'Error',
				description: errorMessage,
				variant: 'destructive',
			})
			// Don't remove row on error - let user retry or cancel
		} finally {
			// Only clear saving state if not already cleared in success path
			setSavingRowId((current) => current === rowId ? null : current)
		}
	}, [newRows, blueprintBindingsData, k, wizard, queryClient, savingRowId, handleSave, binding])

	// Cancel new row
	const handleCancelNewRow = useCallback((rowId: string) => {
		setNewRows((prev) => prev.filter((r) => r.id !== rowId))
	}, [])

	// Get expected type for field
	const getExpectedTypeForField = useCallback((fieldName: string, fieldType: string): string => {
		if (!blueprintBindingsData) return ''
		if (fieldType === 'attribute') {
			const col = (blueprintBindingsData.columns || []).find((c: any) => String(c.name) === String(fieldName))
			return String(col?.data_type || '').toLowerCase()
		}
		if (fieldType === 'ingest_time') {
			return 'timestamp' // Ingest time should be a timestamp
		}
		return ''
	}, [blueprintBindingsData])

	// Get column type by name
	const getColumnTypeByName = useCallback((columnName: string): string => {
		const canonical = canonicalizeColumnName(columnName)
		if (!canonical) return ''
		const col = tableColumns.find((c: any) => {
			const colName = canonicalizeColumnName(c.name || c.column_name || String(c))
			return colName === canonical
		})
		return String(col?.type || col?.data_type || '').toLowerCase()
	}, [tableColumns])

	// Get binding status for a field
	const getFieldStatus = useCallback((bindingValue: string, fieldName: string, fieldType: string, category?: string) => {
		const binding = canonicalizeColumnName(bindingValue)
		const hasBinding = !!binding && binding !== '__none__'
		if (!hasBinding) return { status: 'pending' as const, icon: Clock, color: 'text-amber-500', reason: undefined }

		// For data columns, check if binding violates the rule (bound to column used by nodes or other data columns)
		if (category === 'columns') {
			// Check if binding is used by nodes
			const usedByNodes = columnsUsedByNodes.has(binding)
			if (usedByNodes) {
				return { status: 'mismatch' as const, icon: XCircle, color: 'text-red-500', reason: 'binding_rule' as const }
			}
			
			// Check if binding is used by another data column (excluding current column)
			const usedByOtherDataColumn = Object.entries(wizard.bindingMappings).some(([key, value]) => {
				if (key.startsWith('column_') && key !== `column_${fieldName}`) {
					const canonicalValue = canonicalizeColumnName(String(value))
					return canonicalValue === binding
				}
				return false
			}) || (blueprintBindingsData?.columns || []).some((col: any) => {
				if (col.name !== fieldName) {
					const bindingKey = `column_${col.name}`
					// Skip if this column's binding is in wizard state (already checked above)
					if (bindingKey in wizard.bindingMappings) return false
					const canonicalBinding = canonicalizeColumnName(col.binding || '')
					return canonicalBinding === binding
				}
				return false
			})
			
			if (usedByOtherDataColumn) {
				return { status: 'mismatch' as const, icon: XCircle, color: 'text-red-500', reason: 'binding_rule' as const }
			}
		}

		const expectedType = getExpectedTypeForField(fieldName, fieldType)
		const selectedType = getColumnTypeByName(binding)
		if (expectedType && selectedType) {
			const normalizedExpected = normalizeDataType(expectedType)
			const normalizedSelected = normalizeDataType(selectedType)
			if (normalizedExpected !== normalizedSelected) {
				return { status: 'mismatch' as const, icon: XCircle, color: 'text-red-500', reason: 'type' as const }
			}
		}
		return { status: 'bound' as const, icon: CheckCircle2, color: 'text-emerald-500', reason: undefined }
	}, [getExpectedTypeForField, getColumnTypeByName, columnsUsedByNodes, columnsUsedByDataColumns, wizard.bindingMappings, blueprintBindingsData])

	// Update blueprint status when fields or bindings change
	const prevStatusRef = useRef<{ fieldsHash: string; table: string; status: string } | null>(null)
	useEffect(() => {
		if (!k || fields.length === 0) return

		// Skip status calculation during initial load to preserve persisted status
		if (!initialLoadCompleteRef.current) {
			return
		}

		// Create a hash of fields to detect actual changes
		const fieldsHash = JSON.stringify(fields.map(f => ({ name: f.fieldName, binding: f.binding })))

		// Skip if nothing changed
		if (
			prevStatusRef.current?.fieldsHash === fieldsHash &&
			prevStatusRef.current?.table === binding.table
		) {
			return
		}

		// Count bound vs unbound fields
		// Skip subheading rows and check individual bindings
		let boundCount = 0
		let unboundCount = 0

		fields.forEach((field) => {
			// Skip subheading rows
			if (field.isSubheading) {
				return
			}
			
			// Get binding value from wizard state using individual binding keys
			const bindingKey = field.category === 'table_pk'
				? `table_pk_${field.bindingName || field.fieldName}`
				: field.category === 'primary_node'
				? `primary_${field.bindingName || field.fieldName}`
				: field.category === 'secondary_node'
				? `secondary_${field.node}_${field.bindingName || field.fieldName}`
				: field.category === 'ingest_time'
				? 'ingest_time'
				: `column_${field.fieldName}`
			
			const storedBinding = canonicalizeColumnName(wizard.bindingMappings[bindingKey] || field.binding || '')
			const hasBinding = !!storedBinding && storedBinding !== '__none__'

			if (hasBinding) {
				boundCount++
			} else {
				unboundCount++
			}
		})

		let status: 'orange' | 'green' | 'grey' = 'grey'

		if (boundCount === 0) {
			// No fields bound yet
			status = 'grey'
		} else if (unboundCount > 0) {
			// Some bound, some unbound
			status = 'orange'
		} else {
			// All bound
			status = 'green'
		}

		// Only update if status actually changed
		const previousStatus = prevStatusRef.current?.status
		if (previousStatus !== status) {
			setBlueprintStatus(k, status)
			prevStatusRef.current = { fieldsHash, table: binding.table, status }
		}
	}, [k, fields, binding.table, setBlueprintStatus])

	if (!k) {
		return (
			<div className="text-sm text-muted-foreground p-8 text-center">
				Select a blueprint to view fields and mappings.
			</div>
		)
	}

    // Show fields immediately; guidance banner will appear if table is not selected

	if (fields.length === 0) {
		return (
			<div className="text-sm text-muted-foreground p-8 text-center">
				No fields found for this blueprint.
			</div>
		)
	}

	// Check if current blueprint has unsaved changes
	const isDirty = wizard.getDirtyState(k || '')

    return (
            <div className="space-y-4">
	                {!binding.table && (
                        <div className="text-xs text-muted-foreground px-3 py-2">
                                Select a database, schema, and table to enable column mapping.
                        </div>
                )}
                <div className="border rounded-md">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-[80px]">Status</TableHead>
							<TableHead className="w-[300px]">Source Table Column</TableHead>
							<TableHead className="w-[40px]"></TableHead>
							<TableHead>Model Field</TableHead>
							<TableHead className="w-[100px]">Include</TableHead>
							<TableHead className="w-[100px]">Data Type</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{/* Section 1: Key Mappings */}
						{fieldGroups.keyMappings.length > 0 && (
							<>
								<TableRow className="bg-gray-100 h-8">
									<TableCell colSpan={6} className="py-1 px-3">
										<div className="flex items-center gap-2">
											<span className="text-xs font-bold text-gray-700">KEY DEFINITION</span>
											<Button
												variant="ghost"
												size="icon"
												className="h-4 w-4 p-0 hover:bg-transparent"
												onClick={() => setOpenInfoModal('keyMappings')}
												aria-label="Information about Key Mappings"
											>
												<Info className="h-3.5 w-3.5 text-gray-600" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
								{fieldGroups.keyMappings.map((field, index) => {
									// Handle subheading rows
									if (field.isSubheading) {
										const nodeName = field.node || field.fieldName
										const displayName = nodeName.replace(/_/g, ' ').replace(/\b\w/g, (m: string) => m.toUpperCase())
										
										// Get binding names for subheading display (only show if multiple bindings)
										let bindingNames = ''
										if (field.category === 'primary_node') {
											const bindings = blueprintBindingsData?.primary_node?.bindings || []
											if (bindings.length > 1) {
												bindingNames = bindings.map((b: any) => b.name).join(' + ')
											}
										} else if (field.category === 'secondary_node' && field.node) {
											const nodeData = (blueprintBindingsData?.secondary_nodes || []).find((n: any) => n.node === field.node)
											const bindings = nodeData?.bindings || []
											if (bindings.length > 1) {
												bindingNames = bindings.map((b: any) => b.name).join(' + ')
											}
										} else if (field.category === 'table_pk') {
											const pkFields = blueprintBindingsData?.table_pk || []
											if (pkFields.length > 1) {
												bindingNames = pkFields.map((pk: any) => pk.name).join(' + ')
											}
										}
										
										return (
											<TableRow key={`subheading_${field.category}_${field.node || field.fieldName}_${index}`} className="bg-gray-50">
												<TableCell colSpan={6} className="py-2 px-3 font-semibold text-sm">
													{displayName}{bindingNames ? ` (${bindingNames})` : ''}
												</TableCell>
											</TableRow>
										)
									}
									
									// Handle individual binding rows
									const bindingKey = field.category === 'primary_node'
										? `primary_${field.bindingName || field.fieldName}`
										: field.category === 'secondary_node'
										? `secondary_${field.node}_${field.bindingName || field.fieldName}`
										: `primary_${field.fieldName}`

									// Get stored value or use field.binding as fallback
									const storedValue = canonicalizeColumnName(wizard.bindingMappings[bindingKey] || field.binding || '')
									const currentBinding = storedValue || '__none__'
									const options = getOptionsForBinding(currentBinding, field.fieldName, field.category)
									const status = getFieldStatus(currentBinding, field.fieldName, field.fieldType, field.category)
									const StatusIcon = status.icon

									// Use a unique key that combines category, node, and bindingName
									const uniqueKey = field.category === 'secondary_node' 
										? `secondary_${field.node}_${field.bindingName || field.fieldName}_${index}`
										: `${bindingKey}_${index}`

									return (
										<TableRow key={uniqueKey}>
											<TableCell>
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															<div className="flex items-center justify-center">
																<StatusIcon className={`h-4 w-4 ${status.color}`} />
															</div>
														</TooltipTrigger>
														<TooltipContent>
															{status.status === 'bound' && 'Bound'}
															{status.status === 'pending' && 'Pending — select a column'}
															{status.status === 'mismatch' && status.reason === 'binding_rule' && 'Binding rule violation — column already used by node or another data column'}
															{status.status === 'mismatch' && status.reason === 'type' && 'Type mismatch — data will be converted'}
															{status.status === 'mismatch' && !status.reason && 'Type mismatch — data will be converted'}
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											</TableCell>
											<TableCell>
												<Select
													value={currentBinding}
													onValueChange={(value) => handleBindingChange(bindingKey, value)}
													disabled={!binding.table}>
													<SelectTrigger className="w-full" disabled={!binding.table}>
														<SelectValue placeholder={binding.table ? "Select column..." : "Select table first..."} />
													</SelectTrigger>
													<SelectContent className="max-h-[300px]">
														{options.map((opt) => (
															<SelectItem key={opt.name} value={opt.name}>
																{opt.display}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</TableCell>
											<TableCell>
												<div className="flex items-center justify-center text-muted-foreground">
													➜
												</div>
											</TableCell>
											<TableCell>
												{(field.bindingName || field.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (m: string) => m.toUpperCase())}
											</TableCell>
											<TableCell>
												{/* Include column not applicable for Key Mappings */}
											</TableCell>
											<TableCell>
												<Badge variant="secondary">
													{field.fieldType === 'primary' || field.fieldType === 'secondary' ? 'String' :
													 formatDataTypeForDisplay(getExpectedTypeForField(field.fieldName, field.fieldType) || 'string')}
												</Badge>
											</TableCell>
										</TableRow>
									)
								})}
							</>
						)}

						{/* Section 2: Table Meta */}
						{blueprintBindingsData && (
							<>
								<TableRow className="bg-gray-100 h-8">
									<TableCell colSpan={6} className="py-1 px-3">
										<div className="flex items-center gap-2">
											<span className="text-xs font-bold text-gray-700">TABLE META</span>
											<Button
												variant="ghost"
												size="icon"
												className="h-4 w-4 p-0 hover:bg-transparent"
												onClick={() => setOpenInfoModal('tableMeta')}
												aria-label="Information about Table Meta"
											>
												<Info className="h-3.5 w-3.5 text-gray-600" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
								{/* Primary Key Rows */}
								{fieldGroups.tableMeta.map((field, index) => {
									// Handle subheading rows
									if (field.isSubheading) {
										const pkFields = blueprintBindingsData?.table_pk || []
										const pkNames = pkFields.map((pk: any) => pk.name).join(' + ')
										
										return (
											<TableRow key={`subheading_table_pk_${index}`} className="bg-gray-50">
												<TableCell colSpan={6} className="py-2 px-3 font-semibold text-sm">
													Primary Key{pkNames ? ` (${pkNames})` : ''}
												</TableCell>
											</TableRow>
										)
									}
									
									// Handle individual PK field rows
									const bindingKey = `table_pk_${field.bindingName || field.fieldName}`
									const storedValue = canonicalizeColumnName(wizard.bindingMappings[bindingKey] || field.binding || '')
									const currentBinding = storedValue || '__none__'
									const options = getOptionsForBinding(currentBinding, field.fieldName, 'table_pk')
									const status = getFieldStatus(currentBinding, field.fieldName, field.fieldType, 'table_pk')
									const StatusIcon = status.icon

									return (
										<TableRow key={`${bindingKey}_${index}`}>
											<TableCell>
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															<div className="flex items-center justify-center">
																<StatusIcon className={`h-4 w-4 ${status.color}`} />
															</div>
														</TooltipTrigger>
														<TooltipContent>
															{status.status === 'bound' && 'Bound'}
															{status.status === 'pending' && 'Pending — select a column'}
															{status.status === 'mismatch' && status.reason === 'binding_rule' && 'Binding rule violation — column already used by node or another data column'}
															{status.status === 'mismatch' && status.reason === 'type' && 'Type mismatch — data will be converted'}
															{status.status === 'mismatch' && !status.reason && 'Type mismatch — data will be converted'}
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											</TableCell>
											<TableCell>
												<Select
													value={currentBinding}
													onValueChange={(value) => handleBindingChange(bindingKey, value)}
													disabled={!binding.table}>
													<SelectTrigger className="w-full" disabled={!binding.table}>
														<SelectValue placeholder={binding.table ? "Select column..." : "Select table first..."} />
													</SelectTrigger>
													<SelectContent className="max-h-[300px]">
														{options.map((opt) => (
															<SelectItem key={opt.name} value={opt.name}>
																{opt.display}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</TableCell>
											<TableCell>
												<div className="flex items-center justify-center text-muted-foreground">
													➜
												</div>
											</TableCell>
											<TableCell>
												{(field.bindingName || field.fieldName).replace(/_/g, ' ').replace(/\b\w/g, (m: string) => m.toUpperCase())}
											</TableCell>
											<TableCell>
												{/* Include column not applicable for Table Meta */}
											</TableCell>
											<TableCell>
												<Badge variant="secondary">
													String
												</Badge>
											</TableCell>
										</TableRow>
									)
								})}
								{/* Ingest Time Binding Row - Always show */}
								{(() => {
									const bindingKey = 'ingest_time'
									const storedValue = canonicalizeColumnName(wizard.bindingMappings[bindingKey])
									const currentBinding = storedValue || canonicalizeColumnName(blueprintBindingsData.ingest_time_binding || blueprintBindingsData.ingest_time) || '__none__'
									const options = getOptionsForBinding(currentBinding, 'ingest_time', 'ingest_time')
									const status = getFieldStatus(currentBinding, 'ingest_time', 'ingest_time', 'ingest_time')
									const StatusIcon = status.icon

									return (
										<TableRow key={bindingKey}>
											<TableCell>
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															<div className="flex items-center justify-center">
																<StatusIcon className={`h-4 w-4 ${status.color}`} />
															</div>
														</TooltipTrigger>
														<TooltipContent>
															{status.status === 'bound' && 'Bound'}
															{status.status === 'pending' && 'Pending — select a column'}
															{status.status === 'mismatch' && status.reason === 'binding_rule' && 'Binding rule violation — column already used by node or another data column'}
															{status.status === 'mismatch' && status.reason === 'type' && 'Type mismatch — data will be converted'}
															{status.status === 'mismatch' && !status.reason && 'Type mismatch — data will be converted'}
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											</TableCell>
											<TableCell>
												<Select
													value={currentBinding || '__none__'}
													onValueChange={(value) => handleBindingChange(bindingKey, value)}
													disabled={!binding.table}>
													<SelectTrigger className="w-full" disabled={!binding.table}>
														<SelectValue placeholder={binding.table ? "Select column..." : "Select table first..."} />
													</SelectTrigger>
													<SelectContent className="max-h-[300px]">
														{options.map((opt) => (
															<SelectItem key={opt.name} value={opt.name}>
																{opt.display}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</TableCell>
											<TableCell>
												<div className="flex items-center justify-center text-muted-foreground">
													➜
												</div>
											</TableCell>
											<TableCell>Ingest Time</TableCell>
											<TableCell>
												{/* Include column not applicable for Table Meta */}
											</TableCell>
											<TableCell>
												<Badge variant="secondary">
													Timestamp
												</Badge>
											</TableCell>
										</TableRow>
									)
								})()}
							</>
						)}

						{/* Section 3: Blueprint Columns */}
						{fieldGroups.blueprintColumns.length > 0 && (
							<>
								<TableRow className="bg-gray-100 h-8">
									<TableCell colSpan={6} className="py-1 px-3 relative">
										<div className="flex items-center gap-2">
											<span className="text-xs font-bold text-gray-700">DATA COLUMNS</span>
											<Button
												variant="ghost"
												size="icon"
												className="h-4 w-4 p-0 hover:bg-transparent"
												onClick={() => setOpenInfoModal('columnMapping')}
												aria-label="Information about Column Mapping"
											>
												<Info className="h-3.5 w-3.5 text-gray-600" />
											</Button>
										</div>
										<Button
											size="sm"
											variant="ghost"
											onClick={handleAddNewRow}
											className="h-7 px-2 absolute right-3 top-0.5 flex items-center gap-1"
										>
											<Plus className="h-4 w-4" />
											<span className="text-xs">Add</span>
										</Button>
									</TableCell>
								</TableRow>
								{/* New rows being added */}
								{newRows.map((row) => {
									const canSave = row.sourceColumn && row.modelField && !savingRowId
									const isSaving = savingRowId === row.id
									const options = getOptionsForNewRow(row.sourceColumn)

									return (
										<TableRow key={row.id}>
											<TableCell>
												<div className="flex items-center justify-center">
													{isSaving ? (
														<Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
													) : (
														<Clock className="h-4 w-4 text-amber-500" />
													)}
												</div>
											</TableCell>
											<TableCell>
												<Select
													value={row.sourceColumn || '__none__'}
													onValueChange={(value) => handleNewRowSourceChange(row.id, value)}
													disabled={!binding.table || isSaving}
												>
													<SelectTrigger className="w-full" disabled={!binding.table || isSaving}>
														<SelectValue placeholder="Select column..." />
													</SelectTrigger>
													<SelectContent className="max-h-[300px]">
														{options.map((opt) => (
															<SelectItem key={opt.name} value={opt.name}>
																{opt.display}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</TableCell>
											<TableCell>
												<div className="flex items-center justify-center text-muted-foreground">
													➜
												</div>
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-2">
													<Input
														value={row.modelField}
														onChange={(e) => handleNewRowModelFieldChange(row.id, e.target.value)}
														placeholder="Enter field name..."
														className="flex-1"
														disabled={isSaving}
													/>
													{isSaving ? (
														<div className="h-6 w-6 flex items-center justify-center">
															<Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
														</div>
													) : (
														<>
															<Button
																size="sm"
																variant="ghost"
																onClick={() => handleSaveNewRow(row.id)}
																disabled={!canSave}
																className="h-6 w-6 p-0 shrink-0"
															>
																<Check className={`h-4 w-4 ${canSave ? 'text-green-600' : 'text-gray-400'}`} />
															</Button>
															<Button
																size="sm"
																variant="ghost"
																onClick={() => handleCancelNewRow(row.id)}
																disabled={isSaving}
																className="h-6 w-6 p-0 shrink-0"
															>
																<X className="h-4 w-4 text-red-600" />
															</Button>
														</>
													)}
												</div>
											</TableCell>
											<TableCell>
												{/* Include toggle not available for new rows until saved */}
											</TableCell>
											<TableCell>
												{row.dataType && (
													<Badge variant="secondary">
														{formatDataTypeForDisplay(row.dataType)}
													</Badge>
												)}
											</TableCell>
										</TableRow>
									)
								})}
								{/* Existing blueprint columns */}
								{fieldGroups.blueprintColumns.map((field) => {
									const bindingKey = `column_${field.fieldName}`

									const storedValue = canonicalizeColumnName(wizard.bindingMappings[bindingKey])
									const currentValue = storedValue || field.binding || '__none__'
									const options = getOptionsForBinding(currentValue, field.fieldName, 'columns')
									const status = getFieldStatus(currentValue, field.fieldName, field.fieldType, 'columns')
									const StatusIcon = status.icon

									// Get the column info from blueprintBindingsData to access alias
									const columnInfo = (blueprintBindingsData?.columns || []).find((c: any) => c.name === field.fieldName)
									const displayName = columnInfo?.alias || field.fieldName
									const isEditing = editingAlias === bindingKey

									const startEdit = () => {
										setEditingAlias(bindingKey)
										// Display as formatted text (e.g., "Material Category")
										const currentAlias = columnInfo?.alias || field.fieldName
										setAliasValue(toDisplayFormat(currentAlias))
									}

									const cancelEdit = () => {
										setEditingAlias(null)
										setAliasValue('')
									}

									const saveAlias = async () => {
										// Update the alias in the blueprint bindings
										if (!blueprintBindingsData) return

										// Convert display format back to snake_case for storage
										const snakeCaseAlias = toSnakeCase(aliasValue || field.fieldName)

										const updatedColumns = (blueprintBindingsData.columns || []).map((col: any) => {
											if (col.name === field.fieldName) {
												return { ...col, alias: snakeCaseAlias }
											}
											return col
										})

										try {
											const [source, blueprintName] = k!.split('.')
											await updateBlueprintBindings(source, blueprintName, {
												...blueprintBindingsData,
												columns: updatedColumns,
											})
											queryClient.invalidateQueries({ queryKey: ['blueprint-bindings', k] })
											toast({
												title: 'Alias updated',
												description: `Column alias set to "${snakeCaseAlias}"`,
											})
										} catch (e) {
											toast({
												title: 'Error',
												description: 'Failed to update alias',
												variant: 'destructive',
											})
										}

										setEditingAlias(null)
										setAliasValue('')
									}

									const handleToggleExcluded = (checked: boolean) => {
										if (!blueprintBindingsData || !k) return

										// Update the excluded state in the local cache only (no server call)
										const updatedColumns = (blueprintBindingsData.columns || []).map((col: any) => {
											if (col.name === field.fieldName) {
												return { ...col, excluded: checked }
											}
											return { ...col }
										})

										// Update the cache with the new excluded state
										const updatedBindingsData = {
											...blueprintBindingsData,
											columns: updatedColumns,
										}

										// Update cache
										wizard.setBlueprintBindingsCache(k, updatedBindingsData)

										// Mark as dirty since we have unsaved changes
										wizard.setDirtyState(k, true)

										// Force a re-render by invalidating the query
										queryClient.setQueryData(['blueprint-bindings', k], updatedBindingsData)
									}

									// Read excluded value - handle boolean, string, or undefined
									// excluded can be: true, false, 'true', 'false', 1, 0, null, undefined
									const excludedValue = columnInfo?.excluded
									const isExcluded = excludedValue === true || excludedValue === 'true' || excludedValue === 1 || excludedValue === '1'
									// For "Include" column: checked = !excluded (if not excluded, include is true)
									// When excluded=false, include=true (toggle ON)
									// When excluded=true, include=false (toggle OFF)
									const isIncluded = !isExcluded

									return (
										<TableRow key={bindingKey} className="group">
											<TableCell>
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															<div className="flex items-center justify-center">
																<StatusIcon className={`h-4 w-4 ${status.color}`} />
															</div>
														</TooltipTrigger>
														<TooltipContent>
															{status.status === 'bound' && 'Bound'}
															{status.status === 'pending' && 'Pending — select a column'}
															{status.status === 'mismatch' && status.reason === 'binding_rule' && 'Binding rule violation — column already used by node or another data column'}
															{status.status === 'mismatch' && status.reason === 'type' && 'Type mismatch — data will be converted'}
															{status.status === 'mismatch' && !status.reason && 'Type mismatch — data will be converted'}
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											</TableCell>
											<TableCell>
												<Select
													value={currentValue || '__none__'}
													onValueChange={(value) => handleBindingChange(bindingKey, value)}
													disabled={!binding.table}>
													<SelectTrigger className="w-full" disabled={!binding.table}>
														<SelectValue placeholder={binding.table ? "Select column..." : "Select table first..."} />
													</SelectTrigger>
													<SelectContent className="max-h-[300px]">
														{options.map((opt) => (
															<SelectItem key={opt.name} value={opt.name}>
																{opt.display}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</TableCell>
											<TableCell>
												<div className="flex items-center justify-center text-muted-foreground">
													➜
												</div>
											</TableCell>
											<TableCell>
												{isEditing ? (
													<div className="flex items-center gap-2">
														<Input
															value={aliasValue}
															onChange={(e) => setAliasValue(e.target.value)}
															className="h-8 text-sm"
															autoFocus
															onKeyDown={(e) => {
																if (e.key === 'Enter') saveAlias()
																if (e.key === 'Escape') cancelEdit()
															}}
														/>
														<Button
															size="sm"
															variant="ghost"
															className="h-6 w-6 p-0"
															onClick={saveAlias}
														>
															<Check className="h-4 w-4 text-green-600" />
														</Button>
														<Button
															size="sm"
															variant="ghost"
															className="h-6 w-6 p-0"
															onClick={cancelEdit}
														>
															<X className="h-4 w-4 text-red-600" />
														</Button>
													</div>
												) : (
													<div className="flex items-center gap-2">
														<span>{toDisplayFormat(displayName)}</span>
														<Button
															size="sm"
															variant="ghost"
															className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
															onClick={startEdit}
														>
															<Pencil className="h-3 w-3 text-muted-foreground" />
														</Button>
													</div>
												)}
											</TableCell>
											<TableCell>
												<div className="flex items-center justify-center">
													<Switch
														checked={isIncluded}
														onCheckedChange={(checked) => {
															// When toggle is checked (true), we want to include, so excluded should be false
															// When toggle is unchecked (false), we want to exclude, so excluded should be true
															handleToggleExcluded(!checked)
														}}
														disabled={!binding.table}
														aria-label={`${isIncluded ? 'Included' : 'Excluded'} ${displayName}`}
													/>
												</div>
											</TableCell>
											<TableCell>
												<Badge variant="secondary">
													{formatDataTypeForDisplay(getExpectedTypeForField(field.fieldName, field.fieldType) || 'string')}
												</Badge>
											</TableCell>
										</TableRow>
									)
								})}
							</>
						)}
					</TableBody>
				</Table>
			</div>

			{/* DELETE_CONDITION Section */}
			<div className="border rounded-md p-4 space-y-2">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold">DELETE_CONDITION</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-4 w-4 p-0 hover:bg-transparent"
						onClick={() => setOpenInfoModal('deleteCondition')}
						aria-label="Information about Delete Condition"
					>
						<Info className="h-3.5 w-3.5 text-gray-600" />
					</Button>
					{(() => {
						const deleteConditionKey = 'delete_condition'
						const deleteConditionValue = wizard.bindingMappings[deleteConditionKey] || blueprintBindingsData?.delete_condition || ''
						const hasValue = deleteConditionValue.trim().length > 0
						const status = hasValue
							? { status: 'bound' as const, icon: CheckCircle2, color: 'text-emerald-500' }
							: { status: 'pending' as const, icon: Clock, color: 'text-amber-500' }
						const StatusIcon = status.icon
						return (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex items-center">
											<StatusIcon className={`h-4 w-4 ${status.color}`} />
										</div>
									</TooltipTrigger>
									<TooltipContent>
										{status.status === 'bound' && 'Delete condition configured'}
										{status.status === 'pending' && 'Delete condition required'}
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						)
					})()}
				</div>
				<Input
					value={wizard.bindingMappings['delete_condition'] || blueprintBindingsData?.delete_condition || ''}
					onChange={(e) => {
						wizard.setBindingMappings((prev) => ({
							...prev,
							delete_condition: e.target.value,
						}))
					}}
					placeholder="Enter SQL expression for delete condition (e.g., DELETED_FLAG = 'Y')"
					className="w-full"
					disabled={!binding.table}
				/>
			</div>

			{/* WHERE Clause Section */}
			<div className="border rounded-md p-4 space-y-2">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold">WHERE Clause</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-4 w-4 p-0 hover:bg-transparent"
						onClick={() => setOpenInfoModal('whereClause')}
						aria-label="Information about Where Clause"
					>
						<Info className="h-3.5 w-3.5 text-gray-600" />
					</Button>
				</div>
				<Input
					value={wizard.bindingMappings['where_clause'] || blueprintBindingsData?.where_clause || ''}
					onChange={(e) => {
						wizard.setBindingMappings((prev) => ({
							...prev,
							where_clause: e.target.value,
						}))
					}}
					placeholder="Enter optional WHERE clause SQL expression"
					className="w-full"
					disabled={!binding.table}
				/>
			</div>

			{/* Key Mappings Info Dialog */}
			<Dialog open={openInfoModal === 'keyMappings'} onOpenChange={(open) => !open && setOpenInfoModal(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>About Key Mappings</DialogTitle>
						<DialogDescription>
							Information about the Key Mappings section
						</DialogDescription>
					</DialogHeader>
					<div className="py-4 space-y-4">
						<p className="text-sm text-muted-foreground">
							The Key Mappings section defines the primary and secondary keys that uniquely identify records in your dimensional model. These keys are essential for establishing relationships between tables and ensuring data integrity.
						</p>
						<div className="space-y-2">
							<p className="text-sm font-medium">Primary Node:</p>
							<p className="text-sm text-muted-foreground">
								The primary node represents the main entity or dimension in your model. It typically maps to the primary key columns from your source table that uniquely identify each record.
							</p>
							<p className="text-sm font-medium">Secondary Nodes:</p>
							<p className="text-sm text-muted-foreground">
								Secondary nodes represent related entities or dimensions that connect to the primary node. These are used to create relationships and hierarchies in your dimensional model. You can select multiple columns for composite keys.
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button onClick={() => setOpenInfoModal(null)}>Got it</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Table Meta Info Dialog */}
			<Dialog open={openInfoModal === 'tableMeta'} onOpenChange={(open) => !open && setOpenInfoModal(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>About Table Meta</DialogTitle>
						<DialogDescription>
							Information about the Table Meta section
						</DialogDescription>
					</DialogHeader>
					<div className="py-4 space-y-4">
						<p className="text-sm text-muted-foreground">
							The Table Meta section contains metadata fields that are essential for table management and data tracking in your dimensional model.
						</p>
						<div className="space-y-2">
							<p className="text-sm font-medium">Primary Key:</p>
							<p className="text-sm text-muted-foreground">
								The table primary key uniquely identifies each row in the dimensional table. This is typically a composite key made up of one or more columns from your source table. You can select multiple columns to create a composite primary key.
							</p>
							<p className="text-sm font-medium">Ingest Time:</p>
							<p className="text-sm text-muted-foreground">
								The ingest time field tracks when data was loaded into the table. This is used for data lineage, auditing, and incremental processing. It should map to a timestamp column in your source table.
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button onClick={() => setOpenInfoModal(null)}>Got it</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Column Mapping Info Dialog */}
			<Dialog open={openInfoModal === 'columnMapping'} onOpenChange={(open) => !open && setOpenInfoModal(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>About Column Mapping</DialogTitle>
						<DialogDescription>
							Information about the Column Mapping section
						</DialogDescription>
					</DialogHeader>
					<div className="py-4 space-y-4">
						<p className="text-sm text-muted-foreground">
							The Column Mapping section contains all the attribute columns that will be included in your dimensional model. These are the descriptive fields that provide context and detail about each record.
						</p>
						<div className="space-y-2">
							<p className="text-sm font-medium">Attributes:</p>
							<p className="text-sm text-muted-foreground">
								Each column in this section represents an attribute or property of your dimension. You can map source table columns to these model fields, and optionally customize the field name (alias) that will appear in the deployed model.
							</p>
							<p className="text-sm font-medium">Adding Custom Columns:</p>
							<p className="text-sm text-muted-foreground">
								You can add new columns to your model by clicking the "Add" button. This allows you to include additional attributes from your source table that aren't predefined in the blueprint.
							</p>
							<p className="text-sm font-medium">Data Types:</p>
							<p className="text-sm text-muted-foreground">
								The system will validate that the data types match between your source columns and the expected model field types. Type mismatches will be indicated, and data will be automatically converted when possible.
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button onClick={() => setOpenInfoModal(null)}>Got it</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Condition Info Dialog */}
			<Dialog open={openInfoModal === 'deleteCondition'} onOpenChange={(open) => !open && setOpenInfoModal(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>About DELETE_CONDITION</DialogTitle>
						<DialogDescription>
							Information about the Delete Condition field
						</DialogDescription>
					</DialogHeader>
					<div className="py-4 space-y-4">
						<p className="text-sm text-muted-foreground">
							The DELETE_CONDITION is a required SQL expression that determines how rows are marked as deleted in your source table. This condition is used to filter out deleted records during data processing.
						</p>
						<div className="space-y-2">
							<p className="text-sm font-medium">Required Field:</p>
							<p className="text-sm text-muted-foreground">
								This field must be filled in before you can proceed to the next step. The blueprint will not be marked as complete until a delete condition is provided.
							</p>
							<p className="text-sm font-medium">SQL Expression Examples:</p>
							<p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">
								DELETED_FLAG = 'Y'<br />
								IS_DELETED = 1<br />
								STATUS = 'DELETED'<br />
								DELETED_DATE IS NOT NULL
							</p>
							<p className="text-sm font-medium">Usage:</p>
							<p className="text-sm text-muted-foreground">
								The system will use this condition to identify and exclude deleted rows when processing data from your source table. Only rows that do not match this condition will be included in the dimensional model.
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button onClick={() => setOpenInfoModal(null)}>Got it</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Where Clause Info Dialog */}
			<Dialog open={openInfoModal === 'whereClause'} onOpenChange={(open) => !open && setOpenInfoModal(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>About WHERE Clause</DialogTitle>
						<DialogDescription>
							Information about the WHERE Clause field
						</DialogDescription>
					</DialogHeader>
					<div className="py-4 space-y-4">
						<p className="text-sm text-muted-foreground">
							The WHERE Clause is an optional SQL expression that allows you to filter rows from your source table before they are processed into the dimensional model.
						</p>
						<div className="space-y-2">
							<p className="text-sm font-medium">Optional Field:</p>
							<p className="text-sm text-muted-foreground">
								This field is optional and can be left empty if you want to include all rows from the source table (excluding those marked as deleted by the DELETE_CONDITION).
							</p>
							<p className="text-sm font-medium">SQL Expression Examples:</p>
							<p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">
								STATUS = 'ACTIVE'<br />
								CREATED_DATE &gt;= '2024-01-01'<br />
								REGION IN ('US', 'EU')<br />
								IS_PUBLISHED = 1 AND IS_ARCHIVED = 0
							</p>
							<p className="text-sm font-medium">Usage:</p>
							<p className="text-sm text-muted-foreground">
								The WHERE clause is applied in addition to the DELETE_CONDITION. Rows must satisfy both conditions (not match DELETE_CONDITION and match WHERE clause if provided) to be included in the dimensional model.
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button onClick={() => setOpenInfoModal(null)}>Got it</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

		</div>
	)
}

