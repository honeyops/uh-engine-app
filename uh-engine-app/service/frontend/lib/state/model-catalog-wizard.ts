import { create } from 'zustand'

export type BlueprintKey = string // e.g., `${source}.${name}`

export type DatabaseBinding = {
	db: string
	schema: string
	table: string
}

export type WizardStatusColor = 'red' | 'orange' | 'green' | 'grey'

export type BindingMappings = Record<string, string>

export type DeploymentLog = {
	message: string
	level: string
	step: string
	object_name: string
	timestamp: string
}

export type MilestoneStatus = 'pending' | 'in_progress' | 'success' | 'error'

export type DeploymentMilestone = {
	id: string
	label: string
	status: MilestoneStatus
}

type WizardStore = {
	// Modal open/step
	isOpen: boolean
	step: 'mapping' | 'summary' | 'deploy'

	// Selection/context
	selectedModelIds: string[]
	blueprintCatalog: Array<any>
	selectedBlueprintKey: BlueprintKey | ''

	// Database selections and per-blueprint persistence
	blueprintDatabaseBindings: Record<BlueprintKey, DatabaseBinding>
	bindingMappings: BindingMappings
	blueprintStatuses: Record<BlueprintKey, WizardStatusColor>

	// Blueprint bindings cache (to avoid re-fetching from Snowflake)
	blueprintBindingsCache: Record<BlueprintKey, any>

	// Per-blueprint dirty state tracking
	blueprintDirtyState: Record<BlueprintKey, boolean>

	// Modal loader caches
	databasesSchemas: Array<{ database: string; schemas: string[] }>
	schemaTables: Record<string, any[]> // Key: "DB.SCHEMA" -> tables
	tableFields: Record<string, any[]>  // Key: "DB.SCHEMA.TABLE" -> fields
	isLoadingModalData: boolean

	// Logs for deployment
	logLines: DeploymentLog[]
	isDeploying: boolean
	deploymentMilestones: DeploymentMilestone[]
	deploymentAlertStatus: 'pending' | 'deploying' | 'success' | 'error'
	isMinimized: boolean
	deploymentProgress: number

	// Save callback for current blueprint
	currentBlueprintSaveHandler: (() => Promise<boolean>) | null

	// Setters
	open: (opts?: { step?: 'mapping' | 'summary' | 'deploy'; models?: string[] }) => void
	close: () => void
	setStep: (s: 'mapping' | 'summary' | 'deploy') => void
	setSelectedModels: (ids: string[]) => void
	setBlueprintCatalog: (b: Array<any>) => void
	setSelectedBlueprintKey: (k: BlueprintKey | '') => void
	setDatabaseBinding: (k: BlueprintKey, db: string, schema: string, table: string, markDirty?: boolean) => void
	setBindingMappings: (updater: (m: BindingMappings) => BindingMappings, markDirty?: boolean) => void
	setBlueprintStatus: (k: BlueprintKey, status: WizardStatusColor) => void
	setBlueprintBindingsCache: (k: BlueprintKey, data: any) => void
	setDirtyState: (k: BlueprintKey, dirty: boolean) => void
	getDirtyState: (k: BlueprintKey) => boolean
	setDatabasesSchemas: (data: Array<{ database: string; schemas: string[] }>) => void
	setSchemaTables: (schemaKey: string, tables: any[]) => void
	setTableFields: (tableKey: string, fields: any[]) => void
	setIsLoadingModalData: (value: boolean) => void
	appendLog: (message: string, level?: string, step?: string, object_name?: string, timestamp?: string) => void
	clearLogs: () => void
	setIsDeploying: (value: boolean) => void
	setDeploymentMilestones: (milestones: DeploymentMilestone[]) => void
	updateMilestoneStatus: (id: string, status: MilestoneStatus) => void
	setDeploymentAlertStatus: (status: 'pending' | 'deploying' | 'success' | 'error') => void
	setIsMinimized: (value: boolean) => void
	setDeploymentProgress: (value: number) => void
	setCurrentBlueprintSaveHandler: (handler: (() => Promise<boolean>) | null) => void
	hasBlueprintBindings: (k: BlueprintKey) => boolean
	clearBlueprintBindings: (k: BlueprintKey) => void
	reset: () => void
}

