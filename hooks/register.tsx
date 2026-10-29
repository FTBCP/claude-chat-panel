import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BoardRow, BoardStatus, IndexEntry, Limit, Moving } from '../types'

const PANE = 'chat-panel'
const WRAP_UP = 'mcp__ccd_turn__wrap_up'
const RENAME_TOOL = 'mcp__ccd_session_mgmt__set_session_title'
const REFRESH_MS = 5000
const INDEX_MS = 60 * 1000
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const PROJECT_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_PER_PROJECT = 5
const OLDER_STEP = 20
const MAX_RESULTS = 30
const MAX_RECORD_BYTES = 4 * 1024 * 1024

const rows = atom({ plugin: 'chat-panel', key: 'rows' } as const, [])
const index = atom({ plugin: 'chat-panel', key: 'index' } as const, [])
const search = atom({ plugin: 'chat-panel', key: 'search' } as const, '')
const older = atom({ plugin: 'chat-panel', key: 'older' } as const, {})
const pins = atom({ plugin: 'chat-panel', key: 'pins' } as const, [])
const collapsed = atom({ plugin: 'chat-panel', key: 'collapsed' } as const, [])
// The app id of the chat whose card shows the rename box, or '' for none.
const renaming = atom({ plugin: 'chat-panel', key: 'renaming' } as const, '')
// The order you put projects and chats in, shared through the plugin's store like pins.
const groupOrder = atom({ plugin: 'chat-panel', key: 'groupOrder' } as const, [])
const chatOrder = atom({ plugin: 'chat-panel', key: 'chatOrder' } as const, {})
// What this panel has picked up to move, if anything.
const moving = atom({ plugin: 'chat-panel', key: 'moving' } as const, null as Moving)
// The plan's 5-hour and weekly limits from the latest reply in any chat.
const limits = atom({ plugin: 'chat-panel', key: 'limits' } as const, [])

// The projects and each project's cards as last drawn, so a click can put a moved one in place.
let shownGroups: string[] = []
let shownChats: Record<string, string[]> = {}

// Where things live on this computer, found once at session start (see findPlaces).
type Places = {
  isWindows: boolean
  boardDir: string
  projectsDir: string
  indexPath: string
  recordRoots: string[]
}

let places: Places | undefined
// The recap and question from this turn's wrap-up box, when Claude wrote one.
let wrapUp: { recap: string; ask: string } | undefined
let hostId = ''
let activeTurn = ''

// Project order and colors from the plugin's setting: "name:#hex, name:#hex".
let projectOrder: [string, string][] = []
let recordsSetting = ''

// Commands run through PowerShell on Windows and sh everywhere else.
const quote = (text: string): string =>
  places?.isWindows ? `'${text.replace(/'/g, "''")}'` : `'${text.replace(/'/g, `'\\''`)}'`

const shell = async ($: any, script: string, isWindows = places?.isWindows ?? false): Promise<string> => {
  const argv = isWindows
    ? ['powershell', '-NoProfile', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`]
    : ['/bin/sh', '-c', script]
  const ran = await $.process.run(argv, { timeoutMs: 10000 })

  return ran.stdout.trim()
}

const readEnv = async ($: any, name: string, isWindows: boolean): Promise<string> => {
  try {
    return await shell($, isWindows ? `$env:${name}` : `printf %s "$${name}"`, isWindows)
  } catch {
    return ''
  }
}

const exists = async ($: any, path: string): Promise<boolean> => {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}

const subfolders = async ($: any, path: string): Promise<string[]> => {
  try {
    return (await $.fs.list(path)).filter((entry: any) => entry.kind === 'dir').map((entry: any) => entry.name)
  } catch {
    return []
  }
}

// The desktop app keeps a small record per chat in a claude-code-sessions folder.
// Its place differs by system and install, so every known spot is checked.
const findRecordRoots = async ($: any, isWindows: boolean, home: string): Promise<string[]> => {
  if (recordsSetting) return [recordsSetting]
  const bases = isWindows
    ? [await readEnv($, 'LOCALAPPDATA', true), await readEnv($, 'APPDATA', true)]
    : [`${home}/Library/Application Support`, `${home}/.config`]
  const found: string[] = []
  for (const base of bases.filter(Boolean)) {
    for (const app of ['Claude', 'Claude-Data']) {
      const direct = `${base}/${app}/claude-code-sessions`
      if (await exists($, direct)) found.push(direct)
      for (const inner of await subfolders($, `${base}/${app}`)) {
        const nested = `${base}/${app}/${inner}/claude-code-sessions`
        if (await exists($, nested)) found.push(nested)
      }
    }
  }

  return found
}

