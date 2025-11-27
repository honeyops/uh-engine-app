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

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url)
	const database = searchParams.get('database') || searchParams.get('db') || ''
	const schema = searchParams.get('schema') || ''
	const table = searchParams.get('table') || ''
	try {
		const params = new URLSearchParams({ db: database, schema, table })
		const res = await fetch(`${getApiBase()}/sources/metadata/columns?` + params, { cache: 'no-store' })
		if (!res.ok) return NextResponse.json({ database, schema, table, columns: [] })
		const data = await res.json()
		return NextResponse.json(data)
	} catch {
		return NextResponse.json({ database, schema, table, columns: [] })
	}
}


