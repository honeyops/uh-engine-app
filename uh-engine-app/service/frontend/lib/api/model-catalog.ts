import axios from 'axios';

// Backend base URL normalization:
// In production (SPCS), use relative URLs to go through FastAPI proxy
// In development, use the env var or default to localhost:8000
const RAW_BACKEND_BASE = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
	? '' // Use relative URLs in production (goes through FastAPI proxy)
	: (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000');
const CLEAN_BACKEND_BASE = RAW_BACKEND_BASE.replace(/\/+$/, '');
const API_BASE = CLEAN_BACKEND_BASE.endsWith('/api/v1')
	? CLEAN_BACKEND_BASE
	: `${CLEAN_BACKEND_BASE}/api/v1`;

export interface Group {
	id: string;
	name: string;
	domain?: string;
	process?: string;
	description?: string;
}

export interface Dimension {
	id: string;
	name: string;
	belongs_to: string;
	description?: string;
	deployed?: boolean;
  pii?: boolean | null;
  roles?: string[] | string | null;
}

export interface Fact {
	id: string;
	name: string;
	belongs_to: string;
	description?: string;
	deployed?: boolean;
  pii?: boolean | null;
  roles?: string[] | string | null;
}

export interface GroupsResponse {
	groups: Group[];
}

export interface DimensionsResponse {
	dimensions: Dimension[];
}

export interface FactsResponse {
	facts: Fact[];
}

export interface SourceMetadataItem {
	name: string;
	created_on?: string | null;
	comment?: string | null;
}

export interface SourceMetadataResponse<T = SourceMetadataItem> {
	message: string;
	data: T[];
}

export const getGroups = async (): Promise<GroupsResponse> => {
	const url = `${API_BASE}/dimensional-models/groups`;
	console.log('Fetching groups from:', url);
	const response = await axios.get<GroupsResponse>(url);
	return response.data;
};

export const getDimensions = async (groupId?: string): Promise<DimensionsResponse> => {
	const params = groupId ? { group_id: groupId } : {};
	const url = `${API_BASE}/dimensional-models/dimensions`;
	console.log('Fetching dimensions from:', url, params);
	const response = await axios.get<DimensionsResponse>(url, { params });
	return response.data;
};

export const getFacts = async (groupId?: string): Promise<FactsResponse> => {
	const params = groupId ? { group_id: groupId } : {};
	const url = `${API_BASE}/dimensional-models/facts`;
	console.log('Fetching facts from:', url, params);
	const response = await axios.get<FactsResponse>(url, { params });
	return response.data;
};

export interface BlueprintListResponse {
	message: string;
	sources: Record<string, string[]>;
}

export interface BlueprintDetail {
	id: string;
	name: string;
	source: string;
	binding_db?: string | null;
	binding_schema?: string | null;
	binding_table?: string | null;
	column_count: number;
	mapping_complete: boolean;
	deployed: boolean;
}

export interface BlueprintListDetailedResponse {
	message: string;
	blueprints: BlueprintDetail[];
}

export const getBlueprints = async (source?: string): Promise<BlueprintListResponse> => {
	const params = source ? { source } : {};
	const url = `${API_BASE}/blueprint/list`;
	console.log('Fetching blueprints from:', url, params);
	const response = await axios.get<BlueprintListResponse>(url, { params });
	return response.data;
};

export const getBlueprintsDetailed = async (source?: string): Promise<BlueprintListDetailedResponse> => {
	const params = source ? { source } : {};
	const url = `${API_BASE}/blueprint/list/detailed`;
	console.log('Fetching detailed blueprints from:', url, params);
	const response = await axios.get<BlueprintListDetailedResponse>(url, { params });
	return response.data;
};

export interface DatabaseSchemaConfig {
	name: string;
	description?: string;
	order?: number;
	type?: string;
	create?: boolean;
	deployed?: boolean;
	optional?: boolean;
}

export interface LegacyDatabaseConfigSection {
	name: string;
	layers: Array<{
		name: string;
		description: string;
		order: number;
		type: string;
	}>;
}

export interface NewDatabaseConfigSection {
	name: string;
	deployed?: boolean;
	schemas: DatabaseSchemaConfig[];
}

export interface DatabaseConfig {
	message: string;
	config: {
		databases?: NewDatabaseConfigSection;
		database?: LegacyDatabaseConfigSection;
	};
}

export const getDatabaseConfig = async (): Promise<DatabaseConfig> => {
	const url = `${API_BASE}/database/config`;
	const response = await axios.get<DatabaseConfig>(url);
	return response.data;
};

export const updateDatabaseConfig = async (config: DatabaseConfig['config']): Promise<DatabaseConfig> => {
	const url = `${API_BASE}/database/config`;
	const response = await axios.put<DatabaseConfig>(url, config);
	return response.data;
};

export interface DatabaseDeployRequest {
	database_name?: string;
	drop_existing?: boolean;
}

export interface DatabaseDeployResponse {
	message: string;
	sql_executed?: boolean;
}

export const deployDatabase = async (payload: DatabaseDeployRequest = {}): Promise<DatabaseDeployResponse> => {
	const url = `${API_BASE}/database/deploy`;
	const response = await axios.post<DatabaseDeployResponse>(url, payload);
	return response.data;
};

// ----- Wizard helpers (Next API proxy endpoints) -----

// Modal loader - get all data for modal in one call
// Call FastAPI directly instead of going through Next.js API route to avoid circular dependency
export const getModalLoaderData = async (modelIds: string[]) => {
	const url = `${API_BASE}/dimensional-models/modal-loader`;
	const response = await axios.post(url, { model_ids: modelIds });
	return response.data as any;
};

// Blueprints for selected models
export const getBlueprintsForModels = async (modelIds: string[]) => {
	const url = `/api/model-catalog/wizard/blueprints`;
	const response = await axios.post(url, { model_ids: modelIds });
	return response.data as any;
};

// Fetch bindings for a blueprint identified by blueprint_id (unique across all sources)
// Call FastAPI directly instead of going through Next.js API route to avoid circular dependency
export const getBlueprintBindings = async (source: string, name: string) => {
	// Blueprint IDs are unique across sources, so we just use the name
	const blueprintId = name;
	const url = `${API_BASE}/blueprint/bindings/${blueprintId}`;
	const response = await axios.get(url);
	return response.data as any;
};

// Update bindings for a blueprint
// Call FastAPI directly instead of going through Next.js API route to avoid circular dependency
export const updateBlueprintBindings = async (
	source: string,
	name: string,
	payload: unknown,
) => {
	// Blueprint IDs are unique across sources, so we just use the name
	const blueprintId = name;
	const url = `${API_BASE}/blueprint/bindings`;
	const response = await axios.put(url, { blueprint_id: blueprintId, bindings: payload });
	return response.data as any;
};

// Source discovery (databases/schemas/tables/columns)
// Call FastAPI directly instead of going through Next.js API routes to avoid circular dependency
export const listDatabases = async (): Promise<string[]> => {
	const url = `${API_BASE}/sources/metadata/databases`;
	const response = await axios.get(url);
	const payload = response.data;

	const rawList = Array.isArray(payload)
		? payload
		: Array.isArray(payload?.data)
			? payload.data
			: Array.isArray(payload?.databases)
				? payload.databases
				: [];

	return rawList
		.map((item: any) => {
			if (typeof item === 'string') return item;
			if (item && typeof item.name === 'string') return item.name;
			return null;
		})
		.filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
		.map((name: string) => name.toUpperCase());
};

// Get databases that the app role can access (has SELECT permission)
// Uses the same endpoint as listDatabases - returns list of database names
export const getAccessibleDatabases = async (): Promise<{ databases: string[] }> => {
	const url = `${API_BASE}/sources/metadata/databases`;
	const response = await axios.get(url);
	const payload = response.data;

	const rawList = Array.isArray(payload)
		? payload
		: Array.isArray(payload?.data)
			? payload.data
			: Array.isArray(payload?.databases)
				? payload.databases
				: [];

	const databases = rawList
		.map((item: any) => {
			if (typeof item === 'string') return item;
			if (item && typeof item.name === 'string') return item.name;
			return null;
		})
		.filter((name: unknown): name is string => typeof name === 'string' && name.length > 0);

	return { databases: databases.map((name: string) => name.toUpperCase()) };
};

export const listSchemas = async (database: string): Promise<SourceMetadataResponse> => {
	const url = `${API_BASE}/sources/metadata/schemas`;
	const response = await axios.get(url, { params: { db: database } });
	const payload = response.data;

	const rawList = Array.isArray(payload)
		? payload
		: Array.isArray(payload?.data)
			? payload.data
			: Array.isArray(payload?.schemas)
				? payload.schemas
				: [];

	const items = rawList
		.map((item: any) => {
			if (typeof item === 'string') {
				return {
					name: item.toUpperCase(),
					created_on: null,
					comment: null,
				} as SourceMetadataItem;
			}
			if (item && typeof item.name === 'string') {
				return {
					...item,
					name: item.name.toUpperCase(),
				} as SourceMetadataItem;
			}
			return null;
		})
		.filter((x: unknown): x is SourceMetadataItem => Boolean(x));

	return {
		message: `Schemas in ${database}`,
		data: items,
	};
};

export const listTables = async (database: string, schema: string): Promise<SourceMetadataResponse> => {
	const url = `${API_BASE}/sources/metadata/tables`;
	const response = await axios.get(url, { params: { db: database, schema } });
	const payload = response.data;

	const rawList = Array.isArray(payload)
		? payload
		: Array.isArray(payload?.data)
			? payload.data
			: Array.isArray(payload?.tables)
				? payload.tables
				: [];

	const items = rawList
		.map((item: any) => {
			if (typeof item === 'string') {
				return {
					name: item.toUpperCase(),
					created_on: null,
					comment: null,
				} as SourceMetadataItem;
			}

			if (item) {
				const rawName = item.name ?? item.TABLE_NAME;
				if (typeof rawName === 'string' && rawName.trim().length > 0) {
					return {
						...item,
						name: rawName.toUpperCase(),
					} as SourceMetadataItem;
				}
			}

			return null;
		})
		.filter((x: unknown): x is SourceMetadataItem => Boolean(x));

	return {
		message: `Tables in ${database}.${schema}`,
		data: items,
	};
};


// Warmup endpoint - pre-establish connection pool for instant subsequent requests
export const warmupConnectionPool = async (): Promise<{ status: string; message: string; elapsed_ms: number }> => {
	const url = `${API_BASE}/sources/warmup`;
	const response = await axios.get(url);
	return response.data;
};

export const listColumns = async (database: string, schema: string, table: string): Promise<SourceMetadataResponse> => {
	const url = `${API_BASE}/sources/metadata/columns`;
	const response = await axios.get<SourceMetadataResponse>(url, { params: { db: database, schema, table } });
	return response.data;
};


// Tables cache (per schema)
const __tablesCache = new Map<string, string[]>();
const __tablesInflight = new Map<string, Promise<string[]>>();

export const listTablesCached = async (database: string, schema: string): Promise<string[]> => {
	const cacheKey = `${database.toUpperCase()}.${schema.toUpperCase()}`;

	// Return from cache if available
	if (__tablesCache.has(cacheKey)) {
		return __tablesCache.get(cacheKey)!;
	}

	// Return in-flight promise if already fetching
	if (__tablesInflight.has(cacheKey)) {
		return __tablesInflight.get(cacheKey)!;
	}

	// Fetch and cache
	const promise = listTables(database, schema)
		.then((res) => {
			const rawData = Array.isArray(res?.data) ? res.data : [];
			const tables = rawData
				.map((t: any) => String(t.name || t.TABLE_NAME || '').toUpperCase())
				.filter((val: string) => val.length > 0);
			__tablesCache.set(cacheKey, tables);
			return tables;
		})
		.finally(() => {
			__tablesInflight.delete(cacheKey);
		});

	__tablesInflight.set(cacheKey, promise);
	return promise;
};

// Columns cache (per table)
const __columnsCache = new Map<string, any[]>();
const __columnsInflight = new Map<string, Promise<any[]>>();

export const listColumnsCached = async (database: string, schema: string, table: string): Promise<any[]> => {
	const cacheKey = `${database.toUpperCase()}.${schema.toUpperCase()}.${table.toUpperCase()}`;

	// Return from cache if available
	if (__columnsCache.has(cacheKey)) {
		return __columnsCache.get(cacheKey)!;
	}

	// Return in-flight promise if already fetching
	if (__columnsInflight.has(cacheKey)) {
		return __columnsInflight.get(cacheKey)!;
	}

	// Fetch and cache
	const promise = listColumns(database, schema, table)
		.then((res) => {
			const columns = Array.isArray(res?.data) ? res.data : [];
			__columnsCache.set(cacheKey, columns);
			return columns;
		})
		.finally(() => {
			__columnsInflight.delete(cacheKey);
		});

	__columnsInflight.set(cacheKey, promise);
	return promise;
};

export const resetTablesCacheForSchema = (database: string, schema: string) => {
	const cacheKey = `${database.toUpperCase()}.${schema.toUpperCase()}`;
	__tablesCache.delete(cacheKey);
	__tablesInflight.delete(cacheKey);
};

export const resetAllCaches = () => {
	__tablesCache.clear();
	__tablesInflight.clear();
	__columnsCache.clear();
	__columnsInflight.clear();
};

// Deployment endpoints
export const deployBlueprintTable = async (name: string, options: { replace_objects?: boolean } = {}) => {
	const url = `/api/model-catalog/wizard/deploy/blueprint-table`;
	const response = await axios.post(url, { name, ...options });
	return response.data as any;
};

export const deployDimension = async (id: string, options: { replace_objects?: boolean } = {}) => {
	const url = `/api/model-catalog/wizard/deploy/dimension`;
	const response = await axios.post(url, { id, ...options });
	return response.data as any;
};

export const deployFact = async (id: string, options: { replace_objects?: boolean } = {}) => {
	const url = `/api/model-catalog/wizard/deploy/fact`;
	const response = await axios.post(url, { id, ...options });
	return response.data as any;
};

// SSE-based blueprint deployment with streaming logs
export const deployBlueprintsWithStreaming = (
	sources: Record<string, string[]>,
	options: {
		replace_objects?: boolean;
		run_full_refresh?: boolean;
		database_name?: string;
	},
	onLog: (log: {
		level: string;
		step: string;
		object_name: string;
		status: string;
		timestamp: string;
		message: string;
	}) => void,
	onBlueprintComplete: (data: {
		blueprint_name: string;
		source: string;
		status: string;
	}) => void,
	onComplete: (data: {
		total: number;
		successful: any[];
		failed: any[];
	}) => void,
	onError: (error: any) => void
) => {
	const url = `${API_BASE}/blueprint/deploy/follow`;

	// Create EventSource connection
	const eventSource = new EventSource(url, {
		withCredentials: false,
	});

	// Send the deployment request as POST data (need to use fetch instead)
	// EventSource doesn't support POST, so we'll use fetch with SSE
	fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'text/event-stream',
		},
		body: JSON.stringify({
			sources,
			replace_objects: options.replace_objects ?? false,
			run_full_refresh: options.run_full_refresh ?? false,
			database_name: options.database_name,
		}),
	})
		.then(async (response) => {
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const reader = response.body?.getReader();
			const decoder = new TextDecoder();

			if (!reader) {
				throw new Error('No response body');
			}

			let buffer = '';
			let currentEventType = 'log'; // Default event type
			let completeReceived = false;

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					// Process any remaining buffer
					if (buffer.trim()) {
						const lines = buffer.split('\n');
						for (const line of lines) {
							if (line.startsWith('event: ')) {
								currentEventType = line.substring(7).trim();
								continue;
							}
							if (line.startsWith('data: ')) {
								const data = line.substring(6).trim();
								if (data) {
									try {
										const parsed = JSON.parse(data);
										// Route based on last known event type
										if (currentEventType === 'log') {
											onLog(parsed);
										} else if (currentEventType === 'blueprint_complete') {
											onBlueprintComplete(parsed);
										} else if (currentEventType === 'complete') {
											completeReceived = true;
											onComplete(parsed);
										} else if (currentEventType === 'error') {
											onError(parsed);
										}
									} catch (e) {
										console.error('Failed to parse SSE data:', e);
									}
								}
							}
						}
					}
					
					// If stream ended without complete event, call onComplete with empty data
					// This ensures the Promise resolves
					if (!completeReceived) {
						console.warn('Stream ended without complete event, calling onComplete with empty data');
						onComplete({
							total: 0,
							successful: [],
							failed: []
						});
					}
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				
				// Keep the last incomplete line in buffer
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('event: ')) {
						currentEventType = line.substring(7).trim();
						continue;
					}

					if (line.startsWith('data: ')) {
						const data = line.substring(6).trim();
						if (!data) continue;

						try {
							const parsed = JSON.parse(data);

							// Route events based on the event type header
							if (currentEventType === 'log') {
								onLog(parsed);
							} else if (currentEventType === 'blueprint_complete') {
								onBlueprintComplete(parsed);
							} else if (currentEventType === 'complete') {
								completeReceived = true;
								onComplete(parsed);
							} else if (currentEventType === 'error') {
								onError(parsed);
							} else if (currentEventType === 'close') {
								// Stream is closing
								if (parsed.message) {
									console.log('Stream closed:', parsed.message);
								}
								// If we haven't received a complete event yet, call it now
								if (!completeReceived) {
									console.warn('Stream closed without complete event, calling onComplete');
									completeReceived = true;
									onComplete({
										total: 0,
										successful: [],
										failed: []
									});
								}
							}
						} catch (e) {
							console.error('Failed to parse SSE data:', e);
						}
					}
				}
			}
		})
		.catch((error) => {
			console.error('SSE connection error:', error);
			onError(error);
		});

	// Return a cleanup function
	return () => {
		// No cleanup needed for fetch-based SSE
	};
};

