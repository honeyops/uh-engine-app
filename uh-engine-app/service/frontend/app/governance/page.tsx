'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Info, Loader2, Pencil, UserPlus, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, CheckCircle2, Circle } from 'lucide-react';
import {
	assignContacts,
	createContact,
	getContacts,
	getGovernanceObjects,
	getModelGovernance,
	assignModelContacts,
	type ContactAssignmentRequest,
	type ContactMethod,
	type ContactRecord,
	type GovernanceObject,
	type GovernanceObjectType,
	type ModelGovernanceObject,
	type ModelType,
} from '@/lib/api/governance';

const UNASSIGNED_VALUE = '__unassigned';

type SortKey = 'domain' | 'model_name' | 'model_type';

const renderContactValue = (value?: string | null) => {
	if (!value) {
		return (
			<Badge variant="outline" className="gap-1 text-muted-foreground px-1.5">
				<Loader2 className="h-3 w-3" />
				Unassigned
			</Badge>
		);
	}
	return (
		<Badge variant="outline" className="gap-1 text-muted-foreground px-1.5">
			<CheckCircle2 className="h-3 w-3 fill-green-500 dark:fill-green-400" />
			{value}
		</Badge>
	);
};

export default function GovernancePage() {
	const queryClient = useQueryClient();
	const { toast } = useToast();

	const [searchTerm, setSearchTerm] = useState('');
	const [domainFilter, setDomainFilter] = useState('all');
	const [typeFilter, setTypeFilter] = useState('all');
	const [sortKey, setSortKey] = useState<SortKey>('domain');
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
	const [currentPage, setCurrentPage] = useState(1);
	const [pageSize, setPageSize] = useState(50);

	const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
	const [isPageInfoDialogOpen, setIsPageInfoDialogOpen] = useState(false);
	const [isDescriptionDialogOpen, setIsDescriptionDialogOpen] = useState(false);
	const [selectedDescription, setSelectedDescription] = useState<string | null>(null);

	const [selectedObject, setSelectedObject] = useState<ModelGovernanceObject | null>(null);
	const [assignForm, setAssignForm] = useState<Record<'STEWARD' | 'SUPPORT' | 'ACCESS_APPROVAL', string>>({
		STEWARD: '',
		SUPPORT: '',
		ACCESS_APPROVAL: '',
	});

	const [newContactForm, setNewContactForm] = useState<{
		name: string;
		method: ContactMethod;
		value: string;
	}>({
		name: '',
		method: 'EMAIL',
		value: '',
	});

	const {
		data,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: ['modelGovernance'],
		queryFn: () => getModelGovernance(),
	});

	const {
		data: contactsData,
		isLoading: contactsLoading,
		error: contactsError,
	} = useQuery({
		queryKey: ['governance-contacts'],
		queryFn: getContacts,
	});

	const contacts = contactsData?.contacts ?? [];

	const uniqueDomains = useMemo(() => {
		if (!data?.models) return [];
		const domains = Array.from(new Set(data.models.map((model) => model.domain)));
		return domains.sort();
	}, [data?.models]);

	const uniqueTypes = useMemo(() => {
		if (!data?.models) return [];
		const types = Array.from(new Set(data.models.map((model) => model.model_type)));
		return types.sort();
	}, [data?.models]);

	const filteredAndSortedData = useMemo(() => {
		if (!data?.models) return [];

		let filtered = data.models;

		// Apply search filter
		if (searchTerm) {
			const lowerSearch = searchTerm.toLowerCase();
			filtered = filtered.filter((model) =>
				model.model_name.toLowerCase().includes(lowerSearch) ||
				model.domain.toLowerCase().includes(lowerSearch)
			);
		}

		// Apply domain filter
		if (domainFilter !== 'all') {
			filtered = filtered.filter((model) => model.domain === domainFilter);
		}

		// Apply type filter
		if (typeFilter !== 'all') {
			filtered = filtered.filter((model) => model.model_type === typeFilter);
		}

		// Apply sorting
		const sorted = [...filtered].sort((a, b) => {
			let aVal: string | undefined;
			let bVal: string | undefined;

			if (sortKey === 'domain') {
				aVal = a.domain;
				bVal = b.domain;
			} else if (sortKey === 'model_name') {
				aVal = a.model_name;
				bVal = b.model_name;
			} else if (sortKey === 'model_type') {
				aVal = a.model_type;
				bVal = b.model_type;
			}

			if (!aVal || !bVal) return 0;

			const comparison = aVal.localeCompare(bVal);
			return sortDirection === 'asc' ? comparison : -comparison;
		});

		return sorted;
	}, [data?.models, searchTerm, domainFilter, typeFilter, sortKey, sortDirection]);

	const toggleSort = (key: SortKey) => {
		if (key === sortKey) {
			setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
			return;
		}
		setSortKey(key);
		setSortDirection('asc');
	};

	// Note: Filtering and sorting are now handled client-side on the paginated results
	// For better performance with large datasets, consider moving filtering to the backend
	// Reset to page 1 when filters change
	useEffect(() => {
		setCurrentPage(1);
	}, [searchTerm, domainFilter, typeFilter]);

	const createContactMutation = useMutation({
		mutationFn: createContact,
		onSuccess: (response) => {
			toast({
				title: 'Contact created',
				description: response.message,
			});
			setIsCreateDialogOpen(false);
			setNewContactForm({
				name: '',
				method: 'EMAIL',
				value: '',
			});
			queryClient.invalidateQueries({ queryKey: ['governance-contacts'] });
			// If opened from assign dialog, keep it open so user can select the new contact
			if (isAssignDialogOpen) {
				// Don't close assign dialog, just refresh contacts
			}
		},
		onError: (error: unknown) => {
			toast({
				title: 'Unable to create contact',
				description: error instanceof Error ? error.message : 'Unknown error',
				variant: 'destructive',
			});
		},
	});

	const assignContactsMutation = useMutation({
		mutationFn: assignModelContacts,
		onSuccess: (response) => {
			toast({
				title: 'Contacts updated',
				description: response.message,
			});
			setIsAssignDialogOpen(false);
			setSelectedObject(null);
			queryClient.invalidateQueries({ queryKey: ['governance-objects'] });
		},
		onError: (error: unknown) => {
			toast({
				title: 'Unable to update contacts',
				description: error instanceof Error ? error.message : 'Unknown error',
				variant: 'destructive',
			});
		},
	});

	useEffect(() => {
		if (selectedObject && isAssignDialogOpen) {
			setAssignForm({
				STEWARD: selectedObject.steward_contact ?? '',
				SUPPORT: selectedObject.support_contact ?? '',
				ACCESS_APPROVAL: selectedObject.approver_contact ?? '',
			});
		}
	}, [selectedObject, isAssignDialogOpen]);

	const handleOpenAssignDialog = (model: ModelGovernanceObject) => {
		setSelectedObject(model);
		setAssignForm({
			STEWARD: model.steward_contact || UNASSIGNED_VALUE,
			SUPPORT: model.support_contact || UNASSIGNED_VALUE,
			ACCESS_APPROVAL: model.approver_contact || UNASSIGNED_VALUE,
		});
		setIsAssignDialogOpen(true);
	};

	const handleSaveAssignments = () => {
		if (!selectedObject) return;
		const payload = {
			model_id: selectedObject.model_id,
			model_type: selectedObject.model_type,
			assignments: (Object.keys(assignForm) as Array<keyof typeof assignForm>).map((purpose) => ({
				purpose,
				contact_name: assignForm[purpose] !== UNASSIGNED_VALUE ? assignForm[purpose] : null,
			})),
		};
		assignContactsMutation.mutate(payload);
	};

	const handleCreateContact = () => {
		if (!newContactForm.name.trim() || !newContactForm.value.trim()) {
			toast({
				title: 'Missing information',
				description: 'Name and contact details are required',
				variant: 'destructive',
			});
			return;
		}
		let value: string | string[] = newContactForm.value.trim();
		if (newContactForm.method === 'USERS') {
			value = newContactForm.value
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean);
		}
		createContactMutation.mutate({
			name: newContactForm.name.trim(),
			method: newContactForm.method,
			value,
		});
	};

	return (
		<>
			<PageHeader title="Governance" group="Modelling">
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						onClick={() => setIsPageInfoDialogOpen(true)}
						aria-label="Governance help"
					>
						<Info className="h-4 w-4" />
					</Button>
					<Button onClick={() => setIsCreateDialogOpen(true)}>
						<UserPlus className="mr-2 h-4 w-4" />
						New Contact
					</Button>
				</div>
			</PageHeader>
			<div className="flex flex-1 flex-col overflow-hidden">
				<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
					<div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
						<Input
							placeholder="Search by model or domain name..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="w-full lg:max-w-xs"
						/>
						<select
							value={domainFilter}
							onChange={(e) => setDomainFilter(e.target.value)}
							className="w-full h-9 px-3 py-1 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring lg:max-w-[200px]"
						>
							<option value="all">All Domains</option>
							{uniqueDomains.map((domain) => (
								<option key={domain} value={domain}>
									{domain}
								</option>
							))}
						</select>
						<select
							value={typeFilter}
							onChange={(e) => setTypeFilter(e.target.value)}
							className="w-full h-9 px-3 py-1 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring lg:max-w-[200px]"
						>
							<option value="all">All Types</option>
							{uniqueTypes.map((type) => (
								<option key={type} value={type}>
									{type === 'dimension' ? 'Dimension' : 'Fact'}
								</option>
							))}
						</select>
					</div>

					<div className="flex-1 overflow-auto rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow className="bg-muted/50">
									<TableHead className="w-[180px]">
										<button
											type="button"
											onClick={() => toggleSort('domain')}
											className="inline-flex items-center gap-1 hover:underline"
										>
											Domain
											{sortKey !== 'domain' ? (
												<ArrowUpDown className="ml-1 h-3 w-3" />
											) : sortDirection === 'asc' ? (
												<ArrowUp className="ml-1 h-3 w-3" />
											) : (
												<ArrowDown className="ml-1 h-3 w-3" />
											)}
										</button>
									</TableHead>
									<TableHead className="w-[220px]">
										<button
											type="button"
											onClick={() => toggleSort('model_name')}
											className="inline-flex items-center gap-1 hover:underline"
										>
											Model
											{sortKey !== 'model_name' ? (
												<ArrowUpDown className="ml-1 h-3 w-3" />
											) : sortDirection === 'asc' ? (
												<ArrowUp className="ml-1 h-3 w-3" />
											) : (
												<ArrowDown className="ml-1 h-3 w-3" />
											)}
										</button>
									</TableHead>
									<TableHead className="w-[140px]">
										<button
											type="button"
											onClick={() => toggleSort('model_type')}
											className="inline-flex items-center gap-1 hover:underline"
										>
											Type
											{sortKey !== 'model_type' ? (
												<ArrowUpDown className="ml-1 h-3 w-3" />
											) : sortDirection === 'asc' ? (
												<ArrowUp className="ml-1 h-3 w-3" />
											) : (
												<ArrowDown className="ml-1 h-3 w-3" />
											)}
										</button>
									</TableHead>
									<TableHead>Steward</TableHead>
									<TableHead>Support</TableHead>
									<TableHead>Approver</TableHead>
									<TableHead className="w-[80px] text-center">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{error ? (
									<TableRow>
										<TableCell colSpan={7} className="h-24 text-center text-destructive">
											Error loading models: {error instanceof Error ? error.message : 'Unknown error'}
										</TableCell>
									</TableRow>
								) : isLoading ? (
									<TableRow>
										<TableCell colSpan={7} className="h-24 text-center">
											<Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
										</TableCell>
									</TableRow>
								) : filteredAndSortedData.length === 0 ? (
									<TableRow>
										<TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
											{data?.models?.length === 0
												? 'No dimensional models found. Please check your configuration.'
												: 'No models match the current filters.'}
										</TableCell>
									</TableRow>
								) : (
									filteredAndSortedData.map((model) => (
										<TableRow key={model.model_id}>
											<TableCell className="font-medium">{model.domain}</TableCell>
											<TableCell>
												<span className="font-medium">{model.model_name}</span>
											</TableCell>
											<TableCell>
												<Badge variant="secondary" className="capitalize">
													{model.model_type}
												</Badge>
											</TableCell>
											<TableCell>{renderContactValue(model.steward_contact)}</TableCell>
											<TableCell>{renderContactValue(model.support_contact)}</TableCell>
											<TableCell>{renderContactValue(model.approver_contact)}</TableCell>
											<TableCell>
												<div className="flex items-center justify-center gap-1">
													<Button
														variant="ghost"
														size="icon"
														className="h-8 w-8"
														onClick={() => handleOpenAssignDialog(model)}
														aria-label="Manage contacts"
													>
														<Pencil className="h-4 w-4" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>

					{filteredAndSortedData.length > 0 && (
						<div className="flex items-center justify-between border-t pt-4">
							<div className="text-sm text-muted-foreground">
								Showing {filteredAndSortedData.length} of {data?.total || 0} models
							</div>
						</div>
					)}
				</div>
			</div>

			<Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
				<DialogContent className="max-w-xl">
					<DialogHeader>
						<DialogTitle>Manage contacts</DialogTitle>
						<DialogDescription>
							Assign contacts to {selectedObject?.model_type} "{selectedObject?.model_name}" (applies to all component objects)
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						{(['STEWARD', 'SUPPORT', 'ACCESS_APPROVAL'] as const).map((purpose) => (
							<div className="grid gap-2" key={purpose}>
								<div className="flex items-center justify-between">
									<Label className="text-sm">{purpose === 'ACCESS_APPROVAL' ? 'Approver' : purpose}</Label>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 text-xs"
										onClick={() => {
											setIsCreateDialogOpen(true);
										}}
									>
										<UserPlus className="mr-1 h-3 w-3" />
										New Contact
									</Button>
								</div>
								<Select
									value={assignForm[purpose] || UNASSIGNED_VALUE}
									onValueChange={(value) =>
										setAssignForm((prev) => ({
											...prev,
											[purpose]: value === UNASSIGNED_VALUE ? '' : value,
										}))
									}
									disabled={contactsLoading}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select contact" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
										{contacts.map((contact: ContactRecord) => (
											<SelectItem key={contact.name} value={contact.name}>
												{contact.name}
												{contact.communication_type && (
													<span className="ml-2 text-xs text-muted-foreground">
														({contact.communication_type.toLowerCase()})
													</span>
												)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						))}
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsAssignDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleSaveAssignments} disabled={assignContactsMutation.isPending}>
							{assignContactsMutation.isPending ? (
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

			<Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>Create Snowflake contact</DialogTitle>
						<DialogDescription>
							Contacts can be reused across schemas and tables. Configure the communication method according to your Snowflake account policy.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="contact_name">Contact name</Label>
							<Input
								id="contact_name"
								value={newContactForm.name}
								onChange={(e) => setNewContactForm((prev) => ({ ...prev, name: e.target.value }))}
								placeholder="e.g. data_stewards"
							/>
						</div>
						<div className="grid gap-2">
							<Label>Communication method</Label>
							<Select
								value={newContactForm.method}
								onValueChange={(value: ContactMethod) =>
									setNewContactForm((prev) => ({ ...prev, method: value, value: '' }))
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select method" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="EMAIL">Email distribution list</SelectItem>
									<SelectItem value="URL">URL</SelectItem>
									<SelectItem value="USERS">Snowflake users</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="contact_value">
								{newContactForm.method === 'EMAIL'
									? 'Email or distribution list'
									: newContactForm.method === 'URL'
									? 'Support URL'
									: 'Usernames (comma separated)'}
							</Label>
							<Input
								id="contact_value"
								value={newContactForm.value}
								onChange={(e) => setNewContactForm((prev) => ({ ...prev, value: e.target.value }))}
								placeholder={
									newContactForm.method === 'USERS' ? 'alice,bob' : 'support@example.com or https://...'
								}
							/>
							{newContactForm.method === 'USERS' && (
								<p className="text-xs text-muted-foreground">
									Separate usernames with commas. They must exist in Snowflake.
								</p>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleCreateContact} disabled={createContactMutation.isPending}>
							{createContactMutation.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Creating...
								</>
							) : (
								'Create'
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={isDescriptionDialogOpen} onOpenChange={setIsDescriptionDialogOpen}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>Schema Description</DialogTitle>
					</DialogHeader>
					<div className="py-4">
						<p className="text-sm text-muted-foreground">{selectedDescription || 'No description available.'}</p>
					</div>
					<DialogFooter>
						<Button onClick={() => setIsDescriptionDialogOpen(false)}>Close</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={isPageInfoDialogOpen} onOpenChange={setIsPageInfoDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>About governance contacts</DialogTitle>
						<DialogDescription>
							Use this page to validate Snowflake objects that come from your configured database layers and to manage the contacts attached to those tables.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4 text-sm text-muted-foreground">
						<p>
							Objects are sourced from <code>configuration/database.yaml</code>. After a model is deployed,
							you can add steward, support and approver contacts so downstream consumers know who to reach out to.
						</p>
						<p>
							Contact assignments execute Snowflake{' '}
							<code>ALTER &lt;object&gt; SET CONTACT</code> statements as documented in{' '}
							<a
								className="text-primary underline"
								href="https://docs.snowflake.com/user-guide/contacts-using"
								target="_blank"
								rel="noreferrer"
							>
								the Snowflake contacts guide
							</a>
							.
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
