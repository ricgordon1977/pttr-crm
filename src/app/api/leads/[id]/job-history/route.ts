import { getJobHistory } from '@/lib/bigquery/queries'
import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id } = await params

  if (!id) {
    return Response.json([])
  }

  try {
    const rows = await getJobHistory(id)
    return Response.json(rows)
  } catch (error) {
    console.error('Job history error:', error)
    return Response.json([])
  }
}
