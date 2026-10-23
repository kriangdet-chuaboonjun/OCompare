import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve, sep } from 'node:path'
import { createServer } from 'vite'

/** Browser transport calls the same Rust services, scoped to one disposable fixture root. */
export async function startFolderTestServer(root, port = 1422) {
  const allow = (path) => {
    if (
      typeof path !== 'string' ||
      !resolve(path)
        .toLowerCase()
        .startsWith((resolve(root) + sep).toLowerCase())
    )
      throw new Error('Test path outside fixture root')
  }
  const child = spawn(
    resolve('src-tauri/target/debug/examples/folder-workspace.exe'),
    [resolve(root, 'sessions.json')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const pending = new Map()
  let id = 0
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const output = JSON.parse(line),
      task = pending.get(output.id)
    pending.delete(output.id)
    if (output.error) task?.reject(new Error(output.error.message))
    else task?.resolve(output.data)
  })
  child.on('error', (e) => {
    for (const p of pending.values()) p.reject(e)
    pending.clear()
  })
  child.on('exit', () => {
    for (const p of pending.values()) p.reject(new Error(stderr || 'Rust transport closed'))
    pending.clear()
  })
  const call = (args) =>
    new Promise((resolve, reject) => {
      const request = ++id
      pending.set(request, { resolve, reject })
      child.stdin.write(JSON.stringify({ ...args, id: request }) + '\n')
    })
  const server = await createServer({
    configFile: false,
    cacheDir: resolve('.cache', `vite-folder-${port}`),
    root: process.cwd(),
    optimizeDeps: { entries: ['src/renderer/index.html'], include: ['monaco-editor/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js'] },
    define: { __APP_VERSION__: JSON.stringify('0.3.0') },
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      watch: { ignored: ['**/src-tauri/target/**', '**/release/**', '**/docs/evidence/**'] },
    },
    plugins: [
      {
        name: 'rust-folder-workspace-test',
        enforce: 'pre',
        resolveId(source, importer) {
          if (source === './platform' && importer?.replaceAll('\\', '/').endsWith('/src/renderer/main.ts'))
            return resolve('tests/folder-platform.ts')
        },
        configureServer(vite) {
          vite.middlewares.use('/__folder_test', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.end()
              return
            }
            try {
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const args = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              let data
              if (req.url === '/workspace') {
                for (const key of ['leftPath', 'rightPath', 'path']) if (args[key]) allow(args[key])
                data = await call(args)
              } else if (req.url === '/file') {
                allow(args.path)
                const file = spawn(resolve('src-tauri/target/debug/examples/file-bridge.exe'), [], {
                  windowsHide: true,
                  stdio: ['pipe', 'pipe', 'pipe'],
                })
                data = await new Promise((resolve, reject) => {
                  let output = '',
                    error = ''
                  file.stdout.on('data', (c) => (output += c))
                  file.stderr.on('data', (c) => (error += c))
                  file.on('error', reject)
                  file.on('exit', (code) => {
                    if (code !== 0) return reject(new Error(error))
                    const r = JSON.parse(output)
                    r.error ? reject(new Error(r.error.message)) : resolve(r.data)
                  })
                  file.stdin.end(JSON.stringify(args))
                })
              } else throw new Error('Unknown route')
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ data }))
            } catch (e) {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: { message: e.message } }))
            }
          })
        },
      },
    ],
  })
  await server.listen()
  return {
    url: `http://127.0.0.1:${port}/src/renderer/index.html`,
    call,
    diagnostics: () => stderr,
    close: async () => {
      child.kill()
      await server.close()
    },
  }
}
