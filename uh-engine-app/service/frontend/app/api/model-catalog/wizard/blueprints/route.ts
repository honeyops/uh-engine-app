import { NextResponse } from 'next/server'

function getApiBase() {
	// Next.js API routes run server-side, so they should always call
	// the FastAPI backend directly (same container)
	// In production (SPCS), FastAPI runs on port 80
	// In development, use the env var or default to localhost:8000
	// Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues
	const isProduction = process.env.NODE_ENV === 'production'
	const defaultPort = isProduction ? '80' : '8000'
	const raw = process.env.NEXT_PUBLIC_API_BASE_URL || `http://127.0.0.1:${defaultPort}`
	const clean = raw.replace(/\/+$/, '')
	return clean.endsWith('/api/v1') ? clean : `${clean}/api/v1`
}

export async function POST(request: Request) {
	const body = await request.json().catch(() => ({}))
	const modelIds: string[] = Array.isArray(body?.model_ids) ? body.model_ids : []

	try {
		// Proxy to backend if available
		const backendUrl = `${getApiBase()}/dimensional-models/blueprints`
		const res = await fetch(backendUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model_ids: modelIds }),
			cache: 'no-store',
		})
		if (!res.ok) {
			return NextResponse.json({ blueprints: {}, blueprint_keys: [], model_ids: modelIds }, { status: 200 })
		}
		const data = await res.json()
		return NextResponse.json(data)
	} catch {
		// Fallback to empty structure
		return NextResponse.json({ blueprints: {}, blueprint_keys: [], model_ids: modelIds }, { status: 200 })
	}
}


