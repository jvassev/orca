import type { WebContents } from 'electron'
import { validateLocalPathTarget } from '../ipc/shell/shell-owned-path-target'
import {
  isVsCodeServeWebRunning,
  startVsCodeServeWeb,
  VSCODE_WRAPPER_PATH
} from './vscode-serve-web'

const ERR_CONNECTION_REFUSED = -102
const recoveringGuests = new WeakSet<WebContents>()
const boundGuests = new WeakSet<WebContents>()

/** A restored or evicted VS Code tab reloads against a stopped server; restart it and reload. */
export function bindEmbeddedVsCodeGuestRecovery(guest: WebContents): void {
  if (boundGuests.has(guest)) {
    return
  }
  boundGuests.add(guest)
  guest.on('did-fail-load', (_event, errorCode, _description, validatedUrl, isMainFrame) => {
    const folderPath = embeddedVsCodeFolder(validatedUrl)
    if (
      !isMainFrame ||
      errorCode !== ERR_CONNECTION_REFUSED ||
      !folderPath ||
      recoveringGuests.has(guest)
    ) {
      return
    }
    recoverGuest(guest, folderPath)
  })
  // The first load may already have failed before registration bound this listener.
  const shownFolder = embeddedVsCodeFolder(guest.getURL())
  if (shownFolder && !isVsCodeServeWebRunning(shownFolder)) {
    recoverGuest(guest, shownFolder)
  }
}

function recoverGuest(guest: WebContents, folderPath: string): void {
  recoveringGuests.add(guest)
  void restartForGuest(guest, folderPath).finally(() => recoveringGuests.delete(guest))
}

export function embeddedVsCodeFolder(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'
      ? parsed.searchParams.get('folder')
      : null
  } catch {
    return null
  }
}

async function restartForGuest(guest: WebContents, folderPath: string): Promise<void> {
  const target = await validateLocalPathTarget(folderPath)
  if (!target.ok) {
    return
  }
  const result = await startVsCodeServeWeb(VSCODE_WRAPPER_PATH, target.path)
  if (result.ok && !guest.isDestroyed()) {
    await guest.loadURL(result.url).catch(() => {})
  }
}
