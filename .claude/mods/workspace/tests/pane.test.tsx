import { expect, mock, test } from 'claude-code/testing'

import { SNAPSHOT_SCHEMA } from '../hooks/lib'
import type { WorkspaceSnapshot } from '../types'

const SNAP: WorkspaceSnapshot = {
  schema: SNAPSHOT_SCHEMA,
  root: '/home/bilal/Projects/app',
  cwdLabel: '~/Projects/app',
  model: 'claude-opus-5-5',
  effort: 'xhigh',
  contextPercent: 42,
  contextTokens: 84_000,
  contextWindow: 200_000,
  limits: [
    { label: '5h', percent: 34, resetsInMs: 8_100_000 },
    { label: '7d', percent: 12, resetsInMs: null },
    { label: 'spend', percent: null, resetsInMs: null },
  ],
  git: {
    branch: 'main',
    ahead: 1,
    behind: 0,
    files: [
      { code: ' M', path: 'src/app.ts', mention: 'src/app.ts' },
      { code: ' D', path: 'old.md', mention: null },
    ],
    total: 2,
  },
  tree: [
    { depth: 0, name: 'src', path: 'src', kind: 'dir', isOpen: true },
    { depth: 1, name: 'app.ts', path: 'src/app.ts', kind: 'file', isOpen: false },
    { depth: 0, name: 'docs', path: 'docs', kind: 'dir', isOpen: false },
    { depth: 0, name: 'README.md', path: 'README.md', kind: 'file', isOpen: false },
    { depth: 0, name: '… 3 more', path: '', kind: 'note', isOpen: false },
  ],
  errors: ['files: permission denied'],
}

const PANE = {
  plugin: 'workspace',
  component: 'Pane',
  requestId: 'workspace',
  props: {
    title: 'Workspace',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

test('the pane draws a snapshot on every surface', async ($, on) => {
  on('state.get', ($, e, next) =>
    e.plugin === 'workspace' && e.key === 'snapshot' ? { value: { value: SNAP, version: 1 } } : next(e),
  )
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5 · xhigh/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Directory$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Model$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /34%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /resets in 2h 15m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^—$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /~\/Projects\/app/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /permission denied/ })).toBeDefined()
    expect(await ui.find({ key: 'd:src' })).toBeDefined()
    expect(await ui.find({ key: 'f:README.md' })).toBeDefined()
    expect(await ui.find({ key: 'g:src/app.ts' })).toBeDefined()
    expect(await ui.find({ key: 'g:old.md' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a tree file click opens the file, a git file click puts @path into the prompt', async ($, on) => {
  const filled: string[] = []
  const ran: (readonly string[])[] = []
  on('state.get', ($, e, next) =>
    e.plugin === 'workspace' && e.key === 'snapshot' ? { value: { value: SNAP, version: 1 } } : next(e),
  )
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('process.run', ($, e) => {
    ran.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'f:README.md' })
  await ui.press({ key: 'g:src/app.ts' })
  expect(ran).toHaveLength(1)
  expect(ran[0]?.[0]).toBe('sh')
  expect(ran[0]?.[ran[0].length - 1]).toBe('/home/bilal/Projects/app/README.md')
  expect(filled).toEqual(['@src/app.ts '])
  await ui.unmount()
})

test('a folder click opens and closes it', async ($, on) => {
  const written: unknown[] = []
  on('state.get', ($, e, next) =>
    e.plugin === 'workspace' && e.key === 'snapshot' ? { value: { value: SNAP, version: 1 } } : next(e),
  )
  on('state.set', async ($, e, next) => {
    if (e.plugin === 'workspace' && e.key === 'expanded') written.push(e.value)
    return next(e)
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'd:docs' })
  await ui.press({ key: 'd:docs' })
  expect(written).toEqual([['docs'], []])
  await ui.unmount()
})

// Names come from the disk and from git: a file named with an escape sequence must not reach the
// terminal as one. It is drawn with U+FFFD in place of each control character, while a click still
// acts on the real path.
test('control characters in names, paths, the branch and errors are not drawn', async ($, on) => {
  const esc = '\u001b]52;c;cHduZWQ=\u0007'   // OSC 52: would write to the clipboard
  const evil: WorkspaceSnapshot = {
    ...SNAP,
    cwdLabel: `~/Projects/${esc}app`,
    git: { ...SNAP.git!, branch: `main${esc}`, files: [{ code: ' M', path: `src/${esc}x.ts`, mention: `src/${esc}x.ts` }], total: 1 },
    tree: [{ depth: 0, name: `bad${esc}.txt`, path: `bad${esc}.txt`, kind: 'file', isOpen: false }],
    errors: [`files: ${esc}boom`],
  }
  const ran: (readonly string[])[] = []
  on('state.get', ($, e, next) =>
    e.plugin === 'workspace' && e.key === 'snapshot' ? { value: { value: evil, version: 1 } } : next(e),
  )
  on('process.run', ($, e) => {
    ran.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /[\u0000-\u001f\u007f-\u009f]/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /bad�\]52;c;cHduZWQ=�\.txt/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /main�/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /�boom/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `f:bad${esc}.txt` })
  expect(ran[0]?.[ran[0].length - 1]).toBe(`/home/bilal/Projects/app/bad${esc}.txt`)
  await ui.unmount()
})

test('the pane says it is reading before the first snapshot', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Reading/ })).toBeDefined()
  await ui.unmount()
})

