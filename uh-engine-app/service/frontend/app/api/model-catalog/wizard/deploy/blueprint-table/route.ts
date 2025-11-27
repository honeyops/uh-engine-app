import { NextResponse } from 'next/server'

export async function POST(request: Request) {
	const body = await request.json().catch(() => ({}))
	const name = String(body?.name || '')
	return NextResponse.json({ ok: true, name })
}


