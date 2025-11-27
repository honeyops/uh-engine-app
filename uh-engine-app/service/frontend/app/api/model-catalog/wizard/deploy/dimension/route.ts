import { NextResponse } from 'next/server'

export async function POST(request: Request) {
	const body = await request.json().catch(() => ({}))
	const id = String(body?.id || '')
	return NextResponse.json({ ok: true, id, type: 'dimension' })
}


