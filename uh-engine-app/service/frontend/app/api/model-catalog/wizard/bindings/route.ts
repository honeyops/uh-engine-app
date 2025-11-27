import { NextResponse } from 'next/server'
import axios from 'axios'

// Next.js API routes run server-side, so they should always call
// the FastAPI backend directly (same container)
// In production (SPCS), FastAPI runs on port 80
// In development, use the env var or default to localhost:8000
// Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues
const isProduction = process.env.NODE_ENV === 'production'
const defaultPort = isProduction ? '80' : '8000'
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || `http://127.0.0.1:${defaultPort}`
const CLEAN_BACKEND_BASE = API_BASE.replace(/\/+$/, '')
const BACKEND_API = CLEAN_BACKEND_BASE.endsWith('/api/v1')
	? CLEAN_BACKEND_BASE
	: `${CLEAN_BACKEND_BASE}/api/v1`

export async function GET(request: Request) {
	try {
		const { searchParams } = new URL(request.url)
		const source = searchParams.get('source') || ''
		const name = searchParams.get('name') || ''

		if (!source || !name) {
			return NextResponse.json(
				{ error: 'Source and name are required' },
				{ status: 400 }
			)
		}

		// Call backend API - blueprint IDs are unique across sources, so just use name
		const blueprintId = name;
		const response = await axios.get(`${BACKEND_API}/blueprint/bindings/${blueprintId}`)

		// Backend returns { bindings: blueprint_object, ... }
		// Frontend expects bindings to be accessible directly
		const bindings = response.data?.bindings || response.data
		
		return NextResponse.json({ 
			source, 
			name, 
			bindings 
		})
	} catch (error: any) {
		console.error('Error fetching blueprint bindings:', error)
		const status = error?.response?.status || 500
		const message = error?.response?.data?.detail || error.message || 'Failed to fetch bindings'
		return NextResponse.json(
			{ error: message },
			{ status }
		)
	}
}

export async function PUT(request: Request) {
	try {
		const body = await request.json().catch(() => ({}))
		const source = String(body?.source || '')
		const name = String(body?.name || '')
		const payload = body?.payload || {}

		if (!source || !name) {
			return NextResponse.json(
				{ error: 'Source and name are required' },
				{ status: 400 }
			)
		}

		// Call backend API to update bindings
		// Blueprint IDs are unique across sources, so just use name
		const blueprintId = name;
		const response = await axios.put(
			`${BACKEND_API}/blueprint/bindings`,
			{
				blueprint_id: blueprintId,
				bindings: payload,
			}
		)

		return NextResponse.json(response.data)
	} catch (error: any) {
		console.error('Error updating blueprint bindings:', error)
		const status = error?.response?.status || 500
		const message = error?.response?.data?.detail || error.message || 'Failed to update bindings'
		return NextResponse.json(
			{ error: message },
			{ status }
		)
	}
}


