// POST /api/match — create a new match session, return its id. Body
// optionally carries { seed?: number, userSide?: 'home'|'away' }.

import { NextResponse } from 'next/server'
import { createSession, type SpeedKey } from '@/lib/engine-runner'

export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  let body: { seed?: number; userSide?: 'home' | 'away'; autoPause?: boolean; speed?: SpeedKey } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    // empty body is fine
  }
  const id = createSession({
    seed: body.seed,
    userSide: body.userSide,
    autoPause: body.autoPause,
    speed: body.speed
  })
  return NextResponse.json({ id })
}
