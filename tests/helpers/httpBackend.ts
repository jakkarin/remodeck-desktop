import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

export type BackendRequest = { method: string; path: string; authorization?: string }

function backendCommand(): Promise<{ cmd: string; args: string[] }> {
  return new Promise((resolve) => {
    execFile('git', ['--exec-path'], { encoding: 'utf8' }, (err, stdout) => {
      if (!err) {
        const dir = stdout.trim()
        for (const name of ['git-http-backend.exe', 'git-http-backend']) {
          const p = path.join(dir, name)
          if (fs.existsSync(p)) return resolve({ cmd: p, args: [] })
        }
      }
      resolve({ cmd: 'git', args: ['http-backend'] })
    })
  })
}

const HEADER_END = /\r?\n\r?\n/

/** Serves bare repos under `projectRoot` over smart HTTP via `git http-backend` (stands in for GitHub). */
export async function startHttpBackend(projectRoot: string): Promise<{
  url: string
  requests: BackendRequest[]
  close(): Promise<void>
}> {
  const { cmd, args } = await backendCommand()
  const requests: BackendRequest[] = []

  const server = http.createServer((req, res) => {
    const raw = req.url ?? '/'
    const q = raw.indexOf('?')
    const pathname = q < 0 ? raw : raw.slice(0, q)
    const query = q < 0 ? '' : raw.slice(q + 1)
    requests.push({
      method: req.method ?? '',
      path: pathname,
      authorization: req.headers.authorization
    })

    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.CONTENT_LENGTH
    Object.assign(env, {
      GIT_PROJECT_ROOT: projectRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      REMOTE_USER: 'test',
      REQUEST_METHOD: req.method ?? 'GET',
      PATH_INFO: decodeURIComponent(pathname),
      QUERY_STRING: query,
      CONTENT_TYPE: req.headers['content-type'] ?? '',
      HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
      HTTP_GIT_PROTOCOL: req.headers['git-protocol'] ?? '',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.receivepack',
      GIT_CONFIG_VALUE_0: 'true'
    })
    if (req.headers['content-length']) env.CONTENT_LENGTH = req.headers['content-length']

    const child = spawn(cmd, [...args], { env, stdio: ['pipe', 'pipe', 'ignore'] })
    child.stdin.on('error', () => {})
    req.pipe(child.stdin)

    let head = Buffer.alloc(0)
    let headersDone = false
    child.stdout.on('data', (chunk: Buffer) => {
      if (headersDone) {
        res.write(chunk)
        return
      }
      head = Buffer.concat([head, chunk])
      const text = head.toString('latin1')
      const m = HEADER_END.exec(text)
      if (!m) return
      headersDone = true
      let status = 200
      for (const line of text.slice(0, m.index).split(/\r?\n/)) {
        const i = line.indexOf(':')
        if (i <= 0) continue
        const name = line.slice(0, i).trim()
        const value = line.slice(i + 1).trim()
        if (name.toLowerCase() === 'status') status = parseInt(value, 10)
        else res.setHeader(name, value)
      }
      res.writeHead(status)
      res.write(head.subarray(m.index + m[0].length))
    })
    child.stdout.on('end', () => {
      if (!headersDone) res.writeHead(500)
      res.end()
    })
    child.on('error', () => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
