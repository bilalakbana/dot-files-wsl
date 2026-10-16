import { describe, expect, test } from 'claude-code/testing'

import {
  COLOR,
  formatDuration,
  formatTokens,
  gitCodeColor,
  gitMention,
  limitLabel,
  limitRows,
  MAX_GIT_FILES,
  modelLabel,
  parseGitStatus,
  parseShared,
  pickLimits,
  printable,
  settingsEffort,
  sortEntries,
  tildePath,
} from '../hooks/lib'

describe('parseGitStatus', () => {
  const Z = (...fields: string[]) => fields.join('\0') + '\0'

  test('branch with upstream, ahead and behind, files, a rename', async () => {
    const git = parseGitStatus(
      Z('## main...origin/main [ahead 2, behind 1]', ' M a.ts', '?? new file.md', 'R  new.ts', 'old.ts', ' D gone.ts'),
      '/repo',
      '',
    )
    expect(git.branch).toBe('main')
    expect(git.ahead).toBe(2)
    expect(git.behind).toBe(1)
    expect(git.total).toBe(4)
    expect(git.files).toEqual([
      { code: ' M', path: 'a.ts', mention: 'a.ts' },
      { code: '??', path: 'new file.md', mention: 'new file.md' },
      { code: 'R ', path: 'new.ts', mention: 'new.ts' },
      { code: ' D', path: 'gone.ts', mention: null },
    ])
  })

  test('mentions are relative to a session inside the repository', async () => {
    const git = parseGitStatus(Z('## main', ' M src/app.ts', ' M docs/x.md'), '/repo', 'src/')
    expect(git.files.map(file => file.mention)).toEqual(['app.ts', '/repo/docs/x.md'])
  })

  test('clean branch without upstream', async () => {
    const git = parseGitStatus(Z('## feature/x'), '/repo', '')
    expect(git.branch).toBe('feature/x')
    expect(git.ahead).toBe(0)
    expect(git.total).toBe(0)
  })

  test('new repository and detached HEAD', async () => {
    expect(parseGitStatus(Z('## No commits yet on main'), '/r', '').branch).toBe('main')
    expect(parseGitStatus(Z('## HEAD (no branch)'), '/r', '').branch).toBe('HEAD (no branch)')
  })

  test('upstream gone', async () => {
    const git = parseGitStatus(Z('## main...origin/main [gone]'), '/r', '')
    expect(git.branch).toBe('main')
    expect(git.ahead).toBe(0)
  })

  test('caps the file list but counts every change', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ` M f${i}`)
    const git = parseGitStatus(Z('## main', ...lines), '/r', '')
    expect(git.files).toHaveLength(MAX_GIT_FILES)
    expect(git.total).toBe(40)
  })

  test('fails loudly on output it does not understand', async () => {
    expect(() => parseGitStatus('fatal: something\n', '/r', '')).toThrow()
  })
})

describe('gitMention', () => {
  test('root, inside and outside the session directory', async () => {
    expect(gitMention('a/b.ts', '/repo', '')).toBe('a/b.ts')
    expect(gitMention('sub/b.ts', '/repo', 'sub/')).toBe('b.ts')
    expect(gitMention('other/b.ts', '/repo', 'sub/')).toBe('/repo/other/b.ts')
  })
})

describe('limits', () => {
  test('limitLabel', async () => {
    expect(limitLabel('five_hour')).toBe('5h')
    expect(limitLabel('seven_day')).toBe('7d')
    expect(limitLabel('spend_limit')).toBe('spend')
    expect(limitLabel('other')).toBe('other')
  })

  test('formatDuration', async () => {
    expect(formatDuration(-5_000)).toBe('<1m')
    expect(formatDuration(20_000)).toBe('<1m')
    expect(formatDuration(12 * 60_000)).toBe('12m')
    expect(formatDuration(8_100_000)).toBe('2h 15m')
    expect(formatDuration(277_200_000)).toBe('3d 5h')
  })
})

