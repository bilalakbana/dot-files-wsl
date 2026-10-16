// Workspace pane: a sidebar beside the fullscreen transcript with the context window's fill, the
// account's usage limits, git status and a folder tree of the session's directory. Opens by itself
// when the terminal is fullscreen and wide enough; /workspace shows or hides it.
// Clicks: a folder in the tree opens or closes, a file in the tree opens in its default app, a file
// in git status goes into the prompt as @path.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TreeRow, WorkspaceGit, WorkspaceSnapshot } from '../types'
import type { LimitReading, SharedLimits } from './lib'
import {
  COLOR,
  contextColor,
  formatDuration,
  formatTokens,
  gitCodeColor,
  limitRows,
  modelLabel,
  parseGitStatus,
  parseShared,
  pickLimits,
  printable,
  settingsEffort,
  SNAPSHOT_SCHEMA,
  sortEntries,
  tildePath,
} from './lib'

const PANE = 'workspace'
const TITLE = 'Workspace'
const REFRESH_MS = 10_000
const MODEL_CHECK_MS = 1_000
const MAX_CHILDREN = 60
const MAX_TREE_ROWS = 500
const SKIP = new Set([
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache',
  '.gradle', '.dart_tool', 'build', 'dist', 'target',
])
// GIT_OPTIONAL_LOCKS=0: never take index.lock, so this never collides with a git command Claude runs
const GIT = { env: { GIT_OPTIONAL_LOCKS: '0' }, timeoutMs: 5_000 }

const snapshot = atom({ plugin: 'workspace', key: 'snapshot' } as const, null)
const isDismissed = atom({ plugin: 'workspace', key: 'isDismissed' } as const, false)
const liveEffort = atom({ plugin: 'workspace', key: 'effort' } as const, null)
const expanded = atom({ plugin: 'workspace', key: 'expanded' } as const, [])

// The newest usage-limit reading any session saw, shared by all sessions (under $HOME)
const SHARED_LIMITS_FILE = '.cache/claude-workspace-pane/limits.json'

// This session's own limit reading as last seen, and when it last changed (0 = unknown since a
// (re)load: its age is unknown, so it is not published until it changes)
let ownSignature: string | undefined
let ownChangedAt = 0

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const indent = (depth: number): string => '  '.repeat(depth)

async function readGit($: EngineInterface, cwd: string): Promise<WorkspaceGit | null> {
  const where = await $.process.run(['git', 'rev-parse', '--show-toplevel', '--show-prefix'], { cwd, ...GIT })
  if (where.exitCode !== 0) {
    if (where.stderr.includes('not a git repository')) return null
    throw new Error(where.stderr.trim() || `git rev-parse exited ${where.exitCode}`)
  }
  const [top = '', prefix = ''] = where.stdout.split('\n')
  const ran = await $.process.run(['git', 'status', '--porcelain=v1', '--branch', '-z'], { cwd, ...GIT })
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `git status exited ${ran.exitCode}`)
  return parseGitStatus(ran.stdout, top, prefix)
}

