'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
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
import { StatusBadge } from '@/components/badges/status-badge';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Pencil, Info, Trash2, Loader2, ArrowUp, ArrowDown, ArrowUpDown, MoreHorizontal, Plus } from 'lucide-react';
import { IconCircleCheckFilled, IconCircleDashed, IconCircleXFilled } from '@tabler/icons-react';
import {
	getSnapshotStates,
	createSnapshotState,
	updateSnapshotState,
	deleteSnapshotState,
	type SnapshotState,
	type SnapshotStateCreateRequest,
	type SnapshotStateUpdateRequest,
} from '@/lib/api/openflow';
import { SnowflakeButton } from '@/components/snowflake-button';

export default function OpenflowPage() {
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
	const [isPageInfoDialogOpen, setIsPageInfoDialogOpen] = useState(false);
	const [selectedRecord, setSelectedRecord] = useState<SnapshotState | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	
	// Filter state
	const [searchTerm, setSearchTerm] = useState('');
	const [selectedEnabled, setSelectedEnabled] = useState<string>('all');
	
	// Sort state
	type SortKey = 'database_name' | 'schema_name' | 'table_name' | 'enabled' | 'snapshot_interval_hours';
	const [sortKey, setSortKey] = useState<SortKey>('database_name');
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
	
	const toggleSort = (key: SortKey) => {
		if (key === sortKey) {
			setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
			return;
		}
		setSortKey(key);
		setSortDirection('asc');
	};
	
	// Form state
	const [formData, setFormData] = useState<SnapshotStateCreateRequest>({
		database_name: '',
		schema_name: '',
		table_name: '',
		enabled: false,
		snapshot_request: false,
		table_ddl_initialize: false,
		watermark_column_pattern: null,
		watermark_column: null,
		primary_key_columns: null,
		chunking_strategy: 'primary_key',
	});

	const queryClient = useQueryClient();
	const { toast } = useToast();

	const { data, isLoading, error } = useQuery({
		queryKey: ['snapshot-states'],
		queryFn: getSnapshotStates,
	});

	const snapshotStates = data?.snapshot_states || [];

	// Filter and sort snapshot states
	const filteredSnapshotStates = useMemo(() => {
		const term = searchTerm.toLowerCase();
		const filtered = snapshotStates.filter((state) => {
			const matchesText =
				term.length === 0 ||
				state.database_name.toLowerCase().includes(term) ||
				state.schema_name.toLowerCase().includes(term) ||
				state.table_name.toLowerCase().includes(term);
			
			const matchesEnabled =
				selectedEnabled === 'all' ||
				(selectedEnabled === 'enabled' && state.enabled === true) ||
				(selectedEnabled === 'disabled' && (state.enabled === false || state.enabled === null));

			return matchesText && matchesEnabled;
		});

		// Sort the filtered results
		const compare = (a: SnapshotState, b: SnapshotState) => {
			let aVal: string | number | boolean | null;
			let bVal: string | number | boolean | null;
			
			if (sortKey === 'snapshot_interval_hours') {
				aVal = a.snapshot_interval_hours ?? 0;
				bVal = b.snapshot_interval_hours ?? 0;
			} else if (sortKey === 'enabled') {
				aVal = a.enabled ?? false;
				bVal = b.enabled ?? false;
			} else {
				aVal = (a[sortKey] || '').toString().toLowerCase();
				bVal = (b[sortKey] || '').toString().toLowerCase();
			}
			
			if (aVal === bVal) {
				// Secondary sort by database_name for stable ordering
				return a.database_name.toLowerCase().localeCompare(b.database_name.toLowerCase());
			}
			
			if (typeof aVal === 'number' && typeof bVal === 'number') {
				return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
			}
			
			if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
				return sortDirection === 'asc' 
					? (aVal === bVal ? 0 : aVal ? 1 : -1)
					: (aVal === bVal ? 0 : aVal ? -1 : 1);
			}
			
			const base = aVal.toString().localeCompare(bVal.toString());
			return sortDirection === 'asc' ? base : -base;
		};

		return filtered.sort(compare);
	}, [snapshotStates, searchTerm, selectedEnabled, sortKey, sortDirection]);

	const handleEdit = (record: SnapshotState) => {
		setSelectedRecord(record);
		setFormData({
			database_name: record.database_name,
			schema_name: record.schema_name,
			table_name: record.table_name,
			enabled: record.enabled ?? false,
			snapshot_request: record.snapshot_request ?? false,
			table_ddl_initialize: record.table_ddl_initialize ?? false,
			watermark_column_pattern: record.watermark_column_pattern ?? null,
			watermark_column: record.watermark_column ?? null,
			primary_key_columns: record.primary_key_columns ?? null,
			chunking_strategy: record.chunking_strategy ?? 'primary_key',
		});
		setIsEditDialogOpen(true);
	};

	const handleCreate = () => {
		setSelectedRecord(null);
		setFormData({
			database_name: '',
			schema_name: '',
			table_name: '',
			enabled: false,
			snapshot_request: false,
			table_ddl_initialize: false,
			watermark_column_pattern: null,
			watermark_column: null,
			primary_key_columns: null,
			chunking_strategy: 'primary_key',
		});
		setIsEditDialogOpen(true);
	};

	const handleInfo = (record: SnapshotState) => {
		setSelectedRecord(record);
		setIsInfoDialogOpen(true);
	};

	const handleDelete = (record: SnapshotState) => {
		setSelectedRecord(record);
		setIsDeleteDialogOpen(true);
	};

	const handleSave = async () => {
		if (!formData.database_name || !formData.schema_name || !formData.table_name) {
			toast({
				title: 'Validation Error',
				description: 'Database name, schema name, and table name are required',
				variant: 'destructive',
			});
			return;
		}

		setIsSubmitting(true);
		try {
			if (selectedRecord) {
				// Update existing record
				const updateData: SnapshotStateUpdateRequest = {
					enabled: formData.enabled,
					snapshot_request: formData.snapshot_request,
					table_ddl_initialize: formData.table_ddl_initialize,
					watermark_column_pattern: formData.watermark_column_pattern || null,
					watermark_column: formData.watermark_column || null,
					primary_key_columns: formData.primary_key_columns || null,
					chunking_strategy: formData.chunking_strategy || null,
				};
				await updateSnapshotState(
					selectedRecord.database_name,
					selectedRecord.schema_name,
					selectedRecord.table_name,
					updateData
				);
				toast({
					title: 'Success',
					description: 'Snapshot state updated successfully',
				});
			} else {
				// Create new record
				await createSnapshotState(formData);
				toast({
					title: 'Success',
					description: 'Snapshot state created successfully',
				});
			}
			queryClient.invalidateQueries({ queryKey: ['snapshot-states'] });
			setIsEditDialogOpen(false);
		} catch (error) {
			toast({
				title: 'Error',
				description: error instanceof Error ? error.message : 'Failed to save snapshot state',
				variant: 'destructive',
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDeleteConfirm = async () => {
		if (!selectedRecord) return;

		setIsSubmitting(true);
		try {
			await deleteSnapshotState(
				selectedRecord.database_name,
				selectedRecord.schema_name,
				selectedRecord.table_name
			);
			toast({
				title: 'Success',
				description: 'Snapshot state deleted successfully',
			});
			queryClient.invalidateQueries({ queryKey: ['snapshot-states'] });
			setIsDeleteDialogOpen(false);
			setSelectedRecord(null);
		} catch (error) {
			toast({
				title: 'Error',
				description: error instanceof Error ? error.message : 'Failed to delete snapshot state',
				variant: 'destructive',
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<>
			<PageHeader title="Openflow" group="Ingestion">
				<div className="flex items-center gap-2">
					<SnowflakeButton />
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						onClick={() => setIsPageInfoDialogOpen(true)}
						aria-label="Information about Openflow"
					>
						<Info className="h-4 w-4" />
					</Button>
					<Button
						onClick={handleCreate}
						className="hidden h-8 gap-1.5 px-3 has-[>svg]:px-2.5 text-sm sm:flex"
					>
						<Plus className="h-4 w-4" aria-hidden="true" />
						Create New
					</Button>
				</div>
			</PageHeader>
			<div className="flex flex-1 flex-col overflow-hidden">
				<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
					{/* Filter Bar */}
					<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
						<Input
							placeholder="Search by database, schema, or table name..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="flex-1 min-w-[200px]"
						/>
						<Select value={selectedEnabled} onValueChange={setSelectedEnabled}>
							<SelectTrigger className="w-full sm:w-[180px]">
								<SelectValue placeholder="Enabled Status" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All</SelectItem>
								<SelectItem value="enabled">Enabled</SelectItem>
								<SelectItem value="disabled">Disabled</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Data Table */}
					<div className="flex-1 overflow-auto rounded-lg border">
						<Table>
							<TableHeader className="sticky top-0 z-10 bg-background">
								<TableRow>
									<TableHead className="w-[200px]">
										<button
											onClick={() => toggleSort('database_name')}
											className="inline-flex items-center gap-1 hover:underline"
											aria-label="Sort by Database Name"
										>
											Database Name
											{sortKey !== 'database_name' ? (
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
											onClick={() => toggleSort('schema_name')}
											className="inline-flex items-center gap-1 hover:underline"
											aria-label="Sort by Schema Name"
										>
											Schema Name
											{sortKey !== 'schema_name' ? (
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
											onClick={() => toggleSort('table_name')}
											className="inline-flex items-center gap-1 hover:underline"
											aria-label="Sort by Table Name"
										>
											Table Name
											{sortKey !== 'table_name' ? (
												<ArrowUpDown className="ml-1 h-3 w-3" />
											) : sortDirection === 'asc' ? (
												<ArrowUp className="ml-1 h-3 w-3" />
											) : (
												<ArrowDown className="ml-1 h-3 w-3" />
											)}
										</button>
									</TableHead>
									<TableHead className="w-[120px] text-center">
										<button
											onClick={() => toggleSort('enabled')}
											className="inline-flex items-center gap-1 hover:underline mx-auto"
											aria-label="Sort by Enabled Status"
										>
											Enabled
											{sortKey !== 'enabled' ? (
												<ArrowUpDown className="ml-1 h-3 w-3" />
											) : sortDirection === 'asc' ? (
												<ArrowUp className="ml-1 h-3 w-3" />
											) : (
												<ArrowDown className="ml-1 h-3 w-3" />
											)}
										</button>
									</TableHead>
									<TableHead className="w-[180px] text-center">
										<button
											onClick={() => toggleSort('snapshot_interval_hours')}
											className="inline-flex items-center gap-1 hover:underline mx-auto"
											aria-label="Sort by Snapshot Interval"
										>
											Snapshot Interval (Hours)
											{sortKey !== 'snapshot_interval_hours' ? (
												<ArrowUpDown className="ml-1 h-3 w-3" />
											) : sortDirection === 'asc' ? (
												<ArrowUp className="ml-1 h-3 w-3" />
											) : (
												<ArrowDown className="ml-1 h-3 w-3" />
											)}
										</button>
									</TableHead>
									<TableHead className="w-[120px] text-center">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{error ? (
									<TableRow>
										<TableCell colSpan={6} className="h-24 text-center text-destructive">
											{error instanceof Error && error.message.includes("Can't find OpenFlow configuration table")
												? "Can't find OpenFlow configuration table"
												: `Error loading snapshot states: ${error instanceof Error ? error.message : 'Unknown error'}`}
										</TableCell>
									</TableRow>
								) : isLoading ? (
									<TableRow>
										<TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
											<Loader2 className="h-4 w-4 animate-spin inline-block mr-2" />
											Loading...
										</TableCell>
									</TableRow>
								) : filteredSnapshotStates.length === 0 ? (
									<TableRow>
										<TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
											{snapshotStates.length === 0
												? 'No snapshot states found'
												: 'No snapshot states match the current filters'}
										</TableCell>
									</TableRow>
								) : (
									filteredSnapshotStates.map((state) => (
										<TableRow key={`${state.database_name}.${state.schema_name}.${state.table_name}`}>
											<TableCell className="font-medium">{state.database_name}</TableCell>
											<TableCell>{state.schema_name}</TableCell>
											<TableCell>{state.table_name}</TableCell>
											<TableCell className="text-center">
												<StatusBadge
													label={state.enabled ? 'Yes' : 'No'}
													tone={state.enabled ? 'success' : 'muted'}
													indicator="none"
													className="mx-auto"
												/>
											</TableCell>
											<TableCell className="text-center">
												{state.snapshot_interval_hours ?? '-'}
											</TableCell>
											<TableCell>
												<div className="flex items-center justify-center">
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button
																variant="ghost"
																size="icon"
																className="h-8 w-8"
																aria-label="Open menu"
															>
																<MoreHorizontal className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem onClick={() => handleEdit(state)}>
																<Pencil className="mr-2 h-4 w-4" />
																Edit
															</DropdownMenuItem>
															<DropdownMenuItem onClick={() => handleInfo(state)}>
																<Info className="mr-2 h-4 w-4" />
																View Details
															</DropdownMenuItem>
															<DropdownMenuSeparator />
															<DropdownMenuItem
																onClick={() => handleDelete(state)}
																className="text-destructive focus:text-destructive"
															>
																<Trash2 className="mr-2 h-4 w-4" />
																Delete
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												</div>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</div>
			</div>

			{/* Edit/Create Dialog */}
			<Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
				<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{selectedRecord ? 'Edit Snapshot State' : 'Create Snapshot State'}</DialogTitle>
						<DialogDescription>
							{selectedRecord
								? 'Update the snapshot state configuration'
								: 'Create a new snapshot state configuration'}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="database_name">Database Name *</Label>
							<Input
								id="database_name"
								value={formData.database_name}
								onChange={(e) => setFormData({ ...formData, database_name: e.target.value })}
								disabled={!!selectedRecord}
								placeholder="e.g., pronto_erp"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="schema_name">Schema Name *</Label>
							<Input
								id="schema_name"
								value={formData.schema_name}
								onChange={(e) => setFormData({ ...formData, schema_name: e.target.value })}
								disabled={!!selectedRecord}
								placeholder="e.g., informix"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="table_name">Table Name *</Label>
							<Input
								id="table_name"
								value={formData.table_name}
								onChange={(e) => setFormData({ ...formData, table_name: e.target.value })}
								disabled={!!selectedRecord}
								placeholder="e.g., customers"
							/>
						</div>
						<div className="flex items-center space-x-2">
							<Checkbox
								id="enabled"
								checked={formData.enabled ?? false}
								onCheckedChange={(checked) =>
									setFormData({ ...formData, enabled: checked === true })
								}
							/>
							<Label htmlFor="enabled" className="cursor-pointer">
								Enabled
							</Label>
						</div>
						<div className="flex items-center space-x-2">
							<Checkbox
								id="snapshot_request"
								checked={formData.snapshot_request ?? false}
								onCheckedChange={(checked) =>
									setFormData({ ...formData, snapshot_request: checked === true })
								}
							/>
							<Label htmlFor="snapshot_request" className="cursor-pointer">
								Snapshot Request
							</Label>
						</div>
						<div className="flex items-center space-x-2">
							<Checkbox
								id="table_ddl_initialize"
								checked={formData.table_ddl_initialize ?? false}
								onCheckedChange={(checked) =>
									setFormData({ ...formData, table_ddl_initialize: checked === true })
								}
							/>
							<Label htmlFor="table_ddl_initialize" className="cursor-pointer">
								Table DDL Initialize
							</Label>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="watermark_column_pattern">Watermark Column Pattern</Label>
							<Input
								id="watermark_column_pattern"
								value={formData.watermark_column_pattern ?? ''}
								onChange={(e) =>
									setFormData({
										...formData,
										watermark_column_pattern: e.target.value || null,
									})
								}
								placeholder="e.g., last_modified"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="watermark_column">Watermark Column</Label>
							<Input
								id="watermark_column"
								value={formData.watermark_column ?? ''}
								onChange={(e) =>
									setFormData({
										...formData,
										watermark_column: e.target.value || null,
									})
								}
								placeholder="e.g., last_modified"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="primary_key_columns">Primary Key Columns (JSON)</Label>
							<Input
								id="primary_key_columns"
								value={formData.primary_key_columns ?? ''}
								onChange={(e) =>
									setFormData({
										...formData,
										primary_key_columns: e.target.value || null,
									})
								}
								placeholder='e.g., ["customer_id"]'
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="chunking_strategy">Chunking Strategy</Label>
							<Input
								id="chunking_strategy"
								value={formData.chunking_strategy ?? ''}
								onChange={(e) =>
									setFormData({
										...formData,
										chunking_strategy: e.target.value || null,
									})
								}
								placeholder="e.g., primary_key"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isSubmitting}>
							Cancel
						</Button>
						<Button onClick={handleSave} disabled={isSubmitting}>
							{isSubmitting ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Saving...
								</>
							) : (
								'Save'
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Snapshot State</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete the snapshot state for{' '}
							<strong>
								{selectedRecord?.database_name}.{selectedRecord?.schema_name}.{selectedRecord?.table_name}
							</strong>
							? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} disabled={isSubmitting}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleDeleteConfirm} disabled={isSubmitting}>
							{isSubmitting ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Deleting...
								</>
							) : (
								'Delete'
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Page Information Dialog */}
			<Dialog open={isPageInfoDialogOpen} onOpenChange={setIsPageInfoDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>About Openflow</DialogTitle>
						<DialogDescription>
							Information about the Openflow configuration page
						</DialogDescription>
					</DialogHeader>
					<div className="py-4">
						<p className="text-sm text-muted-foreground">
							This page is for controlling the configuration of Snowflake's Openflow. You can set configuration in this table without needing to enter Openflow directly. Use the table to manage snapshot states, including enabling or disabling snapshots, setting snapshot intervals, and configuring watermark columns for your databases, schemas, and tables.
						</p>
					</div>
					<DialogFooter>
						<Button onClick={() => setIsPageInfoDialogOpen(false)}>Got it</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Info Dialog */}
			<Dialog open={isInfoDialogOpen} onOpenChange={setIsInfoDialogOpen}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Snapshot State Details</DialogTitle>
						<DialogDescription>
							Complete information for{' '}
							{selectedRecord?.database_name}.{selectedRecord?.schema_name}.{selectedRecord?.table_name}
						</DialogDescription>
					</DialogHeader>
					{selectedRecord && (
						<div className="grid gap-4 py-4">
							<div className="grid grid-cols-2 gap-4">
								<div>
									<Label className="text-xs text-muted-foreground">Database Name</Label>
									<p className="text-sm font-medium">{selectedRecord.database_name}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Schema Name</Label>
									<p className="text-sm font-medium">{selectedRecord.schema_name}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Table Name</Label>
									<p className="text-sm font-medium">{selectedRecord.table_name}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Enabled</Label>
									<p className="text-sm font-medium">
										<StatusBadge
											label={selectedRecord.enabled ? 'Yes' : 'No'}
											tone={selectedRecord.enabled ? 'success' : 'muted'}
											indicator="none"
										/>
									</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Snapshot Request</Label>
									<p className="text-sm font-medium">
										<StatusBadge
											label={selectedRecord.snapshot_request ? 'Yes' : 'No'}
											tone={selectedRecord.snapshot_request ? 'success' : 'danger'}
											icon={selectedRecord.snapshot_request ? IconCircleCheckFilled : IconCircleXFilled}
											size="small"
										/>
									</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Table DDL Initialize</Label>
									<p className="text-sm font-medium">
										<StatusBadge
											label={selectedRecord.table_ddl_initialize ? 'Yes' : 'No'}
											tone={selectedRecord.table_ddl_initialize ? 'success' : 'danger'}
											icon={selectedRecord.table_ddl_initialize ? IconCircleCheckFilled : IconCircleXFilled}
											size="small"
										/>
									</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Chunking Strategy</Label>
									<p className="text-sm font-medium">{selectedRecord.chunking_strategy ?? '-'}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Watermark Column Pattern</Label>
									<p className="text-sm font-medium">{selectedRecord.watermark_column_pattern ?? '-'}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Watermark Column</Label>
									<p className="text-sm font-medium">{selectedRecord.watermark_column ?? '-'}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Primary Key Columns</Label>
									<p className="text-sm font-medium">{selectedRecord.primary_key_columns ?? '-'}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Snapshot Status</Label>
									<p className="text-sm font-medium">{selectedRecord.snapshot_status ?? '-'}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Last Snapshot Watermark</Label>
									<p className="text-sm font-medium">{selectedRecord.last_snapshot_watermark ?? '-'}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Last Snapshot Timestamp</Label>
									<p className="text-sm font-medium">{selectedRecord.last_snapshot_timestamp ?? '-'}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Created At</Label>
									<p className="text-sm font-medium">{selectedRecord.created_at ?? '-'}</p>
								</div>
								<div>
									<Label className="text-xs text-muted-foreground">Updated At</Label>
									<p className="text-sm font-medium">{selectedRecord.updated_at ?? '-'}</p>
								</div>
							</div>
						</div>
					)}
					<DialogFooter>
						<Button onClick={() => setIsInfoDialogOpen(false)}>Close</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
