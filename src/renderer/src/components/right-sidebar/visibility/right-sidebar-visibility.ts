import type { AppState } from '@/store/types'
import { getIndexedRepoMap } from '@/store/repos/repository-catalog-index'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { isFolderRepo } from '../../../../../shared/repository/repo-kind'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'

type ActiveView = AppState['activeView']

const RIGHT_SIDEBAR_SUPPRESSED_VIEWS = new Set<ActiveView>([
  'settings',
  'tasks',
  'activity',
  'automations',
  'space',
  'skills',
  'artifacts',
  'mobile'
])

export function canShowRightSidebarForView(activeView: ActiveView): boolean {
  return !RIGHT_SIDEBAR_SUPPRESSED_VIEWS.has(activeView)
}

// Chromeless browser tabs (embedded VS Code) bring their own side panels, so the right sidebar steps aside.
export function selectChromelessBrowserTabActive(
  state: Pick<AppState, 'activeTabType' | 'activeBrowserTabId' | 'browserTabsByWorktree'>
): boolean {
  const { activeTabType, activeBrowserTabId } = state
  if (activeTabType !== 'browser' || !activeBrowserTabId) {
    return false
  }
  return Object.values(state.browserTabsByWorktree).some((tabs) =>
    tabs.some((tab) => tab.id === activeBrowserTabId && tab.chromeless)
  )
}

/** Whether the right sidebar actually occupies layout, as opposed to the persisted preference. */
export function selectRightSidebarShown(
  state: Pick<
    AppState,
    'rightSidebarOpen' | 'activeTabType' | 'activeBrowserTabId' | 'browserTabsByWorktree'
  >
): boolean {
  return state.rightSidebarOpen && !selectChromelessBrowserTabActive(state)
}

/** Workspace and creation surfaces have no titlebar strip, so the closed sidebar needs its own toggle there. */
export function showsFloatingRightSidebarToggle(layout: {
  activeView: ActiveView
  workspaceChromeActive: boolean
  creationLayoutActive: boolean
  rightSidebarOpen: boolean
  chromelessTabActive: boolean
}): boolean {
  return (
    (layout.workspaceChromeActive || layout.creationLayoutActive) &&
    !layout.rightSidebarOpen &&
    !layout.chromelessTabActive &&
    canShowRightSidebarForView(layout.activeView)
  )
}

export function rightSidebarShowsPullRequestData(
  state: Pick<
    AppState,
    | 'activeView'
    | 'activeWorktreeId'
    | 'repos'
    | 'rightSidebarOpen'
    | 'rightSidebarTab'
    | 'worktreesByRepo'
  >
): boolean {
  if (
    !canShowRightSidebarForView(state.activeView) ||
    !state.rightSidebarOpen ||
    (state.rightSidebarTab !== 'checks' && state.rightSidebarTab !== 'source-control')
  ) {
    return false
  }

  const activeWorktree = state.activeWorktreeId
    ? getIndexedWorktreeMap(selectWorktreesByRepo(state)).get(state.activeWorktreeId)
    : undefined
  const activeRepo = activeWorktree
    ? getIndexedRepoMap(state.repos).get(activeWorktree.repoId)
    : null
  if (!activeRepo || isFolderRepo(activeRepo)) {
    return false
  }

  return true
}
