import { BigQuery } from '@google-cloud/bigquery'

const bigquery = new BigQuery({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
})

// BigQuery returns DATETIME/TIMESTAMP as {value: "..."} wrappers
// and NUMERIC as Big.js objects with {s, e, c} fields.
// Flatten both to plain JSON-serializable values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenValue(v: any): unknown {
  if (v == null || typeof v !== 'object') return v
  // {value: "..."} wrapper (DATETIME/TIMESTAMP)
  if ('value' in v && Object.keys(v).length === 1) return v.value
  // Big.js object (NUMERIC) — has s, e, c properties and a toNumber/toString method
  if ('s' in v && 'e' in v && 'c' in v && typeof v.toNumber === 'function') return v.toNumber()
  return v
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenRow(row: any): any {
  if (row == null || typeof row !== 'object') return row
  if (Array.isArray(row)) return row.map(flattenRow)
  const plain = flattenValue(row)
  if (plain !== row) return plain
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = flattenValue(v)
  }
  return out
}

export async function query<T>(
  sql: string,
  params?: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  types?: Record<string, any>
): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: any = { query: sql }
  if (params) options.params = params
  if (types) options.types = types
  const [rows] = await bigquery.query(options)
  return rows.map(flattenRow) as T[]
}

export default bigquery
