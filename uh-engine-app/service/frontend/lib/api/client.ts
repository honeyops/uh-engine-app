// Shared API base resolver for frontend data fetching

const RAW_BACKEND_BASE =
	typeof window !== 'undefined' && window.location.hostname !== 'localhost'
		? ''
		: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

const CLEAN_BACKEND_BASE = RAW_BACKEND_BASE.replace(/\/+$/, '');

export const API_BASE = CLEAN_BACKEND_BASE.endsWith('/api/v1')
	? CLEAN_BACKEND_BASE
	: `${CLEAN_BACKEND_BASE}/api/v1`;