// SSE-based dimensional model deployment with streaming logs
export const deployDimensionalModelsWithStreaming = (
	dimensions: string[],
	facts: string[],
	options: {
		replace_objects?: boolean;
		model_database?: string;
		model_schema?: string;
	},
	onLog: (log: {
		level: string;
		step: string;
		object_name: string;
		status: string;
		timestamp: string;
		message: string;
	}) => void,
	onDimensionComplete: (data: {
		dimension_id: string;
		status: string;
		error?: string;
	}) => void,
	onFactComplete: (data: {
		fact_id: string;
		status: string;
		error?: string;
	}) => void,
	onComplete: (data: {
		total: number;
		successful: any[];
		failed: any[];
	}) => void,
	onError: (error: any) => void
) => {
	const url = `${API_BASE}/dimensional-models/deploy/follow`;

	fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'text/event-stream',
		},
		body: JSON.stringify({
			dimensions,
			facts,
			replace_objects: options.replace_objects ?? true,
			model_database: options.model_database,
			model_schema: options.model_schema,
		}),
	})
		.then(async (response) => {
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const reader = response.body?.getReader();
			const decoder = new TextDecoder();

			if (!reader) {
				throw new Error('No response body');
			}

			let buffer = '';
			let currentEventType = 'log'; // Default event type
			let completeReceived = false;

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					// Process any remaining buffer
					if (buffer.trim()) {
						const lines = buffer.split('\n');
						for (const line of lines) {
							if (line.startsWith('event: ')) {
								currentEventType = line.substring(7).trim();
								continue;
							}
							if (line.startsWith('data: ')) {
								const data = line.substring(6).trim();
								if (data) {
									try {
										const parsed = JSON.parse(data);
										// Route based on last known event type
										if (currentEventType === 'log') {
											onLog(parsed);
										} else if (currentEventType === 'dimension_complete') {
											onDimensionComplete(parsed);
										} else if (currentEventType === 'fact_complete') {
											onFactComplete(parsed);
										} else if (currentEventType === 'complete') {
											completeReceived = true;
											onComplete(parsed);
										} else if (currentEventType === 'error') {
											onError(parsed);
										}
									} catch (e) {
										console.error('Failed to parse SSE data:', e);
									}
								}
							}
						}
					}

					// If stream ended without complete event, call onComplete with empty data
					if (!completeReceived) {
						console.warn('Dimensional model stream ended without complete event');
						onComplete({
							total: 0,
							successful: [],
							failed: []
						});
					}
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');

				// Keep the last incomplete line in buffer
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('event: ')) {
						currentEventType = line.substring(7).trim();
						continue;
					}

					if (line.startsWith('data: ')) {
						const data = line.substring(6).trim();
						if (!data) continue;

						try {
							const parsed = JSON.parse(data);

							// Route events based on the event type header
							if (currentEventType === 'log') {
								onLog(parsed);
							} else if (currentEventType === 'dimension_start') {
								// Optional: handle dimension start event
								console.log('Dimension deployment started:', parsed);
							} else if (currentEventType === 'dimension_complete') {
								onDimensionComplete(parsed);
							} else if (currentEventType === 'fact_start') {
								// Optional: handle fact start event
								console.log('Fact deployment started:', parsed);
							} else if (currentEventType === 'fact_complete') {
								onFactComplete(parsed);
							} else if (currentEventType === 'complete') {
								completeReceived = true;
								onComplete(parsed);
							} else if (currentEventType === 'error') {
								onError(parsed);
							} else if (currentEventType === 'close') {
								// Stream is closing
								if (parsed.message) {
									console.log('Stream closed:', parsed.message);
								}
								if (!completeReceived) {
									completeReceived = true;
									onComplete({
										total: 0,
										successful: [],
										failed: []
									});
								}
							}
						} catch (e) {
							console.error('Failed to parse SSE data:', e);
						}
					}
				}
			}
		})
		.catch((error) => {
			console.error('Dimensional model SSE connection error:', error);
			onError(error);
		});

	// Return a cleanup function
	return () => {
		// No cleanup needed for fetch-based SSE
	};
};

