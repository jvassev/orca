import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
  webContents: { fromId: vi.fn() }
}))

import { setupGrabShortcutForwarding } from './browser-guest-grab-shortcuts'

type Handler = (event: { preventDefault: () => void }, input: Electron.Input) => void

const mod = process.platform === 'darwin' ? { meta: true } : { control: true }

function keyDown(key: string, code: string): Electron.Input {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: grab forwarding reads only these key fields.
  return {
    type: 'keyDown',
    key,
    code,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    isAutoRepeat: false,
    ...mod
  } as Electron.Input
}

function chromelessGrabHarness(isChromeless: boolean) {
  const send = vi.fn()
  const executeJavaScript = vi.fn()
  const handlers = new Map<string, Handler>()
  const guest = {
    id: 9,
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    off: vi.fn(),
    executeJavaScript
  }
  setupGrabShortcutForwarding({
    browserTabId: 'browser-tab:9',
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: grab forwarding only subscribes to guest input events and runs executeJavaScript.
    guest: guest as unknown as Electron.WebContents,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: forwarding only sends to the renderer.
    resolveRenderer: () => ({ send }) as unknown as Electron.WebContents,
    hasActiveGrabOp: () => false,
    isChromeless: () => isChromeless
  })
  const press = (input: Electron.Input) => {
    const preventDefault = vi.fn()
    handlers.get('before-input-event')?.({ preventDefault }, input)
    return preventDefault
  }
  return { send, press, executeJavaScript }
}

describe('chromeless guest grab shortcut forwarding', () => {
  it('leaves Mod+C alone inside a chromeless guest so it copies in the embedded app', () => {
    const { send, press, executeJavaScript } = chromelessGrabHarness(true)
    const consumed = press(keyDown('c', 'KeyC'))
    expect(executeJavaScript).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(consumed).not.toHaveBeenCalled()
  })

  it('still probes grab mode for ordinary browser guests', () => {
    const { executeJavaScript, press } = chromelessGrabHarness(false)
    executeJavaScript.mockResolvedValue(false)
    press(keyDown('c', 'KeyC'))
    expect(executeJavaScript).toHaveBeenCalled()
  })
})
