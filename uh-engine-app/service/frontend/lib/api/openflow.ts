import { API_BASE } from './client';

export interface SnapshotState {
	database_name: string;
	schema_name: string;
	table_name: string;
	enabled: boolean | null;
	snapshot_request: boolean | null;
	table_ddl_initialize: boolean | null;
	watermark_column_pattern: string | null;
	watermark_column: string | null;
	primary_key_columns: string | null;
	chunking_strategy: string | null;
	last_snapshot_watermark: string | null;
	last_snapshot_timestamp: string | null;
	snapshot_status: string | null;
	created_at: string | null;
	updated_at: string | null;
}

export interface SnapshotStateListResponse {
	message: string;
	snapshot_states: SnapshotState[];
}

export interface SnapshotStateCreateRequest {
	database_name: string;
	schema_name: string;
	table_name: string;
	enabled?: boolean | null;
	snapshot_request?: boolean | null;
	table_ddl_initialize?: boolean | null;
	watermark_column_pattern?: string | null;
	watermark_column?: string | null;
	primary_key_columns?: string | null;
	chunking_strategy?: string | null;
}

export interface SnapshotStateUpdateRequest {
	enabled?: boolean | null;
	snapshot_request?: boolean | null;
	table_ddl_initialize?: boolean | null;
	watermark_column_pattern?: string | null;
	watermark_column?: string | null;
	primary_key_columns?: string | null;
	chunking_strategy?: string | null;
}

export interface SnapshotStateCRUDResponse {
	message: string;
	database_name?: string | null;
	schema_name?: string | null;
	table_name?: string | null;
}

/**
 * Get all snapshot states
 */
export const getSnapshotStates = async (): Promise<SnapshotStateListResponse> => {
	const url = `${API_BASE}/openflow/snapshot-state`;
	const response = await fetch(url);
	if (!response.ok) {
		const error = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(error.detail || `Failed to fetch snapshot states: ${response.statusText}`);
	}
	return response.json();
};

/**
 * Get a single snapshot state by composite key
 */
export const getSnapshotState = async (
	databaseName: string,
	schemaName: string,
	tableName: string
): Promise<SnapshotState> => {
	const encodedDb = encodeURIComponent(databaseName);
	const encodedSchema = encodeURIComponent(schemaName);
	const encodedTable = encodeURIComponent(tableName);
	const url = `${API_BASE}/openflow/snapshot-state/${encodedDb}/${encodedSchema}/${encodedTable}`;
	const response = await fetch(url);
	if (!response.ok) {
		const error = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(error.detail || `Failed to fetch snapshot state: ${response.statusText}`);
	}
	return response.json();
};

/**
 * Create a new snapshot state
 */
export const createSnapshotState = async (
	data: SnapshotStateCreateRequest
): Promise<SnapshotStateCRUDResponse> => {
	const url = `${API_BASE}/openflow/snapshot-state`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(data),
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(error.detail || `Failed to create snapshot state: ${response.statusText}`);
	}
	return response.json();
};

/**
 * Update an existing snapshot state
 */
export const updateSnapshotState = async (
	databaseName: string,
	schemaName: string,
	tableName: string,
	data: SnapshotStateUpdateRequest
): Promise<SnapshotStateCRUDResponse> => {
	const encodedDb = encodeURIComponent(databaseName);
	const encodedSchema = encodeURIComponent(schemaName);
	const encodedTable = encodeURIComponent(tableName);
	const url = `${API_BASE}/openflow/snapshot-state/${encodedDb}/${encodedSchema}/${encodedTable}`;
	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(data),
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(error.detail || `Failed to update snapshot state: ${response.statusText}`);
	}
	return response.json();
};

/**
 * Delete a snapshot state
 */
export const deleteSnapshotState = async (
	databaseName: string,
	schemaName: string,
	tableName: string
): Promise<SnapshotStateCRUDResponse> => {
	const encodedDb = encodeURIComponent(databaseName);
	const encodedSchema = encodeURIComponent(schemaName);
	const encodedTable = encodeURIComponent(tableName);
	const url = `${API_BASE}/openflow/snapshot-state/${encodedDb}/${encodedSchema}/${encodedTable}`;
	const response = await fetch(url, {
		method: 'DELETE',
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(error.detail || `Failed to delete snapshot state: ${response.statusText}`);
	}
	return response.json();
};

