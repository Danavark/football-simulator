// POST /api/match/:id/pause — flip the user-pause flag. The pause
// predicate sees it on the next beat, yields with reason='user_request',
// and clears the flag.

import { NextResponse } from 'next/server'
import { requestPause } from '@/lib/engine-runner'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const result = requestPause(ctx.params.id)
  if (!result.ok) {
    return NextResponse.json(result, { status: result.reason === 'unknown session' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true })
}
