import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { processGroupExists } from '@orca/process-host/process-tree-termination'

// Neither `code` nor `code-tunnel` stops its children, so a crashed Orca leaves whole serve-web groups behind.
const GROUPS_FILE = 'serve-web-groups.json'
const REAP_EXIT_WAIT_MS = 2_000
const REAP_POLL_MS = 50

let groupWrites: Promise<unknown> = Promise.resolve()
let reaped: Promise<void> | null = null

export function recordServeWebGroup(serverDataDir: string, groupId: number): Promise<void> {
  const file = join(serverDataDir, GROUPS_FILE)
  const next = groupWrites.then(async () => {
    const groups = await readGroups(file)
    await writeFile(file, JSON.stringify([...groups, groupId]))
  })
  groupWrites = next.catch(() => {})
  return next
}

/** Once per Orca run, before the first launch, so a leftover server cannot hold a folder's saved port. */
export function reapOrphanedServeWebGroups(serverDataDir: string): Promise<void> {
  reaped ??= reapOnce(serverDataDir).catch(() => {})
  return reaped
}

async function reapOnce(serverDataDir: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }
  const file = join(serverDataDir, GROUPS_FILE)
  const recorded = await readGroups(file)
  if (recorded.length === 0) {
    return
  }
  const live = await serveWebGroupsFor(serverDataDir)
  if (live === null) {
    return
  }
  // A recycled group id is only signalled when it still runs serve-web for this data dir.
  const orphans = recorded.filter((groupId) => live.has(groupId))
  for (const groupId of orphans) {
    try {
      process.kill(-groupId, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
  await writeFile(file, '[]')
  const deadline = Date.now() + REAP_EXIT_WAIT_MS
  while (orphans.some(processGroupExists) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, REAP_POLL_MS))
  }
}

async function serveWebGroupsFor(serverDataDir: string): Promise<Set<number> | null> {
  const result = await runProcess({
    program: 'ps',
    args: ['-eo', 'pgid=,args='],
    timeoutMs: 5_000
  })
  if (result.code !== 0 || result.timedOut) {
    return null
  }
  const groups = new Set<number>()
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/)
    if (match && match[2].includes('serve-web') && match[2].includes(serverDataDir)) {
      groups.add(Number(match[1]))
    }
  }
  return groups
}

async function readGroups(file: string): Promise<number[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => Number.isInteger(id) && id > 1)
      : []
  } catch {
    return []
  }
}
