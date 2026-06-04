import { Storage } from '@google-cloud/storage'

const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
})

/**
 * Generate a signed URL for a GCS object.
 * @param gcsUri - gs://bucket/path format
 * @param ttlMinutes - TTL in minutes (default 30)
 * @returns HTTPS signed URL or null if input is invalid
 */
export async function getSignedUrl(gcsUri: string | null, ttlMinutes = 30): Promise<string | null> {
  if (!gcsUri || !gcsUri.startsWith('gs://')) return null

  const withoutPrefix = gcsUri.slice(5) // remove "gs://"
  const slashIdx = withoutPrefix.indexOf('/')
  if (slashIdx < 0) return null

  const bucket = withoutPrefix.slice(0, slashIdx)
  const filePath = withoutPrefix.slice(slashIdx + 1)

  try {
    const [url] = await storage.bucket(bucket).file(filePath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlMinutes * 60 * 1000,
    })
    return url
  } catch (error) {
    console.error('Failed to sign URL for', gcsUri, error)
    return null
  }
}
