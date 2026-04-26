import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { requirePayment, verifyPayment } from '../../../src/x402/middleware.js'

describe('x402 middleware (v0.3 passthrough)', () => {
  test('requirePayment is importable and returns a function', () => {
    const handler = async (req, res) => {}
    const wrapped = requirePayment(handler, {})
    assert.strictEqual(typeof wrapped, 'function')
  })

  test('passthrough when X402_ENABLED=false', async () => {
    process.env.X402_ENABLED = 'false'
    let called = false
    const handler = async (req, res) => { called = true }
    const wrapped = requirePayment(handler, {})
    await wrapped({}, {})
    assert.strictEqual(called, true)
  })

  test('verifyPayment returns valid=true when disabled', async () => {
    process.env.X402_ENABLED = 'false'
    const result = await verifyPayment('sig', {})
    assert.strictEqual(result.valid, true)
  })
})
