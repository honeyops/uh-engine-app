'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/badges/status-badge';
import { Info, ArrowUp, ArrowDown, ArrowUpDown, CheckCircle2 } from 'lucide-react';
import { getGroups, getDimensions, getFacts, type Group, type Dimension, type Fact } from '@/lib/api/model-catalog';
import { useSearchParams } from 'next/navigation';
import { useModelCatalogWizard } from '@/lib/state/model-catalog-wizard';
import WizardModal from './_modal/wizard-modal';

interface TagSummary {
	domain?: string;
	process?: string;
	pii?: boolean | null;
}

interface Model {
	id: string;
	title: string;
	description: string;
	type: 'dimension' | 'fact';
	domain: string;
	process: string;
	belongs_to: string;
	deployed: boolean;
	roles: string[];
	pii: boolean | null;
	tagSummary: TagSummary;
}

const normalizeRoles = (value: Dimension['roles'] | Fact['roles']): string[] => {
	if (!value) return [];
	const rawList = Array.isArray(value) ? value : [value];
	const sanitized = rawList
		.map((role) => (typeof role === 'string' ? role.trim() : ''))
		.filter((role): role is string => Boolean(role));

	return Array.from(new Set(sanitized));
};

const normalizePiiFlag = (value: Dimension['pii'] | Fact['pii']): boolean | null => {
	if (value === null || value === undefined) {
		return null;
	}
	return Boolean(value);
};