const findPlaces = async ($: any): Promise<Places> => {
  const cwd = await $.session.cwd()
  const isWindows = /^[A-Za-z]:[\\/]/.test(cwd) || cwd.includes('\\')
  const home = (await readEnv($, isWindows ? 'USERPROFILE' : 'HOME', isWindows)).replace(/\\/g, '/')
  const configDir = (await readEnv($, 'CLAUDE_CONFIG_DIR', isWindows)).replace(/\\/g, '/') || `${home}/.claude`

  return {
    isWindows,
    boardDir: `${configDir}/chat-panel`,
    projectsDir: `${configDir}/projects`,
    indexPath: `${configDir}/chat-panel-index.json`,
    recordRoots: await findRecordRoots($, isWindows, home),
  }
}

const ready = async ($: any): Promise<Places> => {
  if (!places) places = await findPlaces($)

  return places
}

// The chat's name lives in its transcript as the newest "custom-title" line.
// The transcript sits under the folder the chat started in, even after it changes folders.
const readTitle = async ($: any, id: string, cwd: string): Promise<string> => {
  const where = await ready($)
  const slug = cwd.replace(/[^A-Za-z0-9]/g, '-')
  const path = `${where.projectsDir}/${slug}/${id}.jsonl`
  const pattern = '"type":"custom-title"'
  try {
    const line = await shell(
      $,
      where.isWindows
        ? `(Select-String -LiteralPath ${quote(path)} -Encoding UTF8 -SimpleMatch -Pattern ${quote(pattern)} | Select-Object -Last 1).Line`
        : `grep -F ${quote(pattern)} ${quote(path)} | tail -n 1`,
    )
    if (line) return JSON.parse(line).customTitle ?? ''
  } catch {}

  return ''
}

// The app opens a chat, or a blank new one, when the system hands it a claude:// link.
// A link naming a folder makes the app ask to trust it every time, so new chats name none.
const openLink = async ($: any, link: string) => {
  const where = await ready($)
  await shell($, where.isWindows ? `Start-Process ${quote(link)}` : `open ${quote(link)}`)
}

const openChat = async ($: any, id: string) => {
  if (/^local_[0-9a-f-]+$/.test(id)) await openLink($, `claude://claude.ai/epitaxy/${id}`)
}

// Renames a chat through the app's own session tool, as Claude does when asked,
// then updates the panel's copy so the new name shows at once.
const renameChat = async ($: any, chatId: string, title: string) => {
  await $.tool.call({ tool: RENAME_TOOL, session_id: chatId, title })
  const all = await read($, rows)
  const row = all.find(one => one.hostId === chatId)
  if (row) await save($, { ...row, title })
  await update($, index, entries => entries.map(entry => (entry.id === chatId ? { ...entry, title } : entry)))
  await refresh($)
}

