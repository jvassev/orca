import React from 'react'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { OpenInApplicationIcon } from '@/lib/files/os-open/open-in-app-catalog'
import {
  getLocalPathOpenOwnerHostId,
  isLocalPathOpenBlocked
} from '@/lib/files/os-open/local-path-open-guard'
import { useAppStore } from '@/store'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { getWorkspaceFileRevealOwner } from '@/lib/files/os-open/reveal-in-file-manager'
import { useActiveWorktree } from '@/store/workspaces/selection/use-selected-worktree'
import { useRepoById } from '@/store/repos/use-repository-catalog'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { RIGHT_SIDEBAR_HEADER_NO_DRAG_CLASS_NAME } from '../layout/right-sidebar-titlebar-drag-regions'

// Prevents a double-click from racing past the existing-tab check before the first click creates one.
const openInFlightByWorkspace = new Set<string>()

export function EmbeddedVsCodeActionButton({
  layout
}: {
  layout: 'top' | 'side'
}): React.JSX.Element | null {
  const t = useTranslate()
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const runtimeEnvironmentId = useAppStore((s) =>
    runtimeEnvironmentIdOrLocalUnlessTwin(s, activeWorktreeId)
  )
  const openInOwner = useAppStore((s) =>
    getWorkspaceFileRevealOwner(s, activeWorktreeId, {
      connectionId: activeRepo?.connectionId,
      runtimeEnvironmentId
    })
  )
  const ownerHostId = getLocalPathOpenOwnerHostId(openInOwner)
  const worktreePath = activeWorktree?.path ?? null
  if (!activeWorktreeId || !worktreePath || isLocalPathOpenBlocked(ownerHostId)) {
    return null
  }
  const isTop = layout === 'top'
  const label = t(
    'auto.components.right.sidebar.activity.bar.embeddedVsCode.open',
    'Embedded VS Code'
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative flex shrink-0 items-center justify-center text-muted-foreground/60 transition-colors hover:text-muted-foreground',
            RIGHT_SIDEBAR_HEADER_NO_DRAG_CLASS_NAME,
            isTop ? 'h-[36px] w-9' : 'w-10 h-10'
          )}
          aria-label={label}
          onClick={async () => {
            if (ownerHostId === 'unresolved' || !activeWorktreeId) {
              return
            }
            const state = useAppStore.getState()
            const existingTab = (state.browserTabsByWorktree[activeWorktreeId] ?? []).find(
              (tab) => tab.chromeless
            )
            if (existingTab) {
              const unifiedTab = (state.unifiedTabsByWorktree[activeWorktreeId] ?? []).find(
                (tab) => tab.contentType === 'browser' && tab.entityId === existingTab.id
              )
              if (unifiedTab) {
                state.activateTab(unifiedTab.id, { worktreeId: activeWorktreeId })
                state.focusGroup(activeWorktreeId, unifiedTab.groupId)
              }
              state.setActiveBrowserTab(existingTab.id, activeWorktreeId)
              return
            }
            if (openInFlightByWorkspace.has(activeWorktreeId)) {
              return
            }
            openInFlightByWorkspace.add(activeWorktreeId)
            try {
              const result = await window.api.shell.openEmbeddedVsCode(worktreePath, ownerHostId)
              if (result.ok) {
                const latest = useAppStore.getState()
                // Recheck: another click or a layout restore may have added the tab while awaiting.
                const racedTab = (latest.browserTabsByWorktree[activeWorktreeId] ?? []).find(
                  (tab) => tab.chromeless
                )
                if (racedTab) {
                  const unifiedTab = (latest.unifiedTabsByWorktree[activeWorktreeId] ?? []).find(
                    (tab) => tab.contentType === 'browser' && tab.entityId === racedTab.id
                  )
                  if (unifiedTab) {
                    latest.activateTab(unifiedTab.id, { worktreeId: activeWorktreeId })
                    latest.focusGroup(activeWorktreeId, unifiedTab.groupId)
                  }
                  latest.setActiveBrowserTab(racedTab.id, activeWorktreeId)
                  return
                }
                latest.createBrowserTab(activeWorktreeId, result.url, {
                  title: t(
                    'auto.components.right.sidebar.activity.bar.embeddedVsCode.tab',
                    'VS Code'
                  ),
                  activate: true,
                  chromeless: true
                })
              } else {
                toast.error(
                  t(
                    'auto.components.right.sidebar.activity.bar.embeddedVsCode.openFailed',
                    'Could not open embedded VS Code: {{reason}}',
                    { reason: result.reason }
                  )
                )
              }
            } finally {
              openInFlightByWorkspace.delete(activeWorktreeId)
            }
          }}
        >
          <OpenInApplicationIcon application={{ command: 'code' }} size={isTop ? 14 : 16} />
        </button>
      </TooltipTrigger>
      <TooltipContent side={isTop ? 'bottom' : 'left'} sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
