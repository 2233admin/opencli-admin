import { redirect } from 'next/navigation'

type CanvasRedirectProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CanvasRedirectPage({ searchParams }: CanvasRedirectProps) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item))
    else if (value !== undefined) query.set(key, value)
  }
  const workspaceId = query.get('workspace')
  const projectId = query.get('project')
  if (workspaceId && projectId) redirect(`/studio/workflow?${query.toString()}`)

  const studioQuery = new URLSearchParams()
  if (workspaceId) studioQuery.set('workspace', workspaceId)
  const suffix = studioQuery.toString()
  redirect(`/studio${suffix ? `?${suffix}` : ''}`)
}