const plain = (text: string): string =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*([-•]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 3).trim()}...` : text

// Up to three sentences from the start of Claude's reply.
const summaryOf = (answer: string): string => {
  const sentences = plain(answer).match(/[^.!?]+[.!?]+/g) ?? [plain(answer)]

  return clip(sentences.slice(0, 3).join(' ').trim(), 280)
}

// A few words on the latest point, like "Fixed clicking chat name inside panel".
const SHORT_RULES =
  'Write a status label of 3 to 8 words for the most recent thing done or decided in this chat update. ' +
  'Start with a past-tense verb when something was done. No period, no quotes, no emoji. Reply with the label only.'

const ACTION_RULES =
  'Write the step this person has to take, in 3 to 8 words, starting with a verb, ' +
  'from the question or to-do below. No period, no quotes, no emoji. Reply with the step only.'

const WORKING_RULES =
  'Write what an assistant is now working on, in 3 to 8 words, from the request below. ' +
  'Start with a verb. No period, no quotes, no emoji. Reply with the words only.'

const shortLabel = async ($: any, rules: string, source: string): Promise<string> => {
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      system: rules,
      prompt: source,
      maxTokens: 40,
      effort: 'low',
    })
    if (reply.isAnswered) return clip(plain(reply.text).replace(/^["']|["'.]$/g, ''), 60)
  } catch {}

  return ''
}

const shortSummaryOf = async ($: any, recap: string, answer: string): Promise<string> => {
  const source = clip(plain(recap) || plain(answer), 1500)
  if (!source) return ''
  const label = await shortLabel($, SHORT_RULES, source)

  return label || clip(summaryOf(source).split(/(?<=[.!?])\s/)[0] ?? '', 70)
}

// Lines under a "You need to:" heading, for replies that list to-dos that way.
const actionOf = (answer: string): string => {
  const found = answer.match(/You need to:?([\s\S]*?)(\n\s*\n(?![-•\d])|$)/i)
  if (!found) return ''

  return clip(plain(found[1]), 200)
}

// A worktree chat belongs to the project it was cut from.
const folderOf = (cwd: string): string => cwd.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, '')

const projectOf = (cwd: string): string =>
  folderOf(cwd).split(/[\\/]/).filter(Boolean).at(-1) ?? cwd

const save = async ($: any, row: BoardRow) => {
  const where = await ready($)
  await $.fs.write(`${where.boardDir}/${row.id}.json`, JSON.stringify(row))
}

const readRow = async ($: any, id: string): Promise<BoardRow | undefined> => {
  if (!/^[0-9a-f-]+$/.test(id)) return undefined
  const where = await ready($)
  try {
    return JSON.parse(await $.fs.read(`${where.boardDir}/${id}.json`))
  } catch {
    return undefined
  }
}

const loadAll = async ($: any): Promise<BoardRow[]> => {
  const where = await ready($)
  if (!(await exists($, where.boardDir))) return []
  const now = await $.clock.now()
  const found: BoardRow[] = []
  for (const entry of await $.fs.list(where.boardDir)) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    if (now - entry.mtimeMs > MAX_AGE_MS) continue
    try {
      found.push(JSON.parse(await $.fs.read(`${where.boardDir}/${entry.name}`)))
    } catch {}
  }

  // Chats closed with the card's X stay off until you type in them again.
  return found
    .filter(row => row.hostId && !row.isHidden && now - row.updatedAt <= MAX_AGE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// The index of every chat, read from the app's records. Only records changed since
// the last pass are read again; the result is kept in a file every chat's panel shares.
type IndexedFile = IndexEntry & { file: string; stamp: number }

let isIndexing = false
let indexStamp = 0

const fieldOf = (text: string, name: string): unknown => {
  const found = new RegExp(`"${name}":("(?:[^"\\\\]|\\\\.)*"|true|false|null|-?\\d+)`).exec(text)
  if (!found) return undefined
  try {
    return JSON.parse(found[1])
  } catch {
    return undefined
  }
}

const recordFiles = async ($: any, dir: string, depth: number): Promise<{ path: string; stamp: number; size: number }[]> => {
  const found: { path: string; stamp: number; size: number }[] = []
  let entries: any[] = []
  try {
    entries = await $.fs.list(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'dir' && depth > 0) found.push(...(await recordFiles($, path, depth - 1)))
    else if (entry.kind === 'file' && /^local_.*\.json$/.test(entry.name)) {
      found.push({ path, stamp: entry.mtimeMs, size: entry.size })
    }
  }

  return found
}

const rebuildIndex = async ($: any) => {
  if (isIndexing) return
  isIndexing = true
  try {
    const where = await ready($)
    const known = new Map<string, IndexedFile>()
    try {
      for (const one of JSON.parse(await $.fs.read(where.indexPath)) as IndexedFile[]) known.set(one.file, one)
    } catch {}
    const next: IndexedFile[] = []
    for (const root of where.recordRoots) {
      for (const file of await recordFiles($, root, 3)) {
        const cached = known.get(file.path)
        if (cached && cached.stamp === file.stamp) {
          next.push(cached)
          continue
        }
        if (file.size > MAX_RECORD_BYTES) continue
        try {
          const text = await $.fs.read(file.path)
          next.push({
            file: file.path,
            stamp: file.stamp,
            id: String(fieldOf(text, 'sessionId') ?? ''),
            cli: String(fieldOf(text, 'cliSessionId') ?? ''),
            folder: String(fieldOf(text, 'originCwd') ?? fieldOf(text, 'cwd') ?? ''),
            title: String(fieldOf(text, 'title') ?? ''),
            last: Number(fieldOf(text, 'lastActivityAt') ?? 0),
            archived: fieldOf(text, 'isArchived') === true,
            routine: Boolean(fieldOf(text, 'scheduledTaskId')),
          })
        } catch {}
      }
    }
    // A pass that found no records leaves the last good index in place.
    if (next.length > 0) await $.fs.write(where.indexPath, JSON.stringify(next))
  } catch {
  } finally {
    isIndexing = false
  }
}

