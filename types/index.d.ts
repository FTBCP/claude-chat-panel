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
  // Context window fill, 0 to 100, from the chat's last reply.
  context?: number
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

// What's picked up to move: a project's heading, or one chat within its project.
export type Moving = { kind: 'group' | 'chat'; id: string; project: string; name: string } | null

// One plan limit as the last reply reported it: '5-hour' or 'Week', percent used, reset time.
export type Limit = { label: string; percent: number; resetsAt: string }

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
      groupOrder: string[]
      chatOrder: Record<string, string[]>
      moving: Moving
      limits: Limit[]
    }
  }
}
