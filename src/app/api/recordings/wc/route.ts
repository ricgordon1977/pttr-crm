import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'

const ALLOWED_HOST = 'app.whatconverts.com'

export async function GET(request: NextRequest) {
  try { await verifyAuth(request) } catch (e) { return e as Response }

  const wcUrl = request.nextUrl.searchParams.get('url')

  if (!wcUrl) {
    return Response.json({ error: 'Missing url param' }, { status: 400 })
  }

  // Validate the URL is a WhatConverts recording URL
  try {
    const parsed = new URL(wcUrl)
    if (parsed.hostname !== ALLOWED_HOST || !parsed.pathname.startsWith('/recording/')) {
      return Response.json({ error: 'Invalid recording URL' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }

  // WC recording URLs require web session auth, not API auth.
  // Return the play URL for the user to open directly in WhatConverts.
  const playUrl = wcUrl.replace('/download', '/play')
  return Response.json({ url: playUrl, type: 'external' })
}
