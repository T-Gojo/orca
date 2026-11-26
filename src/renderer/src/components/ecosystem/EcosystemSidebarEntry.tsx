import React, { useEffect } from 'react'
import { Radio } from 'lucide-react'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { SIDEBAR_NAV_DIMMED_ICON_CLASS_NAME } from '../sidebar/chrome/sidebar-nav-controls'
import { closeEcosystemPage, openEcosystemPage, useEcosystemPageOpen } from './ecosystem-page-store'

/** Fork: prominent top-left Sidebar button opening the Unified OpenClaw & Hermes workspace (§16). */

export function EcosystemSidebarEntry(): React.JSX.Element {
  const t = useTranslate()
  const isOpen = useEcosystemPageOpen()
  const activeView = useAppStore((s) => s.activeView)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)

  useEffect(() => {
    if (activeView !== 'terminal') {
      closeEcosystemPage()
    }
  }, [activeView])

  useEffect(() => {
    let prevWorktree = activeWorktreeId
    return useAppStore.subscribe((state) => {
      if (state.activeWorktreeId !== prevWorktree) {
        prevWorktree = state.activeWorktreeId
        closeEcosystemPage()
      }
    })
  }, [activeWorktreeId])

  return (
    <button
      type="button"
      onClick={() => {
        if (isOpen) {
          closeEcosystemPage()
        } else {
          if (useAppStore.getState().activeView !== 'terminal') {
            useAppStore.getState().setActiveView('terminal')
          }
          openEcosystemPage()
        }
      }}
      aria-current={isOpen ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        isOpen
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/75 hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <Radio
        className={cn('size-4 shrink-0', !isOpen && SIDEBAR_NAV_DIMMED_ICON_CLASS_NAME)}
        strokeWidth={isOpen ? 2.25 : 1.75}
      />
      <span className="min-w-0 flex-1 truncate">
        {t('ecosystem.sidebar.navLabel', 'OpenClaw & Hermes')}
      </span>
      <span className="shrink-0 rounded-full border border-worktree-sidebar-border/80 bg-worktree-sidebar-foreground/8 px-1.5 py-px text-3xs font-medium text-worktree-sidebar-foreground/70">
        {t('ecosystem.sidebar.hubBadge', 'Hub')}
      </span>
    </button>
  )
}
