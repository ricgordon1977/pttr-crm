import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { createHmac } from 'crypto'

const ALLOWED_HOST = 'app.whatconverts.com'
const SIGNATURE_SECRET = process.env.WC_API_SECRET || 'fallback-secret'

/** Generate a time-limited signature for a recording URL */
function signUrl(wcUrl: string, expiresAt: number): string {
  const payload = `${wcUrl}:${expiresAt}`
  return createHmac('sha256', SIGNATURE_SECRET).update(payload).digest('hex').slice(0, 16)
}

/** Verify a signature */
function verifySignature(wcUrl: string, expiresAt: number, signature: string): boolean {
  return signUrl(wcUrl, expiresAt) === signature && Date.now() < expiresAt
}

// GET /api/recordings/wc?url=...
// Two modes:
// 1. With Authorization header: returns a signed stream URL (called by authFetch)
// 2. With sig+exp params: streams the audio (called by <audio> element)
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const wcUrl = searchParams.get('url')
  const sig = searchParams.get('sig')
  const exp = searchParams.get('exp')

  if (!wcUrl) {
    return Response.json({ error: 'Missing url param' }, { status: 400 })
  }

  // Validate URL
  try {
    const parsed = new URL(wcUrl)
    if (parsed.hostname !== ALLOWED_HOST || !parsed.pathname.startsWith('/recording/')) {
      return Response.json({ error: 'Invalid recording URL' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }

  // Mode 2: Stream audio with signed URL (no auth header needed)
  if (sig && exp) {
    const expiresAt = parseInt(exp, 10)
    if (!verifySignature(wcUrl, expiresAt, sig)) {
      return Response.json({ error: 'Invalid or expired signature' }, { status: 403 })
    }

    const wcToken = process.env.WC_API_TOKEN
    if (!wcToken) {
      return Response.json({ error: 'WC credentials not configured' }, { status: 500 })
    }

    const downloadUrl = wcUrl.includes('/download')
      ? `${wcUrl}?token=${wcToken}`
      : `${wcUrl.replace(/\/play$/, '/download')}?token=${wcToken}`

    try {
      const res = await fetch(downloadUrl, { redirect: 'follow' })
      if (!res.ok || !res.body) {
        return Response.json({ error: 'Failed to fetch recording' }, { status: 502 })
      }
      return new Response(res.body, {
        headers: {
          'Content-Type': res.headers.get('content-type') || 'audio/mpeg',
          'Content-Length': res.headers.get('content-length') || '',
          'Cache-Control': 'private, max-age=900',
        },
      })
    } catch {
      return Response.json({ error: 'Failed to stream recording' }, { status: 500 })
    }
  }

  // Mode 1: Return a signed stream URL (requires Firebase auth)
  try { await verifyAuth(request) } catch (e) { return e as Response }

  const expiresAt = Date.now() + 15 * 60 * 1000 // 15 minutes
  const signature = signUrl(wcUrl, expiresAt)
  const streamUrl = `/api/recordings/wc?url=${encodeURIComponent(wcUrl)}&sig=${signature}&exp=${expiresAt}`

  return Response.json({ url: streamUrl })
}
