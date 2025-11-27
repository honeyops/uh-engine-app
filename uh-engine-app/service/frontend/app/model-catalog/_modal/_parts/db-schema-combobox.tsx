'use client'

import { useMemo, useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useModelCatalogWizard } from '@/lib/state/model-catalog-wizard'
import { listSchemas } from '@/lib/api/model-catalog'

type Value = { db: string; schema: string }

export default function DbSchemaCombobox({
	label = 'Database · Schema',
	value,
	onChange,
	disabled,
}: {
	label?: string
	value: Value
	onChange: (v: Value) => void
	disabled?: boolean
}) {
	const wizard = useModelCatalogWizard()
	const [open, setOpen] = useState(false)
	const [dbSearch, setDbSearch] = useState('')
	const [schemaSearch, setSchemaSearch] = useState('')
	const [loadingSchemas, setLoadingSchemas] = useState(false)

	// Use cached data from wizard state
	const items = wizard.databasesSchemas

	const databases = useMemo(() => {
		const set = new Set(items.map(i => i.database.toUpperCase()))
		return Array.from(set).sort()
	}, [items])

	const filteredDatabases = useMemo(() => {
		const q = dbSearch.trim().toUpperCase()
		if (!q) return databases
		return databases.filter(d => d.includes(q))
	}, [databases, dbSearch])

	// Lazy-load schemas when a database is selected (only if not already loaded)
	useEffect(() => {
		const db = value.db
		if (!db) return

		const dbUpper = db.toUpperCase()
		const item = items.find(i => i.database.toUpperCase() === dbUpper)

		// Only fetch if schemas are not already loaded (item exists but schemas are empty)
		if (item && item.schemas.length === 0) {
			setLoadingSchemas(true)
			listSchemas(db)
				.then((res) => {
					const schemas = res.data?.map((s: any) => s.name) || []
					// Update the wizard state with the loaded schemas
					wizard.setDatabasesSchemas(
						items.map(i =>
							i.database.toUpperCase() === dbUpper
								? { ...i, schemas }
								: i
						)
					)
				})
				.catch((err) => {
					console.error('Error loading schemas:', err)
				})
				.finally(() => {
					setLoadingSchemas(false)
				})
		}
	}, [value.db, items, wizard])

	const schemasForDb = useMemo(() => {
		const db = (value.db || '').toUpperCase()
		const item = items.find(i => i.database.toUpperCase() === db)
		const list = item?.schemas?.map(s => s.toUpperCase()) || []
		const q = schemaSearch.trim().toUpperCase()
		if (!q) return list
		return list.filter(s => s.includes(q))
	}, [items, value.db, schemaSearch])

	return (
		<div className="grid gap-1">
			<Label className="text-xs">{label}</Label>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						role="combobox"
						aria-expanded={open}
						disabled={disabled}
						className="w-full justify-between"
					>
						{value.db && value.schema ? `${value.db}.${value.schema}` : 'Select database · schema...'}
						<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-[560px] p-0">
					<div className="grid grid-cols-2">
						{/* Databases */}
						<div className="border-r">
							<Command>
								<CommandInput value={dbSearch} onValueChange={setDbSearch} placeholder="Search database..." className="focus:ring-0 focus-visible:ring-0 focus:outline-none focus-visible:outline-none focus:shadow-none focus-visible:shadow-none" />
								<CommandList className="max-h-[300px] overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
									<CommandEmpty>No databases found.</CommandEmpty>
									<CommandGroup>
										{filteredDatabases.map((db) => (
											<CommandItem
												key={db}
												value={db}
												onSelect={() => {
													onChange({ db, schema: '' })
												}}
											>
												<Check className={cn('mr-2 h-4 w-4', value.db === db ? 'opacity-100' : 'opacity-0')} />
												{db}
											</CommandItem>
										))}
									</CommandGroup>
								</CommandList>
							</Command>
						</div>
						{/* Schemas */}
						<div>
							<Command>
								<CommandInput value={schemaSearch} onValueChange={setSchemaSearch} placeholder="Search schema..." className="focus:ring-0 focus-visible:ring-0 focus:outline-none focus-visible:outline-none focus:shadow-none focus-visible:shadow-none" />
								<CommandList className="max-h-[300px] overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
									<CommandEmpty>
										{loadingSchemas ? 'Loading schemas...' : value.db ? 'No schemas found.' : 'Select a database first.'}
									</CommandEmpty>
									<CommandGroup>
										{schemasForDb.map((schema) => (
											<CommandItem
												key={schema}
												value={schema}
												onSelect={() => {
													if (!value.db) return
													onChange({ db: value.db, schema })
													setOpen(false)
												}}
											>
												<Check className={cn('mr-2 h-4 w-4', value.schema === schema ? 'opacity-100' : 'opacity-0')} />
												{schema}
											</CommandItem>
										))}
									</CommandGroup>
								</CommandList>
							</Command>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)
}


