// TODO(wave-oauth): requires OAuth credential storage design
import { randomUUID } from 'node:crypto'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, _ctx: Ctx): Promise<Response> {
  return new Response(
    JSON.stringify({
      data: null,
      error: {
        code: 'not_implemented',
        message: 'GSC OAuth not yet implemented (wave-oauth)',
        requestId: randomUUID(),
      },
    }),
    { status: 501, headers: { 'Content-Type': 'application/json' } },
  )
}
