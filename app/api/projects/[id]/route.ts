import { withHandler } from '@/server/http'
import { UpdateProjectSchema } from '@/src/contracts/schemas/requests'
import { getProject, updateProject, deleteProject } from '@/server/repositories/project.repo'
import { ContractError } from '@/src/contracts/lib/contract-utils'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  return withHandler({ protected: true }, async () => {
    const project = await getProject(id)
    if (project === null) throw new ContractError('not_found', 'Project not found')
    return project
  })(req)
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  return withHandler({ protected: true, schema: UpdateProjectSchema }, async ({ parsed }) => {
    const project = await updateProject(id, parsed)
    if (project === null) throw new ContractError('not_found', 'Project not found')
    return project
  })(req)
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  return withHandler({ protected: true }, async () => {
    const deleted = await deleteProject(id)
    if (!deleted) throw new ContractError('not_found', 'Project not found')
    return null
  })(req)
}
