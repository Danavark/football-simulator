// GET /api/match/:id/stream — Server-Sent Events. Attaches a stream
// controller to the session and runs runSessionLoop. Frames:
//   event: beat   { ev, score, minute, commentary }
//   event: pause  { reason, side, state }
//   event: error  { message }
//   event: end    { result }

import { getSession } from '@/lib/sessions'
import { replayHistory, runSessionLoop } from '@/lib/engine-runner'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const session = getSession(ctx.params.id)
  if (!session) {
    return new Response('unknown session', { status: 404 })
  }
  if (session.ended && !session.finalResult) {
    // Session ended in error and we have nothing to replay.
    return new Response('session ended', { status: 410 })
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // If a previous controller exists (stale tab / orphaned reference),
      // close it cleanly. The loop is single-process so it's awaiting
      // either sleep() or the decisions Promise — whichever resumes next
      // will write to the new controller.
      if (session.controller) {
        try {
          session.controller.close()
        } catch {
          // already closed
        }
      }
      session.controller = controller

      // Replay archived frames so the new client catches up to the
      // current minute. If the match is paused, also re-emit the pause
      // so the decision panel reopens. If ended, re-emit the result so
      // a late-attaching tab still sees full-time.
      replayHistory(session)

      // Kick off the loop only the first time — subsequent attaches
      // (refresh) just re-use the existing loop.
      if (!session.loopStarted) {
        session.loopStarted = true
        void runSessionLoop(session)
      } else if (session.ended) {
        // The loop already finished and the replay above sent the end
        // frame. Close so the EventSource sees a clean end.
        try {
          controller.close()
        } catch {
          // already closed
        }
        session.controller = null
      }
    },
    cancel() {
      // Browser closed the EventSource. Drop the controller so the loop
      // stops writing; loop itself keeps going so reconnects work.
      session.controller = null
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable response buffering for SSE in Next dev.
      'X-Accel-Buffering': 'no'
    }
  })
}