const loadIndex = async ($: any) => {
  const where = await ready($)
  try {
    const stat = await $.fs.stat(where.indexPath)
    if (stat.mtimeMs === indexStamp) return
    const entries: IndexEntry[] = JSON.parse(await $.fs.read(where.indexPath))
    indexStamp = stat.mtimeMs
    await update($, index, () => entries.filter(entry => entry.id))
  } catch {}
}

// Pins, collapsed projects, your order and the plan limits live in the plugin's store,
// so every chat's panel shares them.
const loadChoices = async ($: any) => {
  const pinned = ((await $.store.get('pins')) as string[] | undefined) ?? []
  const shut = ((await $.store.get('collapsed')) as string[] | undefined) ?? []
  const groups = ((await $.store.get('groupOrder')) as string[] | undefined) ?? []
  const chats = ((await $.store.get('chatOrder')) as Record<string, string[]> | undefined) ?? {}
  const latest = ((await $.store.get('limits')) as Limit[] | undefined) ?? []
  await update($, pins, () => pinned)
  await update($, collapsed, () => shut)
  await update($, groupOrder, () => groups)
  await update($, chatOrder, () => chats)
  await update($, limits, () => latest)
}

// `list` with `id` moved into the place `target` holds.
const movedInto = (list: string[], id: string, target: string): string[] => {
  const at = list.indexOf(target)
  if (at < 0 || id === target) return list
  const rest = list.filter(one => one !== id)
  rest.splice(at, 0, id)
  return rest
}

// Unplaced items first, in the order given, then the placed ones in your order.
const inYourOrder = <T,>(items: T[], idOf: (item: T) => string, placed: string[]): T[] => {
  const byId = new Map(items.map(item => [idOf(item), item]))
  const known = new Set(placed)
  return [
    ...items.filter(item => !known.has(idOf(item))),
    ...placed.map(id => byId.get(id)).filter((item): item is T => item !== undefined),
  ]
}

const placeGroup = async ($: any, project: string, target: string) => {
  await $.store.set('groupOrder', movedInto(shownGroups, project, target))
  await update($, moving, () => null)
  await loadChoices($)
}

const placeChat = async ($: any, project: string, chatId: string, target: string) => {
  const all = ((await $.store.get('chatOrder')) as Record<string, string[]> | undefined) ?? {}
  const shown = movedInto(shownChats[project] ?? [], chatId, target)
  // Chats placed before but not on the panel now keep their order after the shown ones.
  const kept = (all[project] ?? []).filter(id => !shown.includes(id))
  await $.store.set('chatOrder', { ...all, [project]: [...shown, ...kept] })
  await update($, moving, () => null)
  await loadChoices($)
}

// The plan's limits as the app reports them after each reply, kept when they change.
const LIMIT_LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Week' }

