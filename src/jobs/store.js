import { randomUUID } from 'node:crypto'

// In-memory job table. Restarting the server wipes job states but NOT corpus data.
const jobs = new Map()

export function createJob (url, namespace) {
  const job_id = randomUUID()
  jobs.set(job_id, {
    job_id,
    status: 'queued',
    url,
    namespace,
    pages_crawled: 0,
    pages_indexed: 0,
    error: null,
    queued_at: new Date().toISOString(),
    started_at: null,
    finished_at: null
  })
  return job_id
}

export function getJob (job_id) {
  return jobs.get(job_id) || null
}

export function updateJob (job_id, patch) {
  const j = jobs.get(job_id)
  if (!j) return
  Object.assign(j, patch)
}
