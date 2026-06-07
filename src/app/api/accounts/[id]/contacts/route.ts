import { NextRequest } from 'next/server'
import { verifyAuth } from '@/lib/auth/verify-token'
import { query } from '@/lib/bigquery/client'

const DS = 'pttr-taskdata.ds_aroflo'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await verifyAuth(request) } catch (e) { return e as Response }
  const { id: accountId } = await params

  // Pull real client contacts from contacts_deduped (AroFlo source of truth),
  // NOT vw_contacts which incorrectly uses task contactname (CSR/staff names).
  const rows = await query(`
    SELECT
      cd.contactid AS contact_id,
      CONCAT(COALESCE(cd.lastname, ''), ', ', COALESCE(cd.firstname, '')) AS contact_name,
      cd.phone,
      cd.mobile,
      cd.email
    FROM \`${DS}.contacts_deduped\` cd
    WHERE cd.clientid = @accountId
      AND (cd.archived IS NULL OR cd.archived != 'true')
      AND COALESCE(cd.firstname, cd.lastname) IS NOT NULL
    ORDER BY cd.lastname, cd.firstname
  `, { accountId })

  return Response.json(rows)
}
