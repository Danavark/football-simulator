// POST /api/match/:id/decisions — body is a MatchDecisions payload.
// Forwards to the held generator via submitDecisions. Validation lives in
// the engine; if decisions are bad, the engine throws and we surface it
// on the SSE 'error' frame (not the POST response).

import { NextResponse } from 'next/server'
import type { MatchDecisions } from 'backend/types'
import { submitDecisions } from '@/lib/engine-runner'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  let body: MatchDecisions = {}
  try {
    body = (await req.json()) as MatchDecisions
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid JSON' }, { status: 400 })
  }
  const result = submitDecisions(ctx.params.id, body)
  if (!result.ok) {
    return NextResponse.json(result, { status: result.reason === 'unknown session' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true })
}
