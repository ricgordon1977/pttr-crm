import { getJobs } from '@/lib/bigquery/queries'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const limit = Math.min(Number(url.searchParams.get('limit') || 500), 5000)
  try {
    const rows = await getJobs(limit)
    return Response.json(rows)
  } catch (error) {
    console.error('Jobs list error:', error)
    return Response.json([], { status: 500 })
  }
}
