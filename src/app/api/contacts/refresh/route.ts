import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'

const CONTACTS_URL = 'https://aroflo-contacts-ingest-tuxv3ywlea-ts.a.run.app'

export async function POST(request: NextRequest) {
  try { await verifyAuth(request) } catch (e) { return e as Response }

  const today = new Date().toISOString().slice(0, 10)

  // Call the existing contacts ingest function with today's date
  // This refreshes contacts_deduped with any contacts modified today (~3s)
  const { GoogleAuth } = await import('google-auth-library')
  const auth = new GoogleAuth()
  const client = await auth.getIdTokenClient(CONTACTS_URL)
  const res = await client.request({
    url: `${CONTACTS_URL}?mode=daily&date_start=${today}&max_pages=10`,
    method: 'GET',
  })

  return Response.json(res.data)
}
