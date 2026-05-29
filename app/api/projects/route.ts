import { withHandler } from '@/server/http'
import { CreateProjectSchema } from '@/src/contracts/schemas/requests'
import { listProjects, createProject } from '@/server/repositories/project.repo'
import { ContractError } from '@/src/contracts/lib/contract-utils'

export async function GET(req: Request): Promise<Response> {
  return withHandler({ protected: true }, async () => listProjects())(req)
}

export async function POST(req: Request): Promise<Response> {
  return withHandler({ protected: true, schema: CreateProjectSchema }, async ({ parsed }) => {
    try {
      return await createProject(parsed)
    } catch (err) {
      if (String(err).includes('uq_project_property')) {
        throw new ContractError('conflict', 'A project with this GSC property already exists')
      }
      throw err
    }
  })(req)
}
