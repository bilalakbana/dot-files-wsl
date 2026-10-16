// Pure helpers of the workspace pane (no `$`), so tests can run them directly.
import type { GitFile, UsageLimit, WorkspaceGit } from '../types'

// Catppuccin Macchiato, to match Ghostty, tmux and the prompt
export const COLOR = {
  text: '#cad3f5',
  dim: '#8087a2',
  blue: '#8aadf4',
  green: '#a6da95',
  yellow: '#eed49f',
  red: '#ed8796',
  mauve: '#c6a0f6',
} as const

export const MAX_GIT_FILES = 12

// Bump when WorkspaceSnapshot changes: $.state survives a module reload, so the pane may meet a
// snapshot of the old shape until the first refresh of the new module.
export const SNAPSHOT_SCHEMA = 3

const HEADER = /^## (?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.\S+)?(?: \[([^\]]*)\])?$/

/**
 * Parses `git status --porcelain=v1 --branch -z` (NUL-separated, paths unquoted, relative to the
 * repository root). `top` and `prefix` are `git rev-parse --show-toplevel --show-prefix`: they turn
 * each path into what an @-mention from the session's directory needs.
 */
export function parseGitStatus(stdout: string, top: string, prefix: string): WorkspaceGit {
  const fields = stdout.split('\0')
  const head = HEADER.exec(fields[0] ?? '')
  if (head === null) {
    throw new Error(`unexpected git status header: ${JSON.stringify(fields[0] ?? '')}`)
  }
  const tracking = head[2] ?? ''
  const entries: { code: string; path: string }[] = []
  for (let i = 1; i < fields.length; i++) {
    const field = fields[i] ?? ''
    if (field === '') continue
    const code = field.slice(0, 2)
    entries.push({ code, path: field.slice(3) })
    // a rename or copy is followed by its original path as a field of its own
    if (/[RC]/.test(code)) i++
  }
  const files: GitFile[] = entries.slice(0, MAX_GIT_FILES).map(({ code, path }) => ({
    code,
    path,
    mention: code.includes('D') ? null : gitMention(path, top, prefix),
  }))

  return {
    branch: head[1] ?? '?',
    ahead: Number(/ahead (\d+)/.exec(tracking)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(tracking)?.[1] ?? 0),
    files,
    total: entries.length,
  }
}

/** A repository-root path as seen from the session's directory (`prefix`, e.g. `sub/dir/`). */
export function gitMention(path: string, top: string, prefix: string): string {
  if (prefix === '') return path
  return path.startsWith(prefix) ? path.slice(prefix.length) : `${top}/${path}`
}

/** One rate-limit window as a session's last API response reported it ($.session.usage().rateLimits). */
export type LimitReading = { kind: string; percentUsed: number; resetsAt?: string }

/** The newest reading any session saw, kept in a small file all sessions share. */
export type SharedLimits = { at: number; limits: LimitReading[] }

/** Parses the shared file; null when it holds no valid reading. */
export function parseShared(text: string): SharedLimits | null {
  const data: unknown = JSON.parse(text)
  if (typeof data !== 'object' || data === null) return null
  const { at, limits } = data as Record<string, unknown>
  if (typeof at !== 'number' || !Array.isArray(limits)) return null
  const valid = limits.filter(
    (one): one is LimitReading =>
      typeof one === 'object' && one !== null &&
      typeof (one as LimitReading).kind === 'string' && typeof (one as LimitReading).percentUsed === 'number',
  )
  return { at, limits: valid }
}

/**
 * A session knows the limits only from its own last API response, so an idle session's figures go
 * stale. `ownAt` is when this session's reading last changed (0 = unknown, e.g. after a reload);
 * the shared reading wins when it is newer, or when this session has none.
 */
export function pickLimits(own: LimitReading[], ownAt: number, shared: SharedLimits | null): LimitReading[] {
  if (shared === null) return own
  return own.length === 0 || shared.at > ownAt ? shared.limits : own
}

const ALWAYS_SHOWN = ['five_hour', 'seven_day']

