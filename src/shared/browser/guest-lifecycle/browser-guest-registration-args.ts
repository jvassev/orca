/** What a renderer sends main to register, or repair, a page's guest webview. */
export type BrowserGuestRegistrationArgs = {
  browserPageId: string
  workspaceId: string
  worktreeId: string
  sessionProfileId?: string | null
  webContentsId: number
  /** No browser chrome (embedded VS Code): the guest keeps every key. */
  chromeless?: boolean
}
