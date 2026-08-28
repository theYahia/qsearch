import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createJob, getJob, updateJob } from '../../../src/jobs/store.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('jobs/store — createJob', () => {
  test('returns a v4 UUID job_id', () => {
    const id = createJob('https://example.com', 'ns')
    assert.match(id, UUID_RE)
  })

  test('initial job shape is fully pinned (queued, zero counters, null timestamps)', () => {
    const id = createJob('https://example.com/page', 'corpus-a')
    const job = getJob(id)
    assert.deepEqual(job, {
      job_id: id,
      status: 'queued',
      url: 'https://example.com/page',
      namespace: 'corpus-a',
      pages_crawled: 0,
      pages_indexed: 0,
      error: null,
      queued_at: job.queued_at, // checked separately below
      started_at: null,
      finished_at: null
    })
  })

  test('queued_at is a valid ISO-8601 timestamp set at creation', () => {
    const before = Date.now()
    const id = createJob('https://example.com', 'ns')
    const after = Date.now()
    const { queued_at } = getJob(id)
    assert.equal(typeof queued_at, 'string')
    // round-trips through Date and matches strict ISO output
    const parsed = new Date(queued_at)
    assert.equal(parsed.toISOString(), queued_at)
    const ms = parsed.getTime()
    assert.ok(ms >= before && ms <= after, `queued_at ${ms} not in [${before}, ${after}]`)
  })

  test('each call mints a distinct job_id (no collisions across many calls)', () => {
    const ids = new Set()
    for (let i = 0; i < 200; i++) ids.add(createJob('https://example.com', 'ns'))
    assert.equal(ids.size, 200)
  })

  test('stores url and namespace verbatim, including falsy/undefined args', () => {
    const id = createJob(undefined, null)
    const job = getJob(id)
    assert.equal(job.url, undefined)
    assert.equal(job.namespace, null)
    // job_id is still minted regardless of arg validity
    assert.match(job.job_id, UUID_RE)
  })

  test('separate jobs are independent objects (no shared reference)', () => {
    const a = getJob(createJob('https://a.test', 'ns'))
    const b = getJob(createJob('https://b.test', 'ns'))
    assert.notEqual(a, b)
    updateJob(a.job_id, { status: 'running' })
    assert.equal(a.status, 'running')
    assert.equal(b.status, 'queued') // mutating a must not affect b
  })
})

describe('jobs/store — getJob', () => {
  test('returns the live stored object for a known id', () => {
    const id = createJob('https://example.com', 'ns')
    const job = getJob(id)
    assert.ok(job)
    assert.equal(job.job_id, id)
  })

  test('returns the SAME reference on repeated reads (live Map, not a copy)', () => {
    const id = createJob('https://example.com', 'ns')
    assert.equal(getJob(id), getJob(id))
  })

  test('returns null for an unknown id', () => {
    assert.equal(getJob('00000000-0000-4000-8000-000000000000'), null)
  })

  test('returns null for falsy / malformed keys (the `|| null` branch)', () => {
    assert.equal(getJob(undefined), null)
    assert.equal(getJob(null), null)
    assert.equal(getJob(''), null)
    assert.equal(getJob(0), null)
  })
})

describe('jobs/store — updateJob', () => {
  test('applies a partial patch and leaves untouched fields intact', () => {
    const id = createJob('https://example.com', 'ns')
    updateJob(id, { status: 'running', started_at: '2026-06-23T00:00:00.000Z', pages_crawled: 5 })
    const job = getJob(id)
    assert.equal(job.status, 'running')
    assert.equal(job.started_at, '2026-06-23T00:00:00.000Z')
    assert.equal(job.pages_crawled, 5)
    // untouched fields keep their initial values
    assert.equal(job.pages_indexed, 0)
    assert.equal(job.finished_at, null)
    assert.equal(job.url, 'https://example.com')
  })

  test('successive patches accumulate (Object.assign overwrite semantics)', () => {
    const id = createJob('https://example.com', 'ns')
    updateJob(id, { pages_crawled: 1 })
    updateJob(id, { pages_indexed: 1, status: 'running' })
    updateJob(id, { pages_crawled: 9 }) // overwrites the earlier 1
    const job = getJob(id)
    assert.equal(job.pages_crawled, 9)
    assert.equal(job.pages_indexed, 1)
    assert.equal(job.status, 'running')
  })

  test('can add new keys not present in the initial shape', () => {
    const id = createJob('https://example.com', 'ns')
    updateJob(id, { custom_field: 'extra' })
    assert.equal(getJob(id).custom_field, 'extra')
  })

  test('empty patch is a harmless no-op (shape unchanged)', () => {
    const id = createJob('https://example.com', 'ns')
    const before = { ...getJob(id) }
    updateJob(id, {})
    assert.deepEqual(getJob(id), before)
  })

  test('returns undefined (no return value contract)', () => {
    const id = createJob('https://example.com', 'ns')
    assert.equal(updateJob(id, { status: 'done' }), undefined)
  })

  test('no-op for unknown id — does not create a job (the `if (!j) return` branch)', () => {
    const unknown = '11111111-1111-4111-8111-111111111111'
    assert.equal(updateJob(unknown, { status: 'running' }), undefined)
    // patch was dropped, not stored as a new job
    assert.equal(getJob(unknown), null)
  })

  test('no-op for falsy id', () => {
    assert.doesNotThrow(() => updateJob(undefined, { status: 'x' }))
    assert.doesNotThrow(() => updateJob(null, { status: 'x' }))
  })
})
