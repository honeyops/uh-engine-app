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
	try {
		const body = await request.json()
		const apiBase = getApiBase()
		const res = await fetch(`${apiBase}/dimensional-models/modal-loader`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
			cache: 'no-store'
		})

		if (!res.ok) {
			// Try to get error details from response
			let errorDetail = 'Failed to load modal data'
			try {
				const errorData = await res.json()
				errorDetail = errorData.detail || errorData.error || errorDetail
			} catch {
				// If response isn't JSON, use status text
				errorDetail = res.statusText || errorDetail
			}
			return NextResponse.json(
				{ error: errorDetail },
				{ status: res.status }
			)
		}

		const data = await res.json()
		return NextResponse.json(data)
	} catch (error) {
		// Log the actual error for debugging
		console.error('Modal loader route error:', error)
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Failed to load modal data' },
			{ status: 500 }
		)
	}
}
