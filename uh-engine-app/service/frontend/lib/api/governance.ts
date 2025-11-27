import { API_BASE } from './client';

export type ContactPurpose = 'STEWARD' | 'SUPPORT' | 'ACCESS_APPROVAL';
export type GovernanceObjectType = 'TABLE' | 'VIEW' | 'MATERIALIZED VIEW' | 'DYNAMIC TABLE';

export interface GovernanceObject {
	database_name: string;
	schema_name: string;
	schema_description?: string | null;
	object_name: string;
	object_type: GovernanceObjectType | string;
	steward_contact?: string | null;
	support_contact?: string | null;
	approver_contact?: string | null;
}

export interface GovernanceObjectsResponse {
	message: string;
	objects: GovernanceObject[];
	total: number;
	page: number;
	page_size: number;
}

export interface ContactRecord {
	name: string;
	communication_type?: string | null;
	communication_value?: string | null;
	created_on?: string | null;
	updated_on?: string | null;
	raw_options?: string | null;
}

export interface ContactsResponse {
	message: string;
	contacts: ContactRecord[];
}

export type ContactMethod = 'URL' | 'EMAIL' | 'USERS';

export interface ContactCreateRequest {
	name: string;
	method: ContactMethod;
	value: string | string[];
}

export interface ContactAssignment {
	purpose: ContactPurpose;
	contact_name?: string | null;
}

export interface ContactAssignmentRequest {
	database_name: string;
	schema_name: string;
	object_name: string;
	object_type: GovernanceObjectType;
	assignments: ContactAssignment[];
}

const handleResponse = async <T>(response: Response): Promise<T> => {
	if (!response.ok) {
		let detail = response.statusText;
		try {
			const errorBody = await response.json();
			detail = errorBody?.detail || errorBody?.message || detail;
		} catch {
			// ignore
		}
		throw new Error(detail);
	}
	return response.json() as Promise<T>;
};

export const getGovernanceObjects = async (
	page: number = 1,
	pageSize: number = 50
): Promise<GovernanceObjectsResponse> => {
	const params = new URLSearchParams({
		page: page.toString(),
		page_size: pageSize.toString(),
	});
	const response = await fetch(`${API_BASE}/governance/objects?${params}`);
	return handleResponse<GovernanceObjectsResponse>(response);
};

export const getContacts = async (): Promise<ContactsResponse> => {
	const response = await fetch(`${API_BASE}/governance/contacts`);
	return handleResponse<ContactsResponse>(response);
};

export const createContact = async (payload: ContactCreateRequest): Promise<{ message: string }> => {
	const response = await fetch(`${API_BASE}/governance/contacts`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});
	return handleResponse<{ message: string }>(response);
};

export const assignContacts = async (
	payload: ContactAssignmentRequest
): Promise<{ message: string }> => {
	const response = await fetch(`${API_BASE}/governance/contacts/assign`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});
	return handleResponse<{ message: string }>(response);
};


// Model-Level Governance

export type ModelType = 'dimension' | 'fact';

export interface ComponentObject {
	database_name: string;
	schema_name: string;
	object_name: string;
	object_type: string;
	steward_contact?: string | null;
	support_contact?: string | null;
	approver_contact?: string | null;
}

export interface ModelGovernanceObject {
	model_id: string;
	model_name: string;
	model_type: ModelType;
	domain: string;
	process?: string | null;
	deployed: boolean;
	model_database?: string | null;
	model_schema?: string | null;
	component_objects: ComponentObject[];
	steward_contact?: string | null;
	support_contact?: string | null;
	approver_contact?: string | null;
}

export interface ModelGovernanceResponse {
	message: string;
	models: ModelGovernanceObject[];
	total: number;
}

export interface ModelContactAssignmentRequest {
	model_id: string;
	model_type: ModelType;
	assignments: ContactAssignment[];
}

export const getModelGovernance = async (): Promise<ModelGovernanceResponse> => {
	const response = await fetch(`${API_BASE}/governance/models`);
	return handleResponse<ModelGovernanceResponse>(response);
};

export const assignModelContacts = async (
	payload: ModelContactAssignmentRequest
): Promise<{ message: string; component_count?: number }> => {
	const response = await fetch(`${API_BASE}/governance/models/assign`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});
	return handleResponse<{ message: string; component_count?: number }>(response);
};
