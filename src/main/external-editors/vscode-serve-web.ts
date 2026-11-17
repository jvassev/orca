import { mkdir, readFile, realpath, symlink, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { app, webContents } from 'electron'
import { spawnProcess } from '@orca/process-host'
import { signalProcessTree } from '@orca/process-host/process-tree-termination'
import { recordServeWebGroup, reapOrphanedServeWebGroups } from './vscode-serve-web-process-groups'

export type VsCodeServeWebResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'not-installed' | 'launch-failed' | 'timeout' }

function getDesktopVsCodeUserDataDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Code')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? homedir(), 'Code')
  }
  return join(homedir(), '.config', 'Code')
}

async function prepareVsCodeServerDataDir(): Promise<string> {
  const serverDataDir = join(app.getPath('userData'), 'vscode-server-web')
  const dataDir = join(serverDataDir, 'data')
  await mkdir(dataDir, { recursive: true })

  const userDir = join(dataDir, 'User')
  const userTarget = join(getDesktopVsCodeUserDataDir(), 'User')
  await ensureSymlink(userDir, userTarget)

  const extensionsDir = join(serverDataDir, 'extensions')
  const extensionsTarget = join(homedir(), '.vscode', 'extensions')
  await ensureSymlink(extensionsDir, extensionsTarget)

  return serverDataDir
}

async function ensureSymlink(linkPath: string, targetPath: string): Promise<void> {
  try {
    await symlink(targetPath, linkPath, 'dir')
    return
  } catch (error) {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Node fs errors expose a .code string; cast is the standard pattern used throughout main for ErrnoException checks.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
  // If an existing directory is in the way, back it up so the symlink takes effect.
  try {
    const resolved = await realpath(linkPath)
    if (resolved === targetPath) {
      return
    }
  } catch {
    // realpath can fail on broken symlinks; fall through to backup.
  }
  await rename(linkPath, `${linkPath}.bak-${Date.now()}`)
  await symlink(targetPath, linkPath, 'dir')
}

export async function resolveVsCodeBinary(wrapperPath: string): Promise<{
  electron: string
  cli: string
} | null> {
  try {
    const resolved = await realpath(wrapperPath)
    const vscodePath = join(dirname(resolved), '..')
    return {
      electron: join(vscodePath, 'code'),
      cli: join(vscodePath, 'resources/app/out/cli.js')
    }
  } catch {
    return null
  }
}

// Browser storage (UI state, layout) is keyed by origin, so each folder keeps its port across restarts.
let portAssignment: Promise<unknown> = Promise.resolve()

function resolveFolderPort(serverDataDir: string, folderPath: string): Promise<number> {
  const next = portAssignment.then(() => assignFolderPort(serverDataDir, folderPath))
  portAssignment = next.catch(() => {})
  return next
}

async function assignFolderPort(serverDataDir: string, folderPath: string): Promise<number> {
  const portsFile = join(serverDataDir, 'ports.json')
  const ports = await readFolderPorts(portsFile)
  const saved = ports[folderPath]
  if (saved !== undefined && (await tryListen(saved)) !== null) {
    return saved
  }
  const taken = new Set(Object.values(ports))
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = await tryListen(0)
    if (port !== null && !taken.has(port)) {
      ports[folderPath] = port
      await writeFile(portsFile, JSON.stringify(ports, null, 2))
      return port
    }
  }
  throw new Error('no free port for VS Code serve-web')
}

async function readFolderPorts(portsFile: string): Promise<Record<string, number>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(portsFile, 'utf8'))
    const ports: Record<string, number> = {}
    if (parsed && typeof parsed === 'object') {
      for (const [folder, port] of Object.entries(parsed)) {
        if (Number.isInteger(port) && port > 0) {
          ports[folder] = port
        }
      }
    }
    return ports
  } catch {
    return {}
  }
}

function tryListen(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(null))
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const bound = typeof address === 'object' && address ? address.port : null
      server.close(() => resolve(bound))
    })
  })
}

export const VSCODE_WRAPPER_PATH = '/home/julian/.bin/code'

type ServeWebServer = { kill: () => void; baseUrl: string }

const launchesByFolder = new Map<string, Promise<ServeWebServer | VsCodeServeWebResult>>()
const runningByFolder = new Map<string, ServeWebServer>()
// Every spawned tree, including launches still waiting for their URL, so quit stops them too.
const spawnedTrees = new Set<() => void>()

// Grace covers reloads and webview remounts; an evicted tab restarts its server on reload.
const STOP_UNUSED_AFTER_MS = 15_000
let unusedSweep: ReturnType<typeof setTimeout> | null = null
let watchingGuestDestroy = false