/**
 * The rows the pane draws: 5h and 7d always (a window the response leaves out, or whose reset
 * time has passed, has been reset: 0%), then any other window. With no reading at all, `null`.
 */
export function limitRows(readings: LimitReading[], now: number): UsageLimit[] {
  const kinds = [...ALWAYS_SHOWN, ...readings.map(one => one.kind).filter(kind => !ALWAYS_SHOWN.includes(kind))]
  return kinds.map(kind => {
    const reading = readings.find(one => one.kind === kind)
    if (reading === undefined) {
      return { label: limitLabel(kind), percent: readings.length === 0 ? null : 0, resetsInMs: null }
    }
    // whole minutes: the pane shows minutes, and a figure that changes on every refresh would redraw it
    const resetsInMs =
      reading.resetsAt === undefined ? null : Math.ceil((Date.parse(reading.resetsAt) - now) / 60_000) * 60_000
    if (resetsInMs !== null && resetsInMs <= 0) return { label: limitLabel(kind), percent: 0, resetsInMs: null }
    return { label: limitLabel(kind), percent: reading.percentUsed, resetsInMs }
  })
}

/** `five_hour` -> `5h`, `seven_day` -> `7d` */
export function limitLabel(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (kind === 'spend_limit') return 'spend'
  return kind
}

/** 8_100_000 -> "2h 15m", 277_200_000 -> "3d 5h" */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** The effort settings.json sets for `model`: modelSettings[model].effortLevel, else effortLevel. */
export function settingsEffort(settings: Readonly<Record<string, unknown>>, model: string): string | null {
  const perModel = settings['modelSettings']
  if (typeof perModel === 'object' && perModel !== null) {
    const entry = (perModel as Record<string, unknown>)[model]
    if (typeof entry === 'object' && entry !== null) {
      const level = (entry as Record<string, unknown>)['effortLevel']
      if (typeof level === 'string') return level
    }
  }
  const level = settings['effortLevel']
  return typeof level === 'string' ? level : null
}

/**
 * The model's name as Claude Code's banner and /model show it: claude-opus-5-5 -> "Opus 5.5",
 * claude-fable-5-1[1m] -> "Fable 5.1 (1M)", claude-3-5-sonnet-20241022 -> "Sonnet 3.5". An id of
 * another shape is shown as it is.
 */
export function modelLabel(id: string): string {
  const context = /\[(\w+)\]$/.exec(id)?.[1]
  const base = id.replace(/\[\w+\]$/, '').replace(/-\d{8}$/, '')
  const suffix = context === undefined ? '' : ` (${context.toUpperCase()})`
  const name = (family: string, major: string, minor?: string): string =>
    `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}${suffix}`
  const current = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?$/.exec(base)
  if (current) return name(current[1] ?? '', current[2] ?? '', current[3])
  const older = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)$/.exec(base)
  if (older) return name(older[3] ?? '', older[1] ?? '', older[2])
  return id
}

/** 84312 -> "84k", 1000000 -> "1M" */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

export function contextColor(percent: number): string {
  if (percent >= 80) return COLOR.red
  if (percent >= 60) return COLOR.yellow
  return COLOR.green
}

export function gitCodeColor(code: string): string {
  if (code === '??') return COLOR.dim
  if (code.includes('U') || code === 'AA' || code === 'DD') return COLOR.red
  if (code.includes('D')) return COLOR.red
  if (code.includes('A')) return COLOR.green
  if (code.includes('R') || code.includes('C')) return COLOR.blue
  return COLOR.yellow
}

/** $HOME/x -> ~/x */
export function tildePath(path: string, home: string | undefined): string {
  if (home === undefined || home === '' || home === '/') return path
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** Directories first, then files, each alphabetical (case-insensitive). */
export function sortEntries<T extends { name: string; kind: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    const aDir = a.kind === 'dir' ? 0 : 1
    const bDir = b.kind === 'dir' ? 0 : 1
    return aDir - bDir || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}
