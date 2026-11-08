import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const accountUsageApi = {
  getSnapshot: (args) => ipcRenderer.invoke('accountUsage:getSnapshot', args),
  refresh: (args) => ipcRenderer.invoke('accountUsage:refresh', args)
} satisfies PreloadApi['accountUsage']
