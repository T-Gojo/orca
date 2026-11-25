import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../../api-types'

export const accountUsageApi = {
  getSnapshot: (args) => ipcRenderer.invoke('accountUsage:getSnapshot', args),
  refresh: (args) => ipcRenderer.invoke('accountUsage:refresh', args),
  // Fork: usage windows ledger (FORK.md §12).
  getWindowsSnapshot: (args) => ipcRenderer.invoke('accountUsage:getWindowsSnapshot', args),
  refreshWindows: (args) => ipcRenderer.invoke('accountUsage:refreshWindows', args),
  removeEntry: (args) => ipcRenderer.invoke('accountUsage:removeEntry', args)
} satisfies PreloadApi['accountUsage']
