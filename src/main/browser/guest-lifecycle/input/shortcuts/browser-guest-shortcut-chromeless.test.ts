import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
  webContents: { fromId: vi.fn() }
}))

import { setupGuestShortcutForwarding } from './browser-guest-shortcut-forwarding'

type Handler = (event: { preventDefault: () => void }, input: Electron.Input) => void

const mod = process.platform === 'darwin' ? { meta: true } : { control: true }

function keyDown(key: string, code: string, shift = false): Electron.Input {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: forwarding reads only these key fields.
  return {
    type: 'keyDown',
    key,
    code,
    shift,
    control: false,
    alt: false,
    meta: false,
    isAutoRepeat: false,
    ...mod
  } as Electron.Input
}

function chromelessGuestHarness(isChromeless: boolean) {
  const send = vi.fn()
  const handlers = new Map<string, Handler>()
  const guest = {
    id: 9,
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    off: vi.fn()
  }
  setupGuestShortcutForwarding({
    browserTabId: 'browser-tab:9',
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: forwarding only subscribes to guest input events.
    guest: guest as unknown as Electron.WebContents,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: forwarding only sends to the renderer.
    resolveRenderer: () => ({ send }) as unknown as Electron.WebContents,
    isChromeless: () => isChromeless,
    browserPage: true
  })
  const press = (input: Electron.Input) => {
    const preventDefault = vi.fn()
    handlers.get('before-input-event')?.({ preventDefault }, input)
    return preventDefault
  }
  return { send, press }
}

describe('chromeless guest shortcut forwarding', () => {
  it('keeps the tab close shortcut inside a chromeless guest', () => {
    const { send, press } = chromelessGuestHarness(true)
    const consumed = press(keyDown('w', 'KeyW'))
    expect(send).not.toHaveBeenCalled()
    expect(consumed).not.toHaveBeenCalled()
  })

  it('keeps Mod+R and Mod+Shift+R inside a chromeless guest', () => {
    const { send, press } = chromelessGuestHarness(true)
    expect(press(keyDown('r', 'KeyR'))).not.toHaveBeenCalled()
    expect(press(keyDown('R', 'KeyR', true))).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps Mod+P inside a chromeless guest but opens Quick Open for ordinary guests', () => {
    const chromeless = chromelessGuestHarness(true)
    expect(chromeless.press(keyDown('p', 'KeyP'))).not.toHaveBeenCalled()
    expect(chromeless.send).not.toHaveBeenCalled()
    const ordinary = chromelessGuestHarness(false)
    expect(ordinary.press(keyDown('p', 'KeyP'))).toHaveBeenCalled()
    expect(ordinary.send).toHaveBeenCalledWith('ui:openQuickOpen')
  })

  it('still forwards the tab close shortcut for ordinary browser guests', () => {
    const { send, press } = chromelessGuestHarness(false)
    const consumed = press(keyDown('w', 'KeyW'))
    expect(send).toHaveBeenCalledWith('ui:closeActiveTab', { sourceId: 'browser-tab:9' })
    expect(consumed).toHaveBeenCalled()
  })
})
