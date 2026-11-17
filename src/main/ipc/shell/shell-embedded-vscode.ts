import { ipcMain } from 'electron'
import {
  startVsCodeServeWeb,
  stopVsCodeServeWeb,
  VSCODE_WRAPPER_PATH
} from '../../external-editors/vscode-serve-web'
import { embeddedVsCodeFolder } from '../../external-editors/embedded-vscode-guest-recovery'
import { isLocallyOwned, resolveOwnedPathTarget } from './shell-owned-path-target'
import type { ShellOpenEmbeddedVsCodeResult } from '../../../shared/shell/opening/shell-open-types'

async function openEmbeddedVsCode(
  path: string,
  ownerHostId: unknown
): Promise<ShellOpenEmbeddedVsCodeResult> {
  if (!isLocallyOwned(ownerHostId)) {
    return { ok: false, reason: 'remote-runtime-unsupported' }
  }
  const target = await resolveOwnedPathTarget(path, ownerHostId)
  if (!target.ok) {
    return target
  }
  return startVsCodeServeWeb(VSCODE_WRAPPER_PATH, target.path)
}

export function registerEmbeddedVsCodeHandlers(): void {
  ipcMain.handle('shell:openEmbeddedVsCode', (_event, path: string, ownerHostId: unknown) =>
    openEmbeddedVsCode(path, ownerHostId)
  )
  ipcMain.handle('shell:stopEmbeddedVsCode', (_event, url: unknown) => {
    const folderPath = typeof url === 'string' ? embeddedVsCodeFolder(url) : null
    if (folderPath) {
      stopVsCodeServeWeb(folderPath)
    }
  })
}