function scheduleUnusedSweep(): void {
  if (unusedSweep) {
    clearTimeout(unusedSweep)
  }
  unusedSweep = setTimeout(stopUnusedServers, STOP_UNUSED_AFTER_MS)
  unusedSweep.unref?.()
}

function watchGuestDestroy(): void {
  if (watchingGuestDestroy) {
    return
  }
  watchingGuestDestroy = true
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      contents.once('destroyed', scheduleUnusedSweep)
    }
  })
}

function urlOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function stopUnusedServers(): void {
  unusedSweep = null
  const shownOrigins = new Set(
    webContents
      .getAllWebContents()
      .filter((contents) => !contents.isDestroyed())
      .map((contents) => urlOrigin(contents.getURL()))
  )
  for (const [folderPath, server] of runningByFolder) {
    if (!shownOrigins.has(urlOrigin(server.baseUrl))) {
      runningByFolder.delete(folderPath)
      server.kill()
    }
  }
}

export async function startVsCodeServeWeb(
  wrapperPath: string,
  folderPath: string
): Promise<VsCodeServeWebResult> {
  let launch = launchesByFolder.get(folderPath)
  if (!launch) {
    launch = launchServer(wrapperPath, folderPath).catch((): VsCodeServeWebResult => ({
      ok: false,
      reason: 'launch-failed'
    }))
    launchesByFolder.set(folderPath, launch)
  }
  const server = await launch
  if ('ok' in server) {
    if (launchesByFolder.get(folderPath) === launch) {
      launchesByFolder.delete(folderPath)
    }
    return server
  }
  return { ok: true, url: `${server.baseUrl}?folder=${encodeURIComponent(folderPath)}` }
}

async function launchServer(
  wrapperPath: string,
  folderPath: string
): Promise<ServeWebServer | VsCodeServeWebResult> {
  const binary = await resolveVsCodeBinary(wrapperPath)
  if (binary === null) {
    return { ok: false, reason: 'not-installed' }
  }

  const serverDataDir = await prepareVsCodeServerDataDir()
  await reapOrphanedServeWebGroups(serverDataDir)
  const port = await resolveFolderPort(serverDataDir, folderPath)

  return new Promise((resolve) => {
    const proc = spawnProcess({
      program: binary.electron,
      args: [
        binary.cli,
        'serve-web',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--without-connection-token',
        '--accept-server-license-terms',
        '--disable-telemetry',
        '--server-data-dir',
        serverDataDir
      ],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
      },
      stdio: 'pipe',
      // Own group on POSIX: the `code` launcher exits without stopping code-tunnel or its server.
      detached: process.platform !== 'win32'
    })
    const killTree = (): void => {
      spawnedTrees.delete(killTree)
      void signalProcessTree(proc, 'SIGTERM').catch(() => {})
    }
    spawnedTrees.add(killTree)
    const server: ServeWebServer = { kill: killTree, baseUrl: '' }
    if (proc.pid && process.platform !== 'win32') {
      void recordServeWebGroup(serverDataDir, proc.pid).catch(() => {})
    }

    let output = ''
    const timeout = setTimeout(() => {
      killTree()
      resolve({ ok: false, reason: 'timeout' })
    }, 30_000)

    const cleanup = (): void => {
      clearTimeout(timeout)
      launchesByFolder.delete(folderPath)
      if (runningByFolder.get(folderPath) === server) {
        runningByFolder.delete(folderPath)
      }
    }

    proc.on('error', () => {
      cleanup()
      resolve({ ok: false, reason: 'launch-failed' })
    })

    proc.on('exit', () => {
      killTree()
      cleanup()
      resolve({ ok: false, reason: 'launch-failed' })
    })

    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      const match = output.match(/Web UI available at (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) {
        proc.stdout?.off('data', onData)
        proc.stderr?.off('data', onData)
        clearTimeout(timeout)
        server.baseUrl = match[1]
        runningByFolder.set(folderPath, server)
        watchGuestDestroy()
        // A tab that never loads (or closes before loading) still lets its server go.
        scheduleUnusedSweep()
        resolve(server)
      }
    }

    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
  })
}

export function stopAllVsCodeServeWeb(): void {
  if (unusedSweep) {
    clearTimeout(unusedSweep)
    unusedSweep = null
  }
  for (const killTree of spawnedTrees) {
    killTree()
  }
  runningByFolder.clear()
  launchesByFolder.clear()
}

export function stopVsCodeServeWeb(folderPath: string): void {
  const server = runningByFolder.get(folderPath)
  if (server) {
    runningByFolder.delete(folderPath)
    server.kill()
  }
}

export function isVsCodeServeWebRunning(folderPath: string): boolean {
  return runningByFolder.has(folderPath)
}
