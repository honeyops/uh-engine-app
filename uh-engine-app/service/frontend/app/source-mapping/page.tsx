'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Info, ArrowUp, ArrowDown, ArrowUpDown, CheckCircle2, Circle } from 'lucide-react';
import { getBlueprintsDetailed, type BlueprintDetail, getModalLoaderData, updateBlueprintBindings } from '@/lib/api/model-catalog';
import { useModelCatalogWizard } from '@/lib/state/model-catalog-wizard';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import BlueprintsSidebar from '@/app/model-catalog/_modal/_parts/blueprints-sidebar';
import SourceSelectors from '@/app/model-catalog/_modal/_parts/source-selectors';
import FieldBindings from '@/app/model-catalog/_modal/_parts/field-bindings';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export default function SourceMappingPage() {
	const [searchTerm, setSearchTerm] = useState('');
	const [selectedSource, setSelectedSource] = useState<string>('all');
	const [selectedMapped, setSelectedMapped] = useState<string>('all');
	const [selectedBound, setSelectedBound] = useState<string>('all');
	const [selectedBlueprints, setSelectedBlueprints] = useState<string[]>([]);
	const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isPageInfoDialogOpen, setIsPageInfoDialogOpen] = useState(false);
	
	const wizard = useModelCatalogWizard();
	const queryClient = useQueryClient();
	const { toast } = useToast();

	type SortKey = 'name' | 'source' | 'binding_db' | 'column_count';
	const [sortKey, setSortKey] = useState<SortKey>('name');
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

	const toggleSort = (key: SortKey) => {
		if (key === sortKey) {
			setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
			return;
		}
		setSortKey(key);
		setSortDirection('asc');
	};

	const { data: blueprintsData, isLoading, error } = useQuery({
		queryKey: ['blueprints-detailed'],
		queryFn: () => getBlueprintsDetailed(),
	});

	const blueprints: BlueprintDetail[] = useMemo(() => {
		if (!blueprintsData?.blueprints) return [];
		return blueprintsData.blueprints;
	}, [blueprintsData]);

	const filteredBlueprints = useMemo(() => {
		const term = searchTerm.toLowerCase();
		const filtered = blueprints
			.filter((bp) => {
				const name = bp.name.toLowerCase();
				const source = bp.source.toLowerCase();
				const db = (bp.binding_db || '').toLowerCase();
				const schema = (bp.binding_schema || '').toLowerCase();

				const matchesText =
					term.length === 0 || name.includes(term) || source.includes(term) || db.includes(term) || schema.includes(term);
				const matchesSource = selectedSource === 'all' || bp.source === selectedSource;
				const matchesMapped = selectedMapped === 'all' || 
					(selectedMapped === 'mapped' && bp.mapping_complete) ||
					(selectedMapped === 'unmapped' && !bp.mapping_complete);
				const matchesBound = selectedBound === 'all' ||
					(selectedBound === 'bound' && bp.deployed) ||
					(selectedBound === 'unbound' && !bp.deployed);

				return matchesText && matchesSource && matchesMapped && matchesBound;
			});

		const compare = (a: BlueprintDetail, b: BlueprintDetail) => {
			let aVal: string | number;
			let bVal: string | number;
			
			if (sortKey === 'column_count') {
				aVal = a.column_count;
				bVal = b.column_count;
			} else {
				aVal = (a[sortKey] || '').toString().toLowerCase();
				bVal = (b[sortKey] || '').toString().toLowerCase();
			}
			
			if (aVal === bVal) {
				// Secondary sort by name for stable ordering
				return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
			}
			
			if (typeof aVal === 'number' && typeof bVal === 'number') {
				return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
			}
			
			const base = aVal.toString().localeCompare(bVal.toString());
			return sortDirection === 'asc' ? base : -base;
		};

		return filtered.sort(compare);
	}, [blueprints, searchTerm, selectedSource, selectedMapped, selectedBound, sortKey, sortDirection]);

	const sources = useMemo(() => {
		return Array.from(new Set(blueprints.map((bp) => bp.source))).sort();
	}, [blueprints]);

	const handleBlueprintToggle = (blueprintId: string) => {
		setSelectedBlueprints((prev) => {
			if (prev.includes(blueprintId)) {
				return prev.filter((id) => id !== blueprintId);
			} else {
				return [...prev, blueprintId];
			}
		});
	};

	const handleSelectAll = () => {
		const allFilteredIds = filteredBlueprints.map((bp) => `${bp.source}.${bp.id}`);
		const allSelected = allFilteredIds.every((id) => selectedBlueprints.includes(id));

		if (allSelected) {
			setSelectedBlueprints((prev) => prev.filter((id) => !allFilteredIds.includes(id)));
		} else {
			setSelectedBlueprints((prev) => {
				const newIds = allFilteredIds.filter((id) => !prev.includes(id));
				return [...prev, ...newIds];
			});
		}
	};

	const allFilteredIds = filteredBlueprints.map((bp) => `${bp.source}.${bp.id}`);
	const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedBlueprints.includes(id));
	const isSomeSelected = filteredBlueprints.some((bp) => selectedBlueprints.includes(`${bp.source}.${bp.id}`)) && !isAllSelected;
	const selectAllChecked = isAllSelected ? true : isSomeSelected ? 'indeterminate' : false;

	const handleMap = async () => {
		if (selectedBlueprints.length === 0) return;
		
		// Open wizard and set up blueprints
		wizard.open({ step: 'mapping', models: [] });
		setIsMappingModalOpen(true);
		
		// Load blueprints directly from the selected blueprint keys
		wizard.setIsLoadingModalData(true);
		try {
			// Convert selected blueprint keys to blueprint objects
			const blueprintList: any[] = [];
			for (const blueprintKey of selectedBlueprints) {
				const [source, id] = blueprintKey.split('.');
				const blueprint = blueprints.find(bp => bp.source === source && bp.id === id);
				if (blueprint) {
					blueprintList.push({
						id: blueprint.id,
						name: blueprint.name,
						source: blueprint.source,
						binding_db: blueprint.binding_db,
						binding_schema: blueprint.binding_schema,
						binding_object: blueprint.binding_table,
					});
				}
			}
			wizard.setBlueprintCatalog(blueprintList);
		} catch (error) {
			console.error('Error loading blueprint data:', error);
		} finally {
			wizard.setIsLoadingModalData(false);
		}
	};

	const handleSave = async () => {
		setIsSaving(true);
		try {
			// Save all blueprints that have database bindings set
			const savedBlueprints: string[] = [];
			
			for (const blueprintKey of Object.keys(wizard.blueprintDatabaseBindings)) {
				const [source, name] = blueprintKey.split('.');
				const binding = wizard.blueprintDatabaseBindings[blueprintKey];
				
				if (binding.db && binding.schema && binding.table) {
					// Get the blueprint's field bindings from the wizard state
					// The field bindings are stored with keys like "table_pk_fieldName", "column_fieldName", etc.
					// We need to reconstruct the blueprint structure with updated bindings
					
					// For now, save just the database binding
					// The field bindings component handles saving individual blueprint field mappings
					// We'll save the database binding which is the main requirement
					
					await updateBlueprintBindings(source, name, {
						binding_db: binding.db,
						binding_schema: binding.schema,
						binding_object: binding.table,
					});
					
					savedBlueprints.push(blueprintKey);
				}
			}
			
			if (savedBlueprints.length > 0) {
				toast({
					title: 'Bindings Saved',
					description: `Saved bindings for ${savedBlueprints.length} blueprint${savedBlueprints.length === 1 ? '' : 's'}.`,
				});
			} else {
				toast({
					title: 'No Bindings to Save',
					description: 'Please map at least one blueprint to a database table.',
					variant: 'destructive',
				});
				return;
			}
			
			// Refresh the data
			queryClient.invalidateQueries({ queryKey: ['blueprints-detailed'] });
			
			// Close modal
			wizard.reset();
			setIsMappingModalOpen(false);
		} catch (error: any) {
			toast({
				title: 'Save Failed',
				description: error?.message || 'Failed to save blueprint bindings.',
				variant: 'destructive',
			});
		} finally {
			setIsSaving(false);
		}
	};

	const handleClose = () => {
		queryClient.invalidateQueries();
		wizard.reset();
		setIsMappingModalOpen(false);
	};

	return (
		<>
			<PageHeader title="Source Mapping" group="Modelling">
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8"
					onClick={() => setIsPageInfoDialogOpen(true)}
					aria-label="Information about Source Mapping"
				>
					<Info className="h-4 w-4" />
				</Button>
			</PageHeader>
			<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
				{/* Filter Bar */}
				<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
					<Input
						placeholder="Search by name or source..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						className="flex-1 min-w-[200px]"
					/>
					<Select value={selectedSource} onValueChange={setSelectedSource}>
						<SelectTrigger className="w-full sm:w-[180px]">
							<SelectValue placeholder="All Sources" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Sources</SelectItem>
							{sources.map((source) => (
								<SelectItem key={source} value={source}>
									{source}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select value={selectedMapped} onValueChange={setSelectedMapped}>
						<SelectTrigger className="w-full sm:w-[180px]">
							<SelectValue placeholder="Mapping Status" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All</SelectItem>
							<SelectItem value="mapped">Mapped</SelectItem>
							<SelectItem value="unmapped">Not Mapped</SelectItem>
						</SelectContent>
					</Select>
					<Select value={selectedBound} onValueChange={setSelectedBound}>
						<SelectTrigger className="w-full sm:w-[180px]">
							<SelectValue placeholder="Deployment Status" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All</SelectItem>
							<SelectItem value="bound">Deployed</SelectItem>
							<SelectItem value="unbound">Not Deployed</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{/* Data Table */}
				<div className="flex flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
					<div className="overflow-auto">
						<Table>
							<TableHeader className="sticky top-0 z-10 bg-background">
								<TableRow>
									<TableHead className="w-12">
										<Checkbox
											checked={selectAllChecked}
											onCheckedChange={handleSelectAll}
											aria-label="Select all"
										/>
									</TableHead>
									<TableHead className="w-[250px]">
										<button
											onClick={() => toggleSort('name')}
											className="inline-flex items-center gap-1 hover:underline"
											aria-label="Sort by Name"
										>
											Name
											{sortKey !== 'name' ? (
												<ArrowUpDown className="ml-1 h-3 w-3" />
											) : sortDirection === 'asc' ? (
												<ArrowUp className="ml-1 h-3 w-3" />
											) : (
												<ArrowDown className="ml-1 h-3 w-3" />
											)}
										</button>
									</TableHead>
									<TableHead className="w-[200px]">
										<button
											onClick={() => toggleSort('source')}
											className="inline-flex items-center gap-1 hover:underline"
											aria-label="Sort by Source"
										>
											Source
											{sortKey !== 'source' ? (
												<ArrowUpDown className="ml-1 h-3 w-3" />
											) : sortDirection === 'asc' ? (
												<ArrowUp className="ml-1 h-3 w-3" />
											) : (
												<ArrowDown className="ml-1 h-3 w-3" />
											)}
										</button>
									</TableHead>
									<TableHead className="w-[280px]">Binding</TableHead>
									<TableHead className="w-[100px] text-center">
										<button
											onClick={() => toggleSort('column_count')}
											className="inline-flex items-center gap-1 hover:underline"
											aria-label="Sort by Column Count"
										>
											Columns
											{sortKey !== 'column_count' ? (
												<ArrowUpDown className="ml-1 h-3 w-3" />
											) : sortDirection === 'asc' ? (
												<ArrowUp className="ml-1 h-3 w-3" />
											) : (
												<ArrowDown className="ml-1 h-3 w-3" />
											)}
										</button>
									</TableHead>
									<TableHead className="w-[120px] text-center">Mapping</TableHead>
									<TableHead className="w-[100px] text-center">Deployed</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{error ? (
									<TableRow>
										<TableCell colSpan={8} className="h-24 text-center text-destructive">
											Error loading blueprints. Please check the console for details.
											{error && <div className="mt-2 text-xs">{String(error)}</div>}
										</TableCell>
									</TableRow>
								) : isLoading ? (
									<TableRow>
										<TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
											Loading...
										</TableCell>
									</TableRow>
								) : filteredBlueprints.length === 0 ? (
									<TableRow>
										<TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
											No blueprints found
											<div className="mt-2 text-xs">
												Total blueprints: {blueprints.length}
											</div>
										</TableCell>
									</TableRow>
								) : (
									filteredBlueprints.map((blueprint) => {
										const blueprintKey = `${blueprint.source}.${blueprint.id}`;
										return (
										<TableRow
											key={blueprintKey}
											className="cursor-pointer"
											onClick={() => handleBlueprintToggle(blueprintKey)}
										>
											<TableCell onClick={(e) => e.stopPropagation()}>
												<Checkbox
													checked={selectedBlueprints.includes(blueprintKey)}
													onCheckedChange={() => handleBlueprintToggle(blueprintKey)}
													aria-label={`Select ${blueprint.name}`}
												/>
											</TableCell>
											<TableCell className="font-medium">
												{blueprint.name}
											</TableCell>
											<TableCell>
												<Badge variant="outline" className="capitalize">
													{blueprint.source}
												</Badge>
											</TableCell>
											<TableCell>
												{blueprint.binding_db && blueprint.binding_schema ? (
													<div className="flex flex-col gap-0.5 text-sm">
														<div className="font-medium">{blueprint.binding_db}</div>
														<div className="text-muted-foreground">{blueprint.binding_schema}</div>
														{blueprint.binding_table && (
															<div className="text-xs text-muted-foreground">{blueprint.binding_table}</div>
														)}
													</div>
												) : (
													<span className="text-muted-foreground text-sm">-</span>
												)}
											</TableCell>
											<TableCell className="text-center">
												{blueprint.column_count}
											</TableCell>
											<TableCell className="text-center">
												{blueprint.mapping_complete ? (
													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<div className="inline-flex items-center">
																	<CheckCircle2 className="h-4 w-4 text-green-500" />
																</div>
															</TooltipTrigger>
															<TooltipContent>
																<p>Mapping complete</p>
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>
												) : (
													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<div className="inline-flex items-center">
																	<Circle className="h-4 w-4 text-muted-foreground" />
																</div>
															</TooltipTrigger>
															<TooltipContent>
																<p>Mapping incomplete</p>
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>
												)}
											</TableCell>
											<TableCell className="text-center">
												{blueprint.deployed ? (
													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<div className="inline-flex items-center">
																	<CheckCircle2 className="h-4 w-4 text-green-500" />
																</div>
															</TooltipTrigger>
															<TooltipContent>
																<p>Deployed</p>
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>
												) : (
													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<div className="inline-flex items-center">
																	<Circle className="h-4 w-4 text-muted-foreground" />
																</div>
															</TooltipTrigger>
															<TooltipContent>
																<p>Not deployed</p>
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>
												)}
											</TableCell>
										</TableRow>
									);
									})
								)}
							</TableBody>
						</Table>
					</div>
				</div>

				{/* Footer Actions */}
				<div className="flex items-center justify-between border-t border-border pt-4">
					<div className="text-sm text-muted-foreground">
						{selectedBlueprints.length > 0
							? `${selectedBlueprints.length} blueprint${selectedBlueprints.length === 1 ? '' : 's'} selected`
							: 'No blueprints selected'}
					</div>
					<Button onClick={handleMap} disabled={selectedBlueprints.length === 0}>
						Map
					</Button>
				</div>
			</div>
			
			{/* Mapping Modal */}
			<Dialog open={isMappingModalOpen} onOpenChange={(open) => {
				if (!open) {
					handleClose();
				}
			}}>
				<DialogContent className="max-w-[1400px] w-[98vw] h-[85vh] p-0 flex flex-col overflow-hidden">
					{/* Loading Overlay */}
					{wizard.isLoadingModalData && (
						<div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
							<div className="flex flex-col items-center gap-3">
								<Loader2 className="h-8 w-8 animate-spin text-primary" />
								<p className="text-sm text-muted-foreground">Loading mapping data...</p>
							</div>
						</div>
					)}
					<DialogHeader className="px-6 py-4 shrink-0">
						<DialogTitle>Blueprint Mapping</DialogTitle>
					</DialogHeader>
					<Separator className="shrink-0" />
					<div className="grid flex-1 min-h-0 grid-cols-[320px_1fr]">
						<aside className="bg-muted/40">
							<ScrollArea className="h-full p-4">
								<BlueprintsSidebar />
							</ScrollArea>
						</aside>
						<main className="flex flex-col min-w-0 min-h-0 flex-1">
							{/* Sticky selectors header */}
							<div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b shrink-0">
								<div className="px-4 py-3">
									<SourceSelectors />
								</div>
							</div>
							<ScrollArea className="flex-1 min-h-0 p-4">
								<FieldBindings />
							</ScrollArea>
						</main>
					</div>
					<Separator className="shrink-0" />
					<div className="flex items-center justify-end gap-2 p-4 shrink-0">
						<Button
							variant="secondary"
							onClick={handleClose}
							disabled={isSaving}
						>
							Close
						</Button>
						<Button
							onClick={handleSave}
							disabled={isSaving}
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
					</div>
				</DialogContent>
			</Dialog>

			{/* Page Information Dialog */}
			<Dialog open={isPageInfoDialogOpen} onOpenChange={setIsPageInfoDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>About Source Mapping</DialogTitle>
						<DialogDescription>
							Information about Blueprints and Source Mapping
						</DialogDescription>
					</DialogHeader>
					<div className="py-4 space-y-4">
						<p className="text-sm text-muted-foreground">
							Blueprints are templated specifications that define the expected structure and fields of source data required for building dimensional models. They act as a contract between your source systems and the downstream modeling process.
						</p>
						<p className="text-sm text-muted-foreground">
							Each blueprint specifies what data structure and fields are needed from your source systems. When you map a blueprint to your actual database tables, you're connecting the expected data structure (the blueprint) to your real source data.
						</p>
						<p className="text-sm text-muted-foreground">
							<strong>How it works:</strong> Select one or more blueprints from the list, then click "Map" to open the mapping wizard. In the wizard, you'll select the database, schema, and table that contains the source data for each blueprint, and then map individual fields from your source tables to the blueprint's expected fields.
						</p>
						<p className="text-sm text-muted-foreground">
							Once a blueprint is fully mapped and deployed, it becomes available for use in model deployments. The Model Catalog page automatically selects the appropriate blueprints based on the models you choose to deploy.
						</p>
					</div>
					<DialogFooter>
						<Button onClick={() => setIsPageInfoDialogOpen(false)}>Got it</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