// Deployment summary endpoint
export interface DeploymentSummaryRequest {
	model_ids: string[];
}

export interface DeploymentSummaryResponse {
	message: string;
	models: Array<{
		model_id: string;
		model_name: string;
		model_type: string;
		staging: {
			items: Array<{ name: string; blueprint_id: string; source: string }>;
			count: number;
		};
		data_processing: {
			streams: Array<{ name: string; blueprint_id: string; source: string }>;
			tasks: Array<{ name: string; blueprint_id: string; source: string }>;
			count: number;
		};
		key_storage: {
			items: Array<{ name: string; blueprint_id: string; source: string; type: string }>;
			count: number;
		};
		build_relationships: {
			items: Array<{ name: string; blueprint_id: string; source: string }>;
			count: number;
		};
		data_storage: {
			items: Array<{ name: string; blueprint_id: string; source: string; node: string }>;
			count: number;
		};
		supporting_artefacts: {
			items: Array<any>;
			count: number;
		};
		model_deployment: {
			name: string;
			model_id: string;
			model_type: string;
		};
		seed_load: {
			available: boolean;
			description: string;
			blueprints: Array<{ blueprint_id: string; source: string; binding_object: string }>;
		};
	}>;
}

export const getDeploymentSummary = async (modelIds: string[]): Promise<DeploymentSummaryResponse> => {
	const url = `${API_BASE}/dimensional-models/deployment-summary`;
	const response = await axios.post<DeploymentSummaryResponse>(url, { model_ids: modelIds });
	return response.data;
};

