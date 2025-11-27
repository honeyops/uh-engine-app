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

export async function GET() {
	try {
		// Proxy to backend
		const backendUrl = `${getApiBase()}/dashboard/modelling/metrics`
		const res = await fetch(backendUrl, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json' },
			cache: 'no-store',
		})

		if (!res.ok) {
			const errorText = await res.text()
			return NextResponse.json(
				{ error: `Backend returned ${res.status}: ${errorText}` },
				{ status: res.status }
			)
		}

		const data = await res.json()
		return NextResponse.json(data)
	} catch (error) {
		console.error('Error proxying to dashboard metrics endpoint:', error)
		return NextResponse.json(
			{ error: 'Failed to fetch metrics from backend' },
			{ status: 500 }
		)
	}
}
