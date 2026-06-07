import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { query } from '@/lib/bigquery/client'

const DS = 'pttr-taskdata.ds_crm'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: accountId } = await params

  const rows = await query(`
    SELECT contact_id, contact_name, contact_type, phone, mobile, email
    FROM \`${DS}.vw_contacts\`
    WHERE account_id = @accountId
    ORDER BY contact_name
  `, { accountId })

  return Response.json(rows)
}
