import { API_BASE } from './client';

export interface SnowflakeAccountUrlResponse {
	account_url: string;
}

/**
 * Get the Snowflake account URL for the connected customer account
 */
export const getSnowflakeAccountUrl = async (): Promise<SnowflakeAccountUrlResponse> => {
	const url = `${API_BASE}/snowflake/account-url`;
	const response = await fetch(url);
	if (!response.ok) {
		const error = await response.json().catch(() => ({ detail: response.statusText }));
		throw new Error(error.detail || `Failed to get Snowflake account URL: ${response.statusText}`);
	}
	return response.json();
};

