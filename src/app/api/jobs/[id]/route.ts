import { getJobDetail, getJobLabour, getJobInteractions, getJobNotes } from '@/lib/bigquery/queries'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const [taskRows, labour, interactions, notes] = await Promise.all([
      getJobDetail(id),
      getJobLabour(id),
      getJobInteractions(id),
      getJobNotes(id),
    ])

    const task = (taskRows as Record<string, unknown>[])[0] ?? null
    if (!task) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }

    return Response.json({
      ...task,
      labour,
      materials: [],
      interactions,
      notes,
    })
  } catch (error) {
    console.error('Job detail error:', error)
    return Response.json({ error: 'Failed to fetch job' }, { status: 500 })
  }
}
