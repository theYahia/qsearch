import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKER = join(__dirname, 'crawl4ai_worker.py')
const TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS) || 60_000

// Spawns crawl4ai_worker.py and streams parsed docs via callback.
// Returns Promise<{pages: {url, title, text}[], error: string|null}>
export async function crawl (url, { depth = 1, onDoc } = {}) {
  return new Promise((resolve) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
    const child = spawn(pythonCmd, [WORKER, '--url', url, '--depth', String(depth)], {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    })

    const pages = []
    const errors = []
    const rl = createInterface({ input: child.stdout })

    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const doc = JSON.parse(line)
        if (doc.error) { errors.push(doc.error); return }
        pages.push(doc)
        onDoc?.(doc)
      } catch { /* ignore non-JSON lines */ }
    })

    child.stderr.on('data', (d) => console.error('[crawl4ai]', d.toString().trim()))

    const timer = setTimeout(() => {
      child.kill()
      resolve({ pages, error: `Crawl timeout after ${TIMEOUT_MS}ms` })
    }, TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ pages, error: errors[0] || (code !== 0 && code !== null ? `Worker exited ${code}` : null) })
    })
  })
}
