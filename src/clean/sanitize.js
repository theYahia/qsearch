/**
 * Sanitize text content before indexing.
 * Removes HTML, prompt injection patterns, tracking params.
 */

export function sanitizeText (text) {
  if (!text || typeof text !== 'string') return ''

  let s = text

  // Remove HTML comments (could contain prompt injection)
  s = s.replace(/<!--[\s\S]*?-->/g, '')

  // Remove style/script tags
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')

  // Remove AI-targeting prompt injection patterns
  s = s.replace(/\[?(SYSTEM|AI|ASSISTANT|INSTRUCTION|PROMPT)\s*[:=][\s\S]{0,500}?(?=\n\n|\.|$)/gi, '')
  s = s.replace(/ignore\s+(all\s+)?previous\s+instructions[\s\S]{0,200}/gi, '')
  s = s.replace(/(now|new)\s+(act|behave|pretend)\s+as[\s\S]{0,200}/gi, '')

  // Remove zero-width and invisible characters
  s = s.replace(/[​-‏­⁠-⁯﻿]/g, '')

  // Strip excessive whitespace
  s = s.replace(/\s+/g, ' ').trim()

  return s
}

/**
 * Canonicalize URL — strip tracking params, normalize.
 */
export function canonicalizeUrl (url) {
  try {
    const u = new URL(url)
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid', 'ref', 'source', '_ga'
    ]
    for (const p of trackingParams) u.searchParams.delete(p)
    return u.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}