const saveLimits = async ($: any, reported: { kind: string; percentUsed: number; resetsAt?: string }[]) => {
  const next: Limit[] = reported
    .filter(one => LIMIT_LABELS[one.kind])
    .map(one => ({ label: LIMIT_LABELS[one.kind], percent: Math.round(one.percentUsed), resetsAt: one.resetsAt ?? '' }))
  if (next.length === 0) return
  const was = (await $.store.get('limits')) as Limit[] | undefined
  if (JSON.stringify(was) === JSON.stringify(next)) return
  await $.store.set('limits', next)
  await update($, limits, () => next)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// "2:10pm" for the 5-hour limit, "Mon 2:10pm" for the week.
const resetOf = (iso: string, withDay: boolean): string => {
  const at = new Date(iso)
  if (!iso || Number.isNaN(at.getTime())) return ''
  const hour = at.getHours() % 12 || 12
  const time = `${hour}:${String(at.getMinutes()).padStart(2, '0')}${at.getHours() < 12 ? 'am' : 'pm'}`

  return withDay ? `${DAYS[at.getDay()]} ${time}` : time
}

const toggleChoice = async ($: any, key: 'pins' | 'collapsed', value: string) => {
  const list = ((await $.store.get(key)) as string[] | undefined) ?? []
  const next = list.includes(value) ? list.filter(one => one !== value) : [...list, value]
  await $.store.set(key, next)
  await loadChoices($)
}

const refresh = async ($: any) => {
  const found = await loadAll($)
  await update($, rows, () => found)
  await loadIndex($)
  await loadChoices($)
}

// Projects named in the setting come first, in that order, with those colors.
// Any other project follows, newest first, and its name picks one of these colors.
const SPARE_COLORS = ['#378ADD', '#7F77DD', '#BA7517', '#1D9E75', '#D4537E', '#D85A30', '#639922']

const parseOrder = (setting: string): [string, string][] =>
  setting
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [name, color] = part.split(':').map(piece => piece.trim())
      return [name, /^#[0-9a-fA-F]{6}$/.test(color ?? '') ? color : ''] as [string, string]
    })

const colorOf = (project: string): string => {
  const fixed = projectOrder.find(([name]) => name === project)
  if (fixed?.[1]) return fixed[1]
  let hash = 0
  for (const char of project) hash = (hash * 31 + char.charCodeAt(0)) >>> 0

  return SPARE_COLORS[hash % SPARE_COLORS.length]
}

