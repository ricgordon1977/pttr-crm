import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { createHmac } from 'crypto'

const ALLOWED_HOST = 'app.whatconverts.com'
const SIGNATURE_SECRET = process.env.WC_API_SECRET || 'fallback-secret'

// ETTR and PTTR have separate WC API tokens — recordings are profile-scoped
const WC_TOKENS = [
  process.env.WC_API_TOKEN_ETTR,
  process.env.WC_API_TOKEN_PTTR,
].filter(Boolean) as string[]

function signUrl(wcUrl: string, expiresAt: number): string {
  const payload = `${wcUrl}:${expiresAt}`
  return createHmac('sha256', SIGNATURE_SECRET).update(payload).digest('hex').slice(0, 16)
}

function verifySignature(wcUrl: string, expiresAt: number, signature: string): boolean {
  return signUrl(wcUrl, expiresAt) === signature && Date.now() < expiresAt
}

/** Try fetching the recording with each WC token until one works */
async function fetchWithTokens(wcUrl: string): Promise<Response | null> {
  const baseUrl = wcUrl.includes('/download')
    ? wcUrl
    : wcUrl.replace(/\/play$/, '/download')

  for (const token of WC_TOKENS) {
    const res = await fetch(`${baseUrl}?token=${token}`, { redirect: 'follow' })
    if (res.ok && (res.headers.get('content-type') || '').includes('audio')) {
      return res
    }
    // Consume body to avoid connection leak
    await res.arrayBuffer().catch(() => {})
  }
  return null
}

// GET /api/recordings/wc?url=...
// Mode 1: With Authorization header → returns a signed stream URL
// Mode 2: With sig+exp params → streams the audio
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const wcUrl = searchParams.get('url')
  const sig = searchParams.get('sig')
  const exp = searchParams.get('exp')

  if (!wcUrl) {
    return Response.json({ error: 'Missing url param' }, { status: 400 })
  }

  try {
    const parsed = new URL(wcUrl)
    if (parsed.hostname !== ALLOWED_HOST || !parsed.pathname.startsWith('/recording/')) {
      return Response.json({ error: 'Invalid recording URL' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }

  // Mode 2: Stream audio with signed URL
  if (sig && exp) {
    const expiresAt = parseInt(exp, 10)
    if (!verifySignature(wcUrl, expiresAt, sig)) {
      return Response.json({ error: 'Invalid or expired signature' }, { status: 403 })
    }

    if (WC_TOKENS.length === 0) {
      return Response.json({ error: 'WC credentials not configured' }, { status: 500 })
    }

    try {
      const res = await fetchWithTokens(wcUrl)
      if (!res || !res.body) {
        return Response.json({ error: 'Recording not available' }, { status: 502 })
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

  // Mode 1: Return a signed stream URL
  try { await verifyAuth(request) } catch (e) { return e as Response }

  const expiresAt = Date.now() + 15 * 60 * 1000
  const signature = signUrl(wcUrl, expiresAt)
  const streamUrl = `/api/recordings/wc?url=${encodeURIComponent(wcUrl)}&sig=${signature}&exp=${expiresAt}`

  return Response.json({ url: streamUrl })
}
