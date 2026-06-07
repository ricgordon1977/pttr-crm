import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { query } from '@/lib/bigquery/client'

const DS = 'pttr-taskdata.ds_crm'

export async function GET(request: NextRequest) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) return Response.json([])

  const rows = await query(`
    SELECT account_id, account_name, client_category, phone, address_suburb
    FROM \`${DS}.vw_accounts\`
    WHERE LOWER(account_name) LIKE LOWER(@term)
    ORDER BY total_jobs DESC
    LIMIT 20
  `, { term: `%${q}%` })

  return Response.json(rows)
}