export const useModelCatalogWizard = create<WizardStore>((set, get) => ({
	isOpen: false,
	step: 'mapping',
	selectedModelIds: [],
	blueprintCatalog: [],
	selectedBlueprintKey: '',
	blueprintDatabaseBindings: {},
	bindingMappings: {},
	blueprintStatuses: {},
	blueprintBindingsCache: {},
	blueprintDirtyState: {},
	databasesSchemas: [],
	schemaTables: {},
	tableFields: {},
	isLoadingModalData: false,
	logLines: [],
	isDeploying: false,
	deploymentMilestones: [],
	deploymentAlertStatus: 'pending',
	isMinimized: false,
	deploymentProgress: 0,
	currentBlueprintSaveHandler: null,

	open: (opts) => set({
		isOpen: true,
		isMinimized: false,
		step: opts?.step ?? 'mapping',
		selectedModelIds: opts?.models ?? [],
	}),
	close: () => {
		const state = get()
		// If deploying, minimize instead of closing
		if (state.isDeploying) {
			set({ isMinimized: true })
		} else {
			set({ isOpen: false, isMinimized: false })
		}
	},
	setStep: (s) => set({ step: s }),
	setSelectedModels: (ids) => set({ selectedModelIds: ids }),
	setBlueprintCatalog: (b) => set({ blueprintCatalog: b }),
	setSelectedBlueprintKey: (k) => set({ selectedBlueprintKey: k }),
	setDatabaseBinding: (k, db, schema, table, markDirty = true) => set((s) => {
		// Check if binding actually changed
		const existing = s.blueprintDatabaseBindings[k]
		const changed = !existing || existing.db !== db || existing.schema !== schema || existing.table !== table

		return {
			blueprintDatabaseBindings: {
				...s.blueprintDatabaseBindings,
				[k]: { db, schema, table },
			},
			blueprintDirtyState: (changed && markDirty) ? {
				...s.blueprintDirtyState,
				[k]: true,
			} : s.blueprintDirtyState,
		}
	}),
	setBindingMappings: (updater, markDirty = true) => set((s) => {
		const k = s.selectedBlueprintKey
		const newMappings = updater(s.bindingMappings)

		return {
			bindingMappings: newMappings,
			blueprintDirtyState: (k && markDirty) ? {
				...s.blueprintDirtyState,
				[k]: true,
			} : s.blueprintDirtyState,
		}
	}),
	setBlueprintStatus: (k, status) => set((s) => ({
		blueprintStatuses: { ...s.blueprintStatuses, [k]: status },
	})),
	setBlueprintBindingsCache: (k, data) => set((s) => ({
		blueprintBindingsCache: { ...s.blueprintBindingsCache, [k]: data },
	})),
	setDirtyState: (k, dirty) => set((s) => ({
		blueprintDirtyState: { ...s.blueprintDirtyState, [k]: dirty },
	})),
	getDirtyState: (k) => {
		return get().blueprintDirtyState[k] || false
	},
	setDatabasesSchemas: (data) => set({ databasesSchemas: data }),
	setSchemaTables: (schemaKey, tables) => set((s) => ({
		schemaTables: { ...s.schemaTables, [schemaKey]: tables },
	})),
	setTableFields: (tableKey, fields) => set((s) => ({
		tableFields: { ...s.tableFields, [tableKey]: fields },
	})),
	setIsLoadingModalData: (value) => set({ isLoadingModalData: value }),
	appendLog: (message, level = 'INFO', step = '', object_name = '', timestamp = '') => set((s) => ({
		logLines: [...s.logLines, {
			message,
			level,
			step,
			object_name,
			timestamp: timestamp || new Date().toISOString()
		}]
	})),
	clearLogs: () => set({ logLines: [] }),
	setIsDeploying: (value) => set({ isDeploying: value }),
	setDeploymentMilestones: (milestones) => set({ deploymentMilestones: milestones }),
	updateMilestoneStatus: (id, status) => set((s) => ({
		deploymentMilestones: s.deploymentMilestones.map(m =>
			m.id === id ? { ...m, status } : m
		)
	})),
	setDeploymentAlertStatus: (status) => set({ deploymentAlertStatus: status }),
	setIsMinimized: (value) => set({ isMinimized: value }),
	setDeploymentProgress: (value) => set({ deploymentProgress: value }),
	setCurrentBlueprintSaveHandler: (handler) => set({ currentBlueprintSaveHandler: handler }),
	hasBlueprintBindings: (k) => {
		if (!k) return false
		const state = useModelCatalogWizard.getState()
		
		// First check: if there's a table currently bound, that means bindings exist
		const currentBinding = state.blueprintDatabaseBindings[k]
		if (currentBinding?.table && currentBinding.table.trim() !== '') {
			return true
		}
		
		// Second check: if there are any non-empty bindings in local state
		const bindingKeys = Object.keys(state.bindingMappings)
		return bindingKeys.some((key) => {
			const value = state.bindingMappings[key]
			return value && typeof value === 'string' && value.trim() !== '' && value !== '__none__'
		})
	},
	clearBlueprintBindings: (k) => set((s) => {
		// Clear all bindings - when table changes, field-bindings will reload from server
		return { bindingMappings: {} }
	}),
	reset: () => set({
		isOpen: false,
		step: 'mapping',
		selectedModelIds: [],
		blueprintCatalog: [],
		selectedBlueprintKey: '',
		blueprintDatabaseBindings: {},
		bindingMappings: {},
		blueprintStatuses: {},
		blueprintBindingsCache: {},
		blueprintDirtyState: {},
		databasesSchemas: [],
		schemaTables: {},
		tableFields: {},
		isLoadingModalData: false,
		logLines: [],
		isDeploying: false,
		deploymentMilestones: [],
		deploymentAlertStatus: 'pending',
		isMinimized: false,
		deploymentProgress: 0,
		currentBlueprintSaveHandler: null,
	}),
}))


