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
  const suffix = query.toString()
  redirect(`/studio/workflow${suffix ? `?${suffix}` : ''}`)
}
