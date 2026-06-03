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

  const wcToken = process.env.WC_API_TOKEN
  if (!wcToken) {
    return Response.json({ error: 'WC credentials not configured' }, { status: 500 })
  }

  // WC recording download works with ?token={api_token} query parameter
  // Return the authenticated URL for the browser to fetch directly
  const downloadUrl = wcUrl.includes('/download')
    ? `${wcUrl}?token=${wcToken}`
    : `${wcUrl.replace(/\/play$/, '/download')}?token=${wcToken}`

  return Response.json({ url: downloadUrl })
}