test('a snapshot of an older shape (kept across a reload) is not drawn', async ($, on) => {
  const old = { cwdLabel: '~', model: 'm', contextPercent: 1, contextWindow: 1, git: null, tree: [], errors: [] }
  on('state.get', ($, e, next) =>
    e.plugin === 'workspace' && e.key === 'snapshot'
      ? { value: { value: old as unknown as WorkspaceSnapshot, version: 1 } }
      : next(e),
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Reading/ })).toBeDefined()
  await ui.unmount()
})

test('after a good snapshot, one of an older shape keeps the good one on screen', async ($, on) => {
  const old = { cwdLabel: '~', model: 'm', contextPercent: 1, contextWindow: 1, git: null, tree: [], errors: [] }
  let current: unknown = SNAP
  on('state.get', ($, e, next) =>
    e.plugin === 'workspace' && e.key === 'snapshot'
      ? { value: { value: current as WorkspaceSnapshot, version: 1 } }
      : next(e),
  )
  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await first.find({ type: 'Text', text: /42%/ })).toBeDefined()
  await first.unmount()
  current = old
  const second = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await second.find({ type: 'Text', text: /42%/ })).toBeDefined()
  await second.unmount()
})

// A session in a folder that is no git repository: an empty folder says so under Files, and a folder
// click is read again by the session's own 1-second timer (a click's $ can be aborted under it).
test('an empty folder says so, at the top and in an opened folder', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'workspace' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/home/bilal/empty' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => ({
    value: {
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: not a git repository (or any parent up to mount point /)',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  let folders: string[] = []
  on('fs.list', (_, e) => ({
    value: e.path === '/home/bilal/empty' ? folders.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0 })) : [],
  }))
  on('ui.log', (_, e) => {
    throw new Error(String(e.text))
  })
  const snaps: WorkspaceSnapshot[] = []
  on('state.set', async ($, e, next) => {
    if (e.plugin === 'workspace' && e.key === 'snapshot') snaps.push(e.value as WorkspaceSnapshot)
    return next(e)
  })

  await $.session.start({ cwd: '/home/bilal/empty', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(snaps.at(-1)?.errors).toEqual([])
  expect(snaps.at(-1)?.git).toBeNull()
  expect(snaps.at(-1)?.tree).toEqual([{ depth: 0, name: '(empty)', path: '', kind: 'note', isOpen: false }])

  folders = ['docs']
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'd:docs' })
  await clock.advance(1_000)
  expect(snaps.at(-1)?.tree).toEqual([
    { depth: 0, name: 'docs', path: 'docs', kind: 'dir', isOpen: true },
    { depth: 1, name: '(empty)', path: '', kind: 'note', isOpen: false },
  ])
  await ui.unmount()
})