// Lists `rel` under `root` into `rows`, descending into the folders the person opened.
async function readDir(
  $: EngineInterface,
  root: string,
  rel: string,
  depth: number,
  open: ReadonlySet<string>,
  rows: TreeRow[],
): Promise<void> {
  const listed = await $.fs.list(rel === '' ? root : `${root}/${rel}`)
  const entries = sortEntries(listed).filter(entry => !SKIP.has(entry.name))
  for (const entry of entries.slice(0, MAX_CHILDREN)) {
    if (rows.length >= MAX_TREE_ROWS) {
      rows.push({ depth, name: '… (list cut here)', path: '', kind: 'note', isOpen: false })
      return
    }
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`
    const isDir = entry.kind === 'dir'
    const isOpen = isDir && open.has(path)
    rows.push({ depth, name: entry.name, path, kind: isDir ? 'dir' : 'file', isOpen })
    if (!isOpen) continue
    try {
      await readDir($, root, path, depth + 1, open, rows)
    } catch (err) {
      rows.push({ depth: depth + 1, name: `(${message(err)})`, path: '', kind: 'note', isOpen: false })
    }
  }
  if (entries.length > MAX_CHILDREN) {
    rows.push({ depth, name: `… ${entries.length - MAX_CHILDREN} more`, path: '', kind: 'note', isOpen: false })
  }
}

async function readShared($: EngineInterface, path: string): Promise<SharedLimits | null> {
  if (!(await $.fs.exists(path))) return null
  return parseShared(await $.fs.read(path))
}

// Publishes this session's reading when it changed, then picks the newest of it and the shared one.
async function readLimits(
  $: EngineInterface,
  own: LimitReading[],
  home: string | undefined,
  now: number,
): Promise<LimitReading[]> {
  if (home === undefined) return own
  const path = `${home}/${SHARED_LIMITS_FILE}`
  const signature = JSON.stringify(own)
  if (ownSignature === undefined) {
    ownSignature = signature
  } else if (signature !== ownSignature) {
    ownSignature = signature
    ownChangedAt = now
    if (own.length > 0) await $.fs.write(path, JSON.stringify({ at: now, limits: own }))
  }
  return pickLimits(own, ownChangedAt, await readShared($, path))
}

async function collect($: EngineInterface): Promise<WorkspaceSnapshot> {
  const errors: string[] = []
  const cwd = await $.session.cwd()
  const [model, usage, home, settings, live, opened, now] = await Promise.all([
    $.session.model(),
    $.session.usage(),
    $.env.get('HOME'),
    $.settings.read(),
    read($, liveEffort),
    read($, expanded),
    $.clock.now(),
  ])
  const git = await readGit($, cwd).catch(err => {
    errors.push(`git: ${message(err)}`)
    return null
  })
  const tree: TreeRow[] = []
  await readDir($, cwd, '', 0, new Set(opened), tree).catch(err => {
    errors.push(`files: ${message(err)}`)
  })
  const own: LimitReading[] = usage.rateLimits.map(limit =>
    limit.resetsAt === undefined
      ? { kind: limit.kind, percentUsed: limit.percentUsed }
      : { kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt },
  )
  const readings = await readLimits($, own, home, now).catch(err => {
    errors.push(`limits: ${message(err)}`)
    return own
  })
  const limits = limitRows(readings, now)
  return {
    schema: SNAPSHOT_SCHEMA,
    root: cwd,
    cwdLabel: tildePath(cwd, home),
    model,
    effort: live ?? settingsEffort(settings, model),
    contextPercent: usage.context.percent ?? null,
    contextTokens: usage.context.tokens ?? null,
    contextWindow: usage.context.window,
    limits,
    git,
    tree,
    errors,
  }
}

// Module state: reset on every reload, which is fine (a reload re-reads everything).
let isRefreshing = false
let isDirty = false
let hasAutoOpened = false
// The model the last check saw: a switch (/model, the picker, /config) refreshes the pane at once
let lastModel: string | null = null
// The last snapshot of the current shape this module drew: shown while $.state holds one of an
// older shape (written before a reload, or by an older copy of this mod loaded in the same session)
let lastDrawn: WorkspaceSnapshot | null = null
// The last snapshot written, as JSON: an unchanged one is not written again
let lastWritten = ''

// One refresh at a time; a request during one runs once more afterwards.
async function refresh($: EngineInterface): Promise<void> {
  if (isRefreshing) {
    isDirty = true
    return
  }
  isRefreshing = true
  try {
    do {
      isDirty = false
      const snap = await collect($)
      // Every write redraws the pane, and under tmux (no synchronized output) a redraw can flicker
      const json = JSON.stringify(snap)
      if (json !== lastWritten) {
        lastWritten = json
        await update($, snapshot, () => snap)
      }
    } while (isDirty)
  } catch (err) {
    $.ui.log(`workspace: refresh failed: ${message(err)}`)
  } finally {
    isRefreshing = false
  }
}

// Every second: cheap, so a model switch shows at once rather than at the next 10-second refresh.
// The effort seen on the last request belonged to the old model: forget it, so the new model's
// effort comes from the settings until its first request reports the real one.
async function checkModel($: EngineInterface): Promise<void> {
  const model = await $.session.model()
  if (lastModel !== null && model !== lastModel) {
    await update($, liveEffort, () => null)
    void refresh($)
  }
  lastModel = model
}

async function open($: EngineInterface): Promise<string> {
  // 44 columns: a narrow sidebar; a width the person drags the dock to wins
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: 44 })
  void refresh($)
  return opened.isPlaced ? 'Workspace pane opened.' : `Workspace pane is waiting: ${opened.reason}`
}

async function toggleFolder($: EngineInterface, path: string): Promise<void> {
  await update($, expanded, list => (list.includes(path) ? list.filter(one => one !== path) : [...list, path]))
  await refresh($)
}

// Inside tmux, a text file opens read-only in nvim (his LazyVim config) in a popup over 90% of the
// terminal. Esc or q closes it: buffer-local maps, so they win over LazyVim's global <Esc> map,
// which is set later (VeryLazy). Anything else, or outside tmux, opens in its
// default app: on WSL the Windows one, through the search functions' windows_action (PowerShell).
// The path reaches the popup as $F, never inside the command text; a # in the title
// is doubled (tmux formats). setsid -f: the call returns at once, the popup or app lives on.
const OPEN_FILE = `f=$1
win=$HOME/.SearchFunctions/sub-functions/windows_action
if [ -n "$TMUX" ] && command -v nvim >/dev/null &&
   { [ ! -s "$f" ] || [ "$(file -b --mime-encoding -- "$f")" != binary ]; }; then
  title=$(basename -- "$f" | sed 's/#/##/g')
  setsid -f tmux display-popup -E -w 90% -h 90% -T " $title " -e "F=$f" \\
    'nvim -R -n -c "nnoremap <buffer> <silent> <Esc> <Cmd>qa!<CR>" -c "nnoremap <buffer> <silent> q <Cmd>qa!<CR>" -- "$F"' \\
    >/dev/null 2>&1
elif [ -x "$win" ] && grep -qi microsoft /proc/version 2>/dev/null; then
  setsid -f "$win" open "$f" >/dev/null 2>&1
else
  command -v xdg-open >/dev/null || { echo "xdg-open is not installed" >&2; exit 127; }
  setsid -f xdg-open "$f" >/dev/null 2>&1
fi`

// Opens the file: a text file in a tmux popup, anything else in its default app (see OPEN_FILE)
async function openFile($: EngineInterface, path: string): Promise<void> {
  const ran = await $.process.run(['sh', '-c', OPEN_FILE, 'sh', path], { timeoutMs: 5_000 })
  if (ran.exitCode !== 0) $.ui.toast(`Could not open ${path}: ${ran.stderr.trim() || `exit ${ran.exitCode}`}`)
}

async function mention($: EngineInterface, path: string): Promise<void> {
  const filled = await $.prompt.fill({ text: `@${path} `, mode: 'insert' })
  if (!filled.isFilled) $.ui.toast(`Could not add @${path} to the prompt (${filled.refusal ?? 'refused'})`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'workspace',
      description: 'Show or hide the workspace pane (context, limits, git status, folder tree)',
    })
    $.clock.every(REFRESH_MS, () => void refresh($))
    $.clock.every(MODEL_CHECK_MS, () => {
      checkModel($).catch(err => $.ui.log(`workspace: model check failed: ${message(err)}`))
    })
    void refresh($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    void refresh($)
    return ran
  }).catch(($, e, next) => next(e))

  // The effort the engine really sends (after /effort, /model or a downgrade), main loop only
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) {
      const level = String(e.effort)
      if ((await read($, liveEffort)) !== level) {
        await update($, liveEffort, () => level)
        void refresh($)
      }
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'workspace' }, async $ => {
    // A pane opened unasked in a narrow terminal is open but not placed: /workspace then places it.
    const pane = (await $.ui.panes()).find(one => one.id === PANE)
    if (pane?.isPlaced === true) {
      await $.ui.close({ id: PANE })
      return { text: 'Workspace pane closed.' }
    }
    await update($, isDismissed, () => false)
    return { text: await open($) }
  })

  // A pane the person closed stays closed for this session (until /workspace).
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, isDismissed, () => true)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Opens the pane unasked only where it is a sidebar: the fullscreen terminal layout.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Waits for the first snapshot (this read subscribes: its write draws this site again), so the
    // pane appears once, already filled, instead of empty, then "Reading…", then filled
    const stored = await read($, snapshot)
    const isReady = stored !== null && stored.schema === SNAPSHOT_SCHEMA
    if (!hasAutoOpened && isReady && e.viewport?.isFullscreen === true && !(await read($, isDismissed))) {
      hasAutoOpened = true
      open($).catch(err => $.ui.log(`workspace: could not open the pane: ${message(err)}`))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const stored = await read($, snapshot)
    if (stored !== null && stored.schema === SNAPSHOT_SCHEMA) lastDrawn = stored
    const snap = lastDrawn
    if (snap === null) return <Text dimColor>Reading…</Text>
    const git = snap.git

    return (
      <Box flexDirection="column">
        {snap.errors.map(err => (
          <Text color={COLOR.red}>{printable(err)}</Text>
        ))}

        <Text color={COLOR.mauve} weight="bold">Directory</Text>
        <Text wrap="truncate-start">{printable(snap.cwdLabel)}</Text>

        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.mauve} weight="bold">Model</Text>
          <Text wrap="truncate-end">
            {modelLabel(snap.model)}
            {snap.effort === null ? '' : <Text dimColor> · {snap.effort}</Text>}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
        <Text color={COLOR.mauve} weight="bold">Context</Text>
        {snap.contextPercent === null ? (
          <Text dimColor>no reply yet · {formatTokens(snap.contextWindow)} window</Text>
        ) : (
          <Text>
            <Text color={contextColor(snap.contextPercent)}>{snap.contextPercent}%</Text>
            <Text dimColor>
              {' '}
              {formatTokens(snap.contextTokens ?? 0)} / {formatTokens(snap.contextWindow)}
            </Text>
          </Text>
        )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.mauve} weight="bold">Limits</Text>
          {snap.limits.map(limit => (
            <Text wrap="truncate-end">
              <Text dimColor>{limit.label.padEnd(3)} </Text>
              {limit.percent === null ? (
                <Text dimColor>—</Text>
              ) : (
                <Text color={contextColor(limit.percent)}>{limit.percent}%</Text>
              )}
              {limit.resetsInMs !== null && (
                <Text dimColor> · resets in {formatDuration(limit.resetsInMs)}</Text>
              )}
            </Text>
          ))}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.mauve} weight="bold">Git</Text>
          {git === null ? (
            <Text dimColor>not a git repository</Text>
          ) : (
            <Text wrap="truncate-end">
              <Text color={COLOR.blue}>{printable(git.branch)}</Text>
              {git.ahead > 0 ? ` ↑${git.ahead}` : ''}
              {git.behind > 0 ? ` ↓${git.behind}` : ''}
              {git.total === 0 ? (
                <Text color={COLOR.green}> clean</Text>
              ) : (
                <Text dimColor> {git.total} changed</Text>
              )}
            </Text>
          )}
          {git?.files.map(file => {
            const target = file.mention
            const row = (
              <Text wrap="truncate-middle">
                <Text color={gitCodeColor(file.code)}>{printable(file.code)}</Text> {printable(file.path)}
              </Text>
            )
            return target === null ? (
              row
            ) : (
              <Button key={`g:${file.path}`} plain onPress={() => mention($, target)}>
                {row}
              </Button>
            )
          })}
          {git !== null && git.total > git.files.length && (
            <Text dimColor>… {git.total - git.files.length} more</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.mauve} weight="bold">Files</Text>
          {snap.tree.map(row => {
            if (row.kind === 'note') {
              return (
                <Text dimColor wrap="truncate-end">
                  {indent(row.depth)}
                  {printable(row.name)}
                </Text>
              )
            }
            if (row.kind === 'dir') {
              return (
                <Button key={`d:${row.path}`} plain onPress={() => toggleFolder($, row.path)}>
                  <Text color={COLOR.blue} wrap="truncate-end">
                    {indent(row.depth)}
                    {row.isOpen ? '▾ ' : '▸ '}
                    {printable(row.name)}/
                  </Text>
                </Button>
              )
            }
            return (
              <Button key={`f:${row.path}`} plain onPress={() => openFile($, `${snap.root}/${row.path}`)}>
                <Text color={COLOR.text} wrap="truncate-end">
                  {indent(row.depth)}
                  {'  '}
                  {printable(row.name)}
                </Text>
              </Button>
            )
          })}
        </Box>
      </Box>
    )
  })
}