const rankOf = (project: string): number => {
  const at = projectOrder.findIndex(([name]) => name === project)

  return at < 0 ? projectOrder.length : at
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const dateOf = (at: number): string => {
  const day = new Date(at)

  return `${MONTHS[day.getMonth()]} ${day.getDate()}`
}

// How full this chat's context window is, 0 to 100, or undefined before its first reply.
const contextOf = async ($: any): Promise<number | undefined> => {
  try {
    return (await $.session.usage()).context.percent
  } catch {
    return undefined
  }
}

// Opens the panel at the width last seen in any chat, since the app starts each chat's panel at its default.
// shortcut: the app may ignore the requested width; if so, this does nothing.
const openPane = async ($: any) => {
  const width = (await $.store.get('width')) as number | undefined
  return $.ui.open({ id: PANE, title: 'Your chats', ...(width ? { columns: width } : {}) })
}

const isRoutine = async ($: any, chatId: string): Promise<boolean> =>
  (await read($, index)).some(entry => entry.id === chatId && entry.routine)

export const register: Register = (on, options) => {
  projectOrder = parseOrder(String(options.projectOrder ?? ''))
  recordsSetting = String(options.recordsFolder ?? '').replace(/\\/g, '/')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chats',
      description: 'Show the chat panel',
    })
    await ready($)
    hostId = await readEnv($, 'CLAUDE_CODE_HOST_SESSION_ID', places?.isWindows ?? false)
    // Nothing runs yet when a chat opens, so a "Working on" left from before is stale:
    // the app or the panel stopped before that reply finished.
    const own = await readRow($, await $.session.id())
    if (own?.status === 'working') await save($, { ...own, status: 'done' })
    try {
      await saveLimits($, (await $.session.usage()).rateLimits ?? [])
    } catch {}
    void openPane($)
    await refresh($)
    $.clock.every(REFRESH_MS, () => refresh($))
    void rebuildIndex($).then(() => refresh($))
    $.clock.every(INDEX_MS, () => rebuildIndex($))

    return next(e)
  })

  on('command.run', { command: 'chats' }, async $ => {
    await openPane($)
    await refresh($)

    return { text: 'Chat panel opened.' }
  })

  on('session.measure', async ($, e, next) => {
    try {
      await saveLimits($, e.rateLimits ?? [])
    } catch {}

    return next(e)
  })

  on('tool.call', { tool: WRAP_UP }, async ($, e, next) => {
    if (!e.agentId) {
      const args = e as unknown as { recap?: string; ask?: string }
      wrapUp = { recap: args.recap ?? '', ask: args.ask ?? '' }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId) return next(e)
    wrapUp = undefined
    activeTurn = e.turnId
    await ready($)
    if (!hostId || (await isRoutine($, hostId))) return next(e)
    const id = await $.session.id()
    const cwd = await $.session.root()
    const title = await readTitle($, id, cwd)
    // A chat closed with the X comes back only once you type in it, not when Claude carries on alone.
    const wasHidden = (await readRow($, id))?.isHidden === true
    const row: BoardRow = {
      id,
      hostId,
      title: title || 'Untitled chat',
      project: projectOf(cwd),
      folder: folderOf(cwd),
      status: 'working',
      summary: '',
      action: '',
      updatedAt: await $.clock.now(),
      isHidden: wasHidden && e.text.trim() === '',
      context: await contextOf($),
    }
    await save($, row)
    await refresh($)

    // Label what Claude is working on without holding up the turn.
    const request = clip(plain(e.text), 1500)
    if (request) {
      void (async () => {
        const label = await shortLabel($, WORKING_RULES, request)
        if (label && activeTurn === e.turnId) {
          await save($, { ...row, summary: label })
          await refresh($)
        }
      })()
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) return done
    activeTurn = ''
    if (!hostId || (await isRoutine($, hostId))) return done
    const id = await $.session.id()
    const cwd = await $.session.root()
    const title = await readTitle($, id, cwd)
    // A chat needs you when its reply ends with a question in the next-step box,
    // or lists something under "You need to:".
    const actionSource = plain(wrapUp?.ask ?? '') || actionOf(e.answer)
    const status: BoardStatus = actionSource ? 'needs-you' : 'done'
    const action = actionSource
      ? (await shortLabel($, ACTION_RULES, actionSource)) || clip(actionSource, 60)
      : ''
    await save($, {
      id,
      hostId,
      title: title || 'Untitled chat',
      project: projectOf(cwd),
      folder: folderOf(cwd),
      status,
      summary: await shortSummaryOf($, wrapUp?.recap ?? '', e.answer),
      action,
      updatedAt: await $.clock.now(),
      isHidden: (await readRow($, id))?.isHidden === true,
      context: await contextOf($),
    })
    await refresh($)

    return done
  })

  on('ui.message', async ($, e, next) => {
    const data = e.data as {
      open?: string
      hide?: string
      pin?: string
      toggle?: string
      rename?: string
      width?: number
      move?: string
      place?: string
      moveGroup?: string
      placeGroup?: string
      cancelMove?: boolean
    } | null
    if (typeof data?.width === 'number' && data.width > 0) await $.store.set('width', Math.round(data.width))
    if (data?.cancelMove) await update($, moving, () => null)
    if (data?.moveGroup) {
      const project = data.moveGroup
      await update($, moving, () => ({ kind: 'group', id: project, project, name: project }))
    }
    if (data?.move) {
      const chatId = data.move
      const row = (await read($, rows)).find(one => one.hostId === chatId)
      const title = (await read($, index)).find(entry => entry.id === chatId)?.title || row?.title || 'this chat'
      if (row) await update($, moving, () => ({ kind: 'chat', id: chatId, project: row.project, name: title }))
    }
    const held = await read($, moving)
    if (data?.placeGroup && held?.kind === 'group') await placeGroup($, held.id, data.placeGroup)
    if (data?.place && held?.kind === 'chat') await placeChat($, held.project, held.id, data.place)
    if (data?.rename) await update($, renaming, () => data.rename ?? '')
    if (data?.open) await openChat($, data.open)
    if (data?.pin) await toggleChoice($, 'pins', data.pin)
    if (data?.toggle) await toggleChoice($, 'collapsed', data.toggle)
    if (data?.hide) {
      const row = await readRow($, data.hide)
      if (row) await save($, { ...row, isHidden: true })
      await refresh($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Client, Button, Input } = $.ui.resolve(e)
    const recent = await read($, rows)
    const all = await read($, index)
    const query = (await read($, search)).trim().toLowerCase()
    const shown = await read($, older)
    const pinned = await read($, pins)
    const shut = await read($, collapsed)
    const renamingId = await read($, renaming)
    const savedGroups = await read($, groupOrder)
    const savedChats = await read($, chatOrder)
    const held = await read($, moving)
    const planLimits = await read($, limits)
    const now = Date.now()

    const byHost = new Map(all.map(entry => [entry.id, entry]))
    const live = all.filter(entry => !entry.archived && !entry.routine)
    const fresh = recent.filter(row => {
      const entry = byHost.get(row.hostId)
      return !entry?.archived && !entry?.routine
    })
    const isPinned = new Set(pinned)
    const nameOf = (row: BoardRow) => byHost.get(row.hostId)?.title || row.title

    // While a chat is being renamed, its card becomes a text box holding the name.
    // Enter saves; an empty or unchanged name cancels.
    const renameBox = (row: BoardRow) => (
      <Input
        key={`rename-${row.hostId}`}
        label="Rename"
        value={nameOf(row)}
        submitLabel="save"
        autoFocus
        onSubmit={text => {
          const title = text.trim()
          void (async () => {
            await update($, renaming, () => '')
            if (title && title !== nameOf(row)) await renameChat($, row.hostId, title)
          })()
        }}
      />
    )

    // How a card takes part in a move: the one picked up, a place it can go, or neither.
    const movingOf = (row: BoardRow, canMove: boolean): '' | 'self' | 'target' | 'other' => {
      if (!held) return ''
      if (held.kind === 'chat' && held.id === row.hostId) return 'self'
      if (held.kind === 'chat' && held.project === row.project && canMove) return 'target'
      return 'other'
    }

    const card = (row: BoardRow, canMove = false) =>
      row.hostId === renamingId ? (
        renameBox(row)
      ) : (
        // Each card draws itself (chat-block.tsx) and posts what was clicked.
        <Client
          key={`chat-${row.hostId}`}
          module="./chat-block.tsx"
          props={{
            id: row.id,
            hostId: row.hostId,
            color: colorOf(row.project),
            // The app's own record holds the latest name, renames from the panel included.
            title: nameOf(row),
            now: row.summary ?? '',
            isWorking: row.status === 'working',
            action: row.action ?? '',
            isPinned: isPinned.has(row.hostId),
            context: row.context ?? -1,
            canMove,
            moving: movingOf(row, canMove),
          }}
        />
      )

    const oldRow = (entry: IndexEntry) => (
      <Client
        key={`old-${entry.id}`}
        module="./old-chat-row.tsx"
        props={{
          hostId: entry.id,
          color: colorOf(projectOf(entry.folder ?? '')),
          title: entry.title || 'Untitled chat',
          date: dateOf(entry.last),
        }}
      />
    )

    const searchBox = (
      // "New" sits first and never shrinks, so the search box can't push it off the line.
      <Box flexDirection="row" gap={1} alignItems="center">
        <Box flexShrink={0}>
          <Button
            key="new-chat"
            variant="primary"
            label="New"
            onPress={() => void openLink($, 'claude://code/new')}
          />
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Input
            key="search"
            placeholder="Search chats"
            value={query === '' ? '' : undefined}
            submitLabel="search"
            onInput={text => void update($, search, () => text)}
            onSubmit={text => void update($, search, () => text)}
          />
        </Box>
      </Box>
    )

    // While searching, the panel lists matching chats from every project.
    if (query) {
      const matches = live
        .filter(entry => (entry.title ?? '').toLowerCase().includes(query))
        .sort((a, b) => b.last - a.last)
        .slice(0, MAX_RESULTS)

      return (
        <Box flexDirection="column" gap={1}>
          {searchBox}
          {matches.length === 0 && <Text dimColor>No chats match.</Text>}
          {matches.map(oldRow)}
        </Box>
      )
    }

    // Pinned chats show as cards, with their latest status when the panel has one.
    const pinnedCards = pinned
      .map(id => {
        const row = recent.find(one => one.hostId === id)
        if (row) return row
        const entry = byHost.get(id)
        if (!entry || entry.archived) return undefined
        const pinnedRow: BoardRow = {
          id: entry.cli ?? '',
          hostId: entry.id,
          title: entry.title || 'Untitled chat',
          project: projectOf(entry.folder ?? ''),
          status: 'done',
          summary: '',
          action: '',
          updatedAt: entry.last,
        }
        return pinnedRow
      })
      .filter((row): row is BoardRow => row !== undefined)

    // Projects with a chat in the last 30 days, the ones named in the setting first.
    // Once you've moved one, your order wins, with projects you haven't placed yet on top.
    const projects = new Map<string, number>()
    for (const entry of live) {
      if (now - entry.last > PROJECT_AGE_MS || !entry.folder) continue
      const project = projectOf(entry.folder)
      projects.set(project, Math.max(projects.get(project) ?? 0, entry.last))
    }
    for (const row of fresh) projects.set(row.project, Math.max(projects.get(row.project) ?? 0, row.updatedAt))
    const order = inYourOrder(
      [...projects.entries()].sort((a, b) => rankOf(a[0]) - rankOf(b[0]) || b[1] - a[1]),
      ([project]) => project,
      savedGroups,
    )
    shownGroups = order.map(([project]) => project)
    shownChats = {}

    // The plan's limits, red from 80% like the context meter.
    const limitLines = planLimits.map(limit => {
      const reset = resetOf(limit.resetsAt, limit.label === 'Week')
      return (
        <Text size="footnote" dimColor={limit.percent < 80} color={limit.percent >= 80 ? '#A32D2D' : undefined}>
          {limit.label}: {limit.percent}% used{reset ? `, resets ${reset}` : ''}
        </Text>
      )
    })

    // While something is picked up, one line says what and offers a way out.
    const movingLine = held && (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text weight="semibold" color={colorOf(held.project)}>
            {held.kind === 'group'
              ? `Moving ${held.name}. Click the project it should take the place of.`
              : `Moving ${held.name}. Click the chat in ${held.project} it should take the place of.`}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Button key="cancel-move" label="Cancel" onPress={() => void update($, moving, () => null)} />
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={3}>
        {searchBox}
        {movingLine}
        {pinnedCards.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text weight="semibold" size="footnote" dimColor>
              Pinned
            </Text>
            {pinnedCards.map(row => card(row))}
          </Box>
        )}
        {order.length === 0 && <Text dimColor>Your chats show up here after you send a message in one.</Text>}
        {order.map(([project]) => {
          const isShut = shut.includes(project)
          const cards = inYourOrder(
            fresh.filter(row => row.project === project && !isPinned.has(row.hostId)),
            row => row.hostId,
            savedChats[project] ?? [],
          ).slice(0, MAX_PER_PROJECT)
          shownChats[project] = cards.map(row => row.hostId)
          const onCards = new Set(cards.map(row => row.hostId))
          const headMoving = held?.kind === 'group' ? (held.id === project ? 'self' : 'target') : ''
          const rest = live
            .filter(
              entry =>
                projectOf(entry.folder ?? '') === project && !isPinned.has(entry.id) && !onCards.has(entry.id),
            )
            .sort((a, b) => b.last - a.last)
          const count = shown[project] ?? 0
          const next = Math.min(OLDER_STEP, rest.length - count)

          return (
            <Box flexDirection="column" gap={1}>
              <Client
                key={`head-${project}`}
                module="./group-header.tsx"
                width="100%"
                props={{ project, color: colorOf(project), isCollapsed: isShut, moving: headMoving }}
              />
              {!isShut && cards.map(row => card(row, true))}
              {/* One toggle right under the cards, so Show and Hide sit in the same spot. */}
              {!isShut && rest.length > 0 && (
                <Button
                  key={`older-${project}`}
                  plain
                  dimColor
                  label={count === 0 ? `Show ${rest.length} older chats` : 'Hide older chats'}
                  onPress={() =>
                    void update($, older, all => ({ ...all, [project]: count === 0 ? OLDER_STEP : 0 }))
                  }
                />
              )}
              {!isShut && count > 0 && <Box flexDirection="column">{rest.slice(0, count).map(oldRow)}</Box>}
              {!isShut && count > 0 && next > 0 && (
                <Button
                  key={`more-${project}`}
                  plain
                  dimColor
                  label={`Show ${next} more`}
                  onPress={() => void update($, older, all => ({ ...all, [project]: count + OLDER_STEP }))}
                />
              )}
            </Box>
          )
        })}
        {limitLines.length > 0 && <Box flexDirection="column">{limitLines}</Box>}
      </Box>
    )
  })
}
