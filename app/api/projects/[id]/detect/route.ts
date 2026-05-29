import { withHandler } from '../../../../../server/http'
import { runDetection } from '../../../../../server/engine/detect'

export const runtime = 'nodejs'

function detectionWindow(): { windowStart: string; windowEnd: string } {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  const windowEnd = d.toISOString().slice(0, 10)
  d.setUTCDate(d.getUTCDate() - 89)
  return { windowStart: d.toISOString().slice(0, 10), windowEnd }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await context.params
  return withHandler({ protected: true }, async () => {
    const { windowStart, windowEnd } = detectionWindow()
    return runDetection(projectId, windowStart, windowEnd)
  })(req)
}