describe('formatting', () => {
  test('formatTokens', async () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(84_312)).toBe('84k')
    expect(formatTokens(200_000)).toBe('200k')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_500_000)).toBe('1.5M')
  })

  test('gitCodeColor', async () => {
    expect(gitCodeColor('??')).toBe(COLOR.dim)
    expect(gitCodeColor(' M')).toBe(COLOR.yellow)
    expect(gitCodeColor('A ')).toBe(COLOR.green)
    expect(gitCodeColor(' D')).toBe(COLOR.red)
    expect(gitCodeColor('UU')).toBe(COLOR.red)
  })

  test('tildePath', async () => {
    expect(tildePath('/home/bilal/Documents', '/home/bilal')).toBe('~/Documents')
    expect(tildePath('/home/bilal', '/home/bilal')).toBe('~')
    expect(tildePath('/home/bilalx/a', '/home/bilal')).toBe('/home/bilalx/a')
    expect(tildePath('/etc', '/home/bilal')).toBe('/etc')
    expect(tildePath('/etc', undefined)).toBe('/etc')
  })

  test('printable replaces C0, DEL and C1 control characters, nothing else', async () => {
    expect(printable('a\u001b[31mb\u0007c\u007fd\u009be')).toBe('a�[31mb�c�d�e')
    expect(printable('tab\there\nnewline')).toBe('tab�here�newline')
    expect(printable('çşğ İÖ 名前 ✓')).toBe('çşğ İÖ 名前 ✓')
    expect(printable('')).toBe('')
  })

  test('sortEntries puts directories first', async () => {
    const sorted = sortEntries([
      { name: 'b.txt', kind: 'file' },
      { name: 'Zeta', kind: 'dir' },
      { name: 'alpha', kind: 'dir' },
      { name: 'A.md', kind: 'file' },
    ])
    expect(sorted.map(entry => entry.name)).toEqual(['alpha', 'Zeta', 'A.md', 'b.txt'])
  })
})

describe('settingsEffort', () => {
  test('per-model setting wins over the global one', async () => {
    const settings = { effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } }
    expect(settingsEffort(settings, 'claude-opus-5-5')).toBe('xhigh')
    expect(settingsEffort(settings, 'claude-sonnet-5-5')).toBe('high')
  })

  test('nothing set', async () => {
    expect(settingsEffort({}, 'claude-opus-5-5')).toBeNull()
    expect(settingsEffort({ modelSettings: 'broken' }, 'x')).toBeNull()
  })
})

describe('shared usage limits', () => {
  const NOW = Date.parse('2026-10-16T12:00:00Z')
  const FIVE = { kind: 'five_hour', percentUsed: 2, resetsAt: '2026-10-16T16:57:00Z' }
  const SEVEN = { kind: 'seven_day', percentUsed: 53, resetsAt: '2026-10-20T16:00:00Z' }

  test('parseShared keeps valid readings and refuses other shapes', async () => {
    expect(parseShared(JSON.stringify({ at: 5, limits: [SEVEN, { kind: 1 }] }))).toEqual({ at: 5, limits: [SEVEN] })
    expect(parseShared('[]')).toBeNull()
    expect(parseShared('{"at":"x","limits":[]}')).toBeNull()
    expect(() => parseShared('{"at":')).toThrow()
  })

  test('pickLimits takes the newer of this session and the shared file', async () => {
    const mine = [{ ...SEVEN, percentUsed: 52 }]
    expect(pickLimits(mine, 100, { at: 200, limits: [SEVEN] })).toEqual([SEVEN])
    expect(pickLimits(mine, 300, { at: 200, limits: [SEVEN] })).toEqual(mine)
    expect(pickLimits([], 0, { at: 1, limits: [SEVEN] })).toEqual([SEVEN])
    expect(pickLimits(mine, 0, null)).toEqual(mine)
  })

  test('limitRows always shows 5h and 7d', async () => {
    expect(limitRows([SEVEN], NOW)).toEqual([
      { label: '5h', percent: 0, resetsInMs: null },
      { label: '7d', percent: 53, resetsInMs: Date.parse(SEVEN.resetsAt) - NOW },
    ])
    expect(limitRows([FIVE, SEVEN], NOW).map(row => row.percent)).toEqual([2, 53])
  })

  test('a window whose reset time has passed shows 0%', async () => {
    const past = { kind: 'five_hour', percentUsed: 97, resetsAt: '2026-10-16T11:00:00Z' }
    expect(limitRows([past, SEVEN], NOW)[0]).toEqual({ label: '5h', percent: 0, resetsInMs: null })
  })

  test('no reading anywhere: rows without a figure; other windows follow', async () => {
    expect(limitRows([], NOW)).toEqual([
      { label: '5h', percent: null, resetsInMs: null },
      { label: '7d', percent: null, resetsInMs: null },
    ])
    expect(limitRows([SEVEN, { kind: 'spend_limit', percentUsed: 10 }], NOW).map(row => row.label)).toEqual(['5h', '7d', 'spend'])
  })
})

describe('modelLabel', () => {
  test('ids as Claude Code names them', async () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelLabel('claude-haiku-5-5')).toBe('Haiku 5.5')
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M)')
    expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(modelLabel('claude-nova-7-2')).toBe('Nova 7.2') // a family that does not exist yet
    expect(modelLabel('claude-opus-6')).toBe('Opus 6')
    expect(modelLabel('some-gateway-model')).toBe('some-gateway-model')
  })
})
