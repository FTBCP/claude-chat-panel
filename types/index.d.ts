export type BoardStatus = 'working' | 'needs-you' | 'done' | 'clear'

// One chat's latest status, written by that chat at the start and end of each turn.
export type BoardRow = {
  id: string
  hostId: string
  title: string
  project: string
  status: BoardStatus
  summary: string
  action: string
  updatedAt: number
  isHidden?: boolean
  folder?: string
}

// One chat from the desktop app's own records.
export type IndexEntry = {
  id: string
  cli: string
  folder: string
  title: string
  last: number
  archived: boolean
  routine: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'chat-panel': {
      rows: BoardRow[]
      index: IndexEntry[]
      search: string
      older: Record<string, number>
      pins: string[]
      collapsed: string[]
      renaming: string
    }
  }
}
