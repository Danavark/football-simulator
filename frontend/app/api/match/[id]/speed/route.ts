// POST /api/match/:id/speed — change wall-clock pacing tier.
// Body: { speed: 'slow' | 'default' | 'fast' }
// Response: { ok: true, speedMs: number } on success.

import { NextResponse } from 'next/server'
import { setSpeed, type SpeedKey } from '@/lib/engine-runner'

export const dynamic = 'force-dynamic'

const VALID_SPEEDS: SpeedKey[] = ['slow', 'default', 'fast']

export async function POST(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  let body: { speed?: SpeedKey } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid JSON' }, { status: 400 })
  }
  const speed = body.speed
  if (!speed || !VALID_SPEEDS.includes(speed)) {
    return NextResponse.json({ ok: false, reason: 'speed must be slow|default|fast' }, { status: 400 })
  }
  const result = setSpeed(ctx.params.id, speed)
  if (!result.ok) {
    return NextResponse.json(result, { status: result.reason === 'unknown session' ? 404 : 409 })
  }
  return NextResponse.json(result)
}