export default function ModelCatalogPage() {
	const [searchTerm, setSearchTerm] = useState('');
	const [selectedDomain, setSelectedDomain] = useState<string>('all');
	const [selectedProcess, setSelectedProcess] = useState<string>('all');
	const [selectedType, setSelectedType] = useState<string>('all');
	const [selectedModels, setSelectedModels] = useState<string[]>([]);
	const [isPageInfoDialogOpen, setIsPageInfoDialogOpen] = useState(false);
	const [detailsModel, setDetailsModel] = useState<Model | null>(null);
	const [optimisticDeployedIds, setOptimisticDeployedIds] = useState<Set<string>>(() => new Set());

	type SortKey = 'title' | 'domain' | 'process' | 'type';
	const [sortKey, setSortKey] = useState<SortKey>('title');
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

	const toggleSort = (key: SortKey) => {
		if (key === sortKey) {
			setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
			return;
		}
		setSortKey(key);
		setSortDirection('asc');
	};

	const { data: groupsData, isLoading: groupsLoading, error: groupsError } = useQuery({
		queryKey: ['groups'],
		queryFn: getGroups,
	});

	const { data: dimensionsData, isLoading: dimensionsLoading, error: dimensionsError } = useQuery({
		queryKey: ['dimensions'],
		queryFn: () => getDimensions(),
	});

	const { data: factsData, isLoading: factsLoading, error: factsError } = useQuery({
		queryKey: ['facts'],
		queryFn: () => getFacts(),
	});

	const isLoading = groupsLoading || dimensionsLoading || factsLoading;
	const hasError = groupsError || dimensionsError || factsError;

	const groups = groupsData?.groups || [];
	const dimensions = dimensionsData?.dimensions || [];
	const facts = factsData?.facts || [];

	const models: Model[] = useMemo(() => {
		const allModels = [
			...dimensions.map((d) => ({
				id: d.id,
				title: d.name || d.id,
				description: d.description || 'Dimension table',
				type: 'dimension' as const,
				belongs_to: d.belongs_to,
				domain: '',
				process: '',
				deployed: Boolean(d.deployed),
				roles: normalizeRoles(d.roles),
				pii: normalizePiiFlag(d.pii),
			})),
			...facts.map((f) => ({
				id: f.id,
				title: f.name || f.id,
				description: f.description || 'Fact table',
				type: 'fact' as const,
				belongs_to: f.belongs_to,
				domain: '',
				process: '',
				deployed: Boolean(f.deployed),
				roles: normalizeRoles(f.roles),
				pii: normalizePiiFlag(f.pii),
			})),
		];

		return allModels.map((m) => {
			const group = groups.find((g) => g.id === m.belongs_to);
			const domain = group?.domain || '';
			const process = group?.process || '';
			return {
				...m,
				domain,
				process,
				tagSummary: {
					domain: group?.domain,
					process: group?.process,
					pii: m.pii,
				},
			};
		});
	}, [dimensions, facts, groups]);

	const modelsById = useMemo(() => {
		const map = new Map<string, Model>();
		models.forEach((model) => {
			map.set(model.id, model);
		});
		return map;
	}, [models]);

	const filteredModels = useMemo(() => {
		const term = searchTerm.toLowerCase();
		const filtered = models
			.filter((m) => {
				const name = m.title.toLowerCase();
				const domain = m.domain.toLowerCase();
				const process = m.process.toLowerCase();

				const matchesText =
					term.length === 0 || name.includes(term) || domain.includes(term) || process.includes(term);
				const matchesDomain = selectedDomain === 'all' || m.domain === selectedDomain;
				const matchesProcess = selectedProcess === 'all' || m.process === selectedProcess;
				const matchesType = selectedType === 'all' || m.type === selectedType;

				return matchesText && matchesDomain && matchesProcess && matchesType;
			});

		const compare = (a: Model, b: Model) => {
			const aVal = (a[sortKey] || '').toString().toLowerCase();
			const bVal = (b[sortKey] || '').toString().toLowerCase();
			if (aVal === bVal) {
				// Secondary sort by title for stable ordering
				return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
			}
			const base = aVal.localeCompare(bVal);
			return sortDirection === 'asc' ? base : -base;
		};

		return filtered.sort(compare);
	}, [models, searchTerm, selectedDomain, selectedProcess, selectedType, sortKey, sortDirection]);

	const domains = useMemo(() => {
		return Array.from(new Set(groups.map((g) => g.domain).filter((d): d is string => Boolean(d)))).sort();
	}, [groups]);

	const processes = useMemo(() => {
		return Array.from(new Set(groups.map((g) => g.process).filter((p): p is string => Boolean(p)))).sort();
	}, [groups]);

	const isModelDisabled = useCallback(
		(model: Model) => model.deployed || optimisticDeployedIds.has(model.id),
		[optimisticDeployedIds],
	);

	const selectableModelIds = useMemo(
		() => filteredModels.filter((model) => !isModelDisabled(model)).map((model) => model.id),
		[filteredModels, isModelDisabled],
	);

	const registerOptimisticDeployment = useCallback((ids: string[]) => {
		if (ids.length === 0) {
			return;
		}

		const uniqueIds = Array.from(
			new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
		);

		if (uniqueIds.length === 0) {
			return;
		}

		setOptimisticDeployedIds((prev) => {
			const next = new Set(prev);
			let changed = false;
			uniqueIds.forEach((id) => {
				if (!next.has(id)) {
					next.add(id);
					changed = true;
				}
			});
			return changed ? next : prev;
		});

		setSelectedModels((prev) => {
			const next = prev.filter((id) => !uniqueIds.includes(id));
			return next.length === prev.length ? prev : next;
		});
	}, []);

	useEffect(() => {
		if (models.length === 0) {
			return;
		}

		const persistedIds = new Set(models.filter((model) => model.deployed).map((model) => model.id));
		if (persistedIds.size === 0) {
			return;
		}

		setOptimisticDeployedIds((prev) => {
			if (prev.size === 0) {
				return prev;
			}

			let changed = false;
			const next = new Set(prev);
			persistedIds.forEach((id) => {
				if (next.delete(id)) {
					changed = true;
				}
			});
			return changed ? next : prev;
		});
	}, [models]);

	const handleModelToggle = (modelId: string) => {
		if (optimisticDeployedIds.has(modelId)) {
			return;
		}

		const model = modelsById.get(modelId);
		if (model?.deployed) {
			return;
		}

		setSelectedModels((prev) => {
			if (prev.includes(modelId)) {
				return prev.filter((id) => id !== modelId);
			} else {
				return [...prev, modelId];
			}
		});
	};

	const handleSelectAll = () => {
		const allSelected = selectableModelIds.every((id) => selectedModels.includes(id));

		if (allSelected) {
			setSelectedModels((prev) => prev.filter((id) => !selectableModelIds.includes(id)));
		} else {
			setSelectedModels((prev) => {
				const newIds = selectableModelIds.filter((id) => !prev.includes(id));
				return [...prev, ...newIds];
			});
		}
	};

	const isAllSelected = selectableModelIds.length > 0 && selectableModelIds.every((id) => selectedModels.includes(id));
	const isSomeSelected = filteredModels.some((m) => !isModelDisabled(m) && selectedModels.includes(m.id)) && !isAllSelected;
	const selectAllChecked = isAllSelected ? true : isSomeSelected ? 'indeterminate' : false;

	const wizard = useModelCatalogWizard();
	const sp = useSearchParams();

	const handleDeploy = () => {
		if (selectedModels.length === 0) return;
		wizard.open({ step: 'mapping', models: selectedModels });
	};

	// Auto-open via URL (?wizard=1&step=mapping|summary|deploy)
	useEffect(() => {
		const shouldOpen = sp.get('wizard') === '1';
		if (shouldOpen && !wizard.isOpen) {
			const stepParam = sp.get('step');
			const step = stepParam === 'summary' ? 'summary' : stepParam === 'deploy' ? 'deploy' : 'mapping';
			wizard.open({ step, models: selectedModels });
		}
	}, [sp, wizard, selectedModels]);

	// Deselect models when they become deployed
	useEffect(() => {
		setSelectedModels((prev) => {
			const deployedModelIds = models.filter((m) => m.deployed).map((m) => m.id);
			const stillSelected = prev.filter((id) => !deployedModelIds.includes(id));
			// Only update if there's a change to avoid unnecessary re-renders
			if (stillSelected.length !== prev.length) {
				return stillSelected;
			}
			return prev;
		});
	}, [models]);

const getTypeBadgeVariant = (type: string): 'default' | 'destructive' | 'outline' | 'secondary' => {
	switch (type.toLowerCase()) {
		case 'fact':
			return 'secondary';
		case 'dimension':
			return 'secondary';
		default:
			return 'outline';
	}
};

	const detailTagSummary = detailsModel?.tagSummary;
	const detailHasTags =
		Boolean(detailTagSummary?.domain) ||
		Boolean(detailTagSummary?.process) ||
		(detailTagSummary?.pii !== null && detailTagSummary?.pii !== undefined);

	return (
		<>
			<PageHeader title="Model Catalog" group="Modelling">
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8"
					onClick={() => setIsPageInfoDialogOpen(true)}
					aria-label="Information about Model Catalog"
				>
					<Info className="h-4 w-4" />
				</Button>
			</PageHeader>
			<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
				{/* Filter Bar */}
				<div className="flex flex-col gap-3 sm:flex-row">
					<Input
						placeholder="Search by name, domain, or process..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						className="flex-1"
					/>
					<Select value={selectedDomain} onValueChange={setSelectedDomain}>
						<SelectTrigger className="w-full sm:w-[180px]">
							<SelectValue placeholder="All Domains" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Domains</SelectItem>
							{domains.map((domain) => (
								<SelectItem key={domain} value={domain}>
									{domain}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select value={selectedProcess} onValueChange={setSelectedProcess}>
						<SelectTrigger className="w-full sm:w-[180px]">
							<SelectValue placeholder="All Processes" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Processes</SelectItem>
							{processes.map((process) => (
								<SelectItem key={process} value={process}>
									{process}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select value={selectedType} onValueChange={setSelectedType}>
						<SelectTrigger className="w-full sm:w-[180px]">
							<SelectValue placeholder="All Types" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Types</SelectItem>
							<SelectItem value="dimension">Dimension</SelectItem>
							<SelectItem value="fact">Fact</SelectItem>
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
										onClick={() => toggleSort('title')}
										className="inline-flex items-center gap-1 hover:underline"
										aria-label="Sort by Title"
									>
										Title
										{sortKey !== 'title' ? (
											<ArrowUpDown className="ml-1 h-3 w-3" />
										) : sortDirection === 'asc' ? (
											<ArrowUp className="ml-1 h-3 w-3" />
										) : (
											<ArrowDown className="ml-1 h-3 w-3" />
										)}
									</button>
								</TableHead>
								<TableHead className="w-[160px]">
									<button
										onClick={() => toggleSort('domain')}
										className="inline-flex items-center gap-1 hover:underline"
										aria-label="Sort by Domain"
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
								<TableHead className="w-[200px]">
									<button
										onClick={() => toggleSort('process')}
										className="inline-flex items-center gap-1 hover:underline"
										aria-label="Sort by Process"
									>
										Process
										{sortKey !== 'process' ? (
											<ArrowUpDown className="ml-1 h-3 w-3" />
										) : sortDirection === 'asc' ? (
											<ArrowUp className="ml-1 h-3 w-3" />
										) : (
											<ArrowDown className="ml-1 h-3 w-3" />
										)}
									</button>
								</TableHead>
								<TableHead className="min-w-[260px]">Description</TableHead>
								<TableHead className="w-[110px] text-center">
									<button
										onClick={() => toggleSort('type')}
										className="inline-flex items-center gap-1 hover:underline"
										aria-label="Sort by Type"
									>
										Type
										{sortKey !== 'type' ? (
											<ArrowUpDown className="ml-1 h-3 w-3" />
										) : sortDirection === 'asc' ? (
											<ArrowUp className="ml-1 h-3 w-3" />
										) : (
											<ArrowDown className="ml-1 h-3 w-3" />
										)}
									</button>
								</TableHead>
								<TableHead className="w-16 text-right">Info</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{hasError ? (
									<TableRow>
										<TableCell colSpan={7} className="h-24 text-center text-destructive">
											Error loading models. Please check the console for details.
											{groupsError && <div className="mt-2 text-xs">Groups: {String(groupsError)}</div>}
											{dimensionsError && <div className="mt-2 text-xs">Dimensions: {String(dimensionsError)}</div>}
											{factsError && <div className="mt-2 text-xs">Facts: {String(factsError)}</div>}
										</TableCell>
									</TableRow>
								) : isLoading ? (
									<TableRow>
										<TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
											Loading...
										</TableCell>
									</TableRow>
								) : filteredModels.length === 0 ? (
									<TableRow>
										<TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
											No models found
											<div className="mt-2 text-xs">
												Groups: {groups.length}, Dimensions: {dimensions.length}, Facts: {facts.length}
											</div>
										</TableCell>
									</TableRow>
								) : (
									filteredModels.map((model) => {
										const isDisabled = isModelDisabled(model);

										return (
											<TableRow
												key={model.id}
												className={`cursor-pointer ${isDisabled ? 'opacity-50 bg-muted/30' : ''}`}
												onClick={() => !isDisabled && handleModelToggle(model.id)}
											>
												<TableCell onClick={(e) => e.stopPropagation()}>
													<Checkbox
														checked={selectedModels.includes(model.id)}
														onCheckedChange={() => handleModelToggle(model.id)}
														aria-label={`Select ${model.title}`}
														disabled={isDisabled}
													/>
												</TableCell>
												<TableCell className="font-medium">
													{model.title}
													{isDisabled && (
														<span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
															<CheckCircle2 className="h-3 w-3" /> Deployed
														</span>
													)}
												</TableCell>
												<TableCell>{model.domain || '-'}</TableCell>
												<TableCell>{model.process || '-'}</TableCell>
												<TableCell>{model.description}</TableCell>
												<TableCell className="text-center">
													<Badge variant={getTypeBadgeVariant(model.type)} className="capitalize">
														{model.type}
													</Badge>
												</TableCell>
												<TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
													<TooltipProvider delayDuration={100}>
														<Tooltip>
															<TooltipTrigger asChild>
																<Button
																	type="button"
																	size="icon"
																	variant="ghost"
																	className="h-8 w-8"
																	onClick={() => setDetailsModel(model)}
																	aria-label={`View details for ${model.title}`}
																>
																	<Info className="h-4 w-4" />
																</Button>
															</TooltipTrigger>
															<TooltipContent side="left">View model details</TooltipContent>
														</Tooltip>
													</TooltipProvider>
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
						{selectedModels.length > 0
							? `${selectedModels.length} model${selectedModels.length === 1 ? '' : 's'} selected`
							: 'No models selected'}
					</div>
					<Button onClick={handleDeploy} disabled={selectedModels.length === 0}>
						Deploy
					</Button>
				</div>
			</div>
			<WizardModal onDeploymentSuccess={registerOptimisticDeployment} />

			{/* Model details dialog */}
			<Dialog open={Boolean(detailsModel)} onOpenChange={(open) => !open && setDetailsModel(null)}>
				<DialogContent>
					{detailsModel && (
						<>
							<DialogHeader>
								<DialogTitle>{detailsModel.title}</DialogTitle>
								<DialogDescription>{detailsModel.description}</DialogDescription>
							</DialogHeader>
							<div className="space-y-4">
								<div className="grid gap-3 text-sm sm:grid-cols-2">
									<div>
										<p className="text-muted-foreground">Domain</p>
										<p className="font-medium">{detailsModel.domain || '-'}</p>
									</div>
									<div>
										<p className="text-muted-foreground">Process</p>
										<p className="font-medium">{detailsModel.process || '-'}</p>
									</div>
									<div>
										<p className="text-muted-foreground">Blueprint</p>
										<p className="font-medium">{detailsModel.belongs_to || '-'}</p>
									</div>
									<div className="flex flex-col gap-1">
										<p className="text-muted-foreground">Type</p>
										<Badge variant={getTypeBadgeVariant(detailsModel.type)} className="capitalize">
											{detailsModel.type}
										</Badge>
									</div>
								</div>
								<div className="space-y-2">
									<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roles</p>
									{detailsModel.roles.length > 0 ? (
										<div className="flex flex-wrap gap-1.5">
											{detailsModel.roles.map((role) => (
												<StatusBadge
													key={role}
													label={role}
													tone="neutral"
													indicator="none"
													appearance="mono"
													className="text-[11px] font-mono uppercase tracking-tight"
												/>
											))}
										</div>
									) : (
										<p className="text-sm text-muted-foreground">No roles defined</p>
									)}
								</div>
								<div className="space-y-2">
									<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</p>
									{detailHasTags && detailTagSummary ? (
										<div className="flex flex-wrap gap-1.5">
											{detailTagSummary.domain && (
												<StatusBadge
													label={`Domain: ${detailTagSummary.domain}`}
													tone="info"
													indicator="none"
													appearance="mono"
													className="text-[11px] tracking-tight"
												/>
											)}
											{detailTagSummary.process && (
												<StatusBadge
													label={`Process: ${detailTagSummary.process}`}
													tone="info"
													indicator="none"
													appearance="mono"
													className="text-[11px] tracking-tight"
												/>
											)}
											{detailTagSummary.pii !== null && detailTagSummary.pii !== undefined && (
												<StatusBadge
													label={`PII: ${detailTagSummary.pii ? 'Yes' : 'No'}`}
													tone={detailTagSummary.pii ? 'danger' : 'neutral'}
													indicator="none"
													appearance="mono"
													className="text-[11px] tracking-tight"
												/>
											)}
										</div>
									) : (
										<p className="text-sm text-muted-foreground">No tags defined</p>
									)}
								</div>
							</div>
							<DialogFooter>
								<Button variant="secondary" onClick={() => setDetailsModel(null)}>
									Close
								</Button>
							</DialogFooter>
						</>
					)}
				</DialogContent>
			</Dialog>

			{/* Page Information Dialog */}
			<Dialog open={isPageInfoDialogOpen} onOpenChange={setIsPageInfoDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>About Model Catalog</DialogTitle>
						<DialogDescription>
							Information about the Model Catalog
						</DialogDescription>
					</DialogHeader>
					<div className="py-4 space-y-4">
						<p className="text-sm text-muted-foreground">
							This is a curated list of models available for deployment. These models are configured to build from your clean and organized data. To successfully deploy a model, you need to ensure that all required sources for the model are mapped into the required blueprints.
						</p>
						<p className="text-sm text-muted-foreground">
							A blueprint is simply a templated expectation of the source data required for downstream modeling. Think of it as a specification that defines what data structure and fields are needed from your source systems to build the dimensional models. Before deploying a model, make sure you have mapped your source data to all the blueprints that the model depends on.
						</p>
						<p className="text-sm text-muted-foreground font-medium">
							Note: When you select models and click Deploy, the blueprint is automatically selected based on the models you've chosen. The deployment wizard will guide you through mapping your source data to the required blueprint fields.
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
