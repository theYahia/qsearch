// x402 payment middleware skeleton.
// v0.3: X402_ENABLED=false — unconditionally passes through.
// v0.4: set X402_ENABLED=true and implement on-chain verification via x402 SDK.

// Wraps a node:http (req, res) handler with x402 enforcement.
// opts: { priceUsdt, recipient, network, skipIf }
// skipIf: (req) => bool — allowlist (e.g. dev mode, CORS preflight, /health)
export function requirePayment (handler, opts = {}) {
  const enabled = process.env.X402_ENABLED === 'true'
  return async function (req, res) {
    if (!enabled || opts.skipIf?.(req)) return handler(req, res)

    // v0.4: check X-PAYMENT-SIGNATURE header
    const sig = req.headers['x-payment-signature']
    if (!sig) {
      const paymentRequired = {
        network: process.env.X402_NETWORK || 'base',
        asset: 'USDT',
        amount: process.env.X402_PRICE_USDT || '0.01',
        recipient: process.env.X402_RECIPIENT || '',
        description: 'qsearch API access'
      }
      res.writeHead(402, {
        'Content-Type': 'application/json',
        'X-PAYMENT-REQUIRED': Buffer.from(JSON.stringify(paymentRequired)).toString('base64')
      })
      res.end(JSON.stringify({ error: 'payment_required', payment: paymentRequired }))
      return
    }

    // v0.4: verify signature via x402 SDK
    const { valid } = await verifyPayment(sig, opts)
    if (!valid) {
      res.writeHead(402, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid_payment_signature' }))
      return
    }

    return handler(req, res)
  }
}

// Stub verifier — returns valid=true until v0.4 wires up the real SDK.
export async function verifyPayment (signature, opts = {}) {
  if (process.env.X402_ENABLED !== 'true') return { valid: true, amount: '0', from: '', txHash: null }
  // v0.4: import { verifyPayment as sdkVerify } from 'x402'
  // return sdkVerify(signature, { facilitatorUrl: process.env.X402_FACILITATOR_URL, ... })
  return { valid: false, amount: '0', from: '', txHash: null }
}
