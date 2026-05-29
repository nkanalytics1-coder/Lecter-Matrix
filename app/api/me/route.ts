import { withHandler } from '@/server/http'

export async function GET(req: Request): Promise<Response> {
  return withHandler({ protected: true }, async ({ user }) => {
    return { id: user!.id, email: user!.email }
  })(req)
}