// Staged deployment with SSE
export const deployModelsStaged = (
	modelIds: string[],
	options: {
		replace_objects?: boolean;
		run_full_refresh?: boolean;
		model_database?: string;
		model_schema?: string;
	},
	onLog: (log: {
		level: string;
		step: string;
		model_id?: string;
		blueprint_id?: string;
		object_name?: string;
		status: string;
		timestamp: string;
		message: string;
	}) => void,
	onModelStart: (data: { model_id: string; model_type: string; index: number; total: number }) => void,
	onModelComplete: (data: { model_id: string; status: string; error?: string }) => void,
	onComplete: (data: { total: number; successful: any[]; failed: any[] }) => void,
	onError: (error: any) => void
) => {
	const url = `${API_BASE}/dimensional-models/deploy-staged`;

	fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'text/event-stream',
		},
		body: JSON.stringify({
			model_ids: modelIds,
			replace_objects: options.replace_objects ?? true,
			run_full_refresh: options.run_full_refresh ?? false,
			model_database: options.model_database,
			model_schema: options.model_schema,
		}),
	})
		.then(async (response) => {
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const reader = response.body?.getReader();
			const decoder = new TextDecoder();

			if (!reader) {
				throw new Error('No response body');
			}

			let buffer = '';
			let currentEventType = 'log';
			let completeReceived = false;

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					if (buffer.trim()) {
						const lines = buffer.split('\n');
						for (const line of lines) {
							if (line.startsWith('event: ')) {
								currentEventType = line.substring(7).trim();
								continue;
							}
							if (line.startsWith('data: ')) {
								const data = line.substring(6).trim();
								if (data) {
									try {
										const parsed = JSON.parse(data);
										if (currentEventType === 'log') {
											onLog(parsed);
										} else if (currentEventType === 'model_start') {
											onModelStart(parsed);
										} else if (currentEventType === 'model_complete') {
											onModelComplete(parsed);
										} else if (currentEventType === 'complete') {
											completeReceived = true;
											onComplete(parsed);
										} else if (currentEventType === 'error') {
											onError(parsed);
										}
									} catch (e) {
										console.error('Failed to parse SSE data:', e);
									}
								}
							}
						}
					}
					if (!completeReceived) {
						onComplete({ total: 0, successful: [], failed: [] });
					}
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('event: ')) {
						currentEventType = line.substring(7).trim();
						continue;
					}

					if (line.startsWith('data: ')) {
						const data = line.substring(6).trim();
						if (!data) continue;

						try {
							const parsed = JSON.parse(data);

							if (currentEventType === 'log') {
								onLog(parsed);
							} else if (currentEventType === 'model_start') {
								onModelStart(parsed);
							} else if (currentEventType === 'model_complete') {
								onModelComplete(parsed);
							} else if (currentEventType === 'complete') {
								completeReceived = true;
								onComplete(parsed);
							} else if (currentEventType === 'error') {
								onError(parsed);
							} else if (currentEventType === 'close') {
								if (!completeReceived) {
									completeReceived = true;
									onComplete({ total: 0, successful: [], failed: [] });
								}
							}
						} catch (e) {
							console.error('Failed to parse SSE data:', e);
						}
					}
				}
			}
		})
		.catch((error) => {
			console.error('SSE connection error:', error);
			onError(error);
		});

	return () => {
		// No cleanup needed for fetch-based SSE
	};
};