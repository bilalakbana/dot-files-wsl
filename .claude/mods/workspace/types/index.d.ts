export type GitFile = {
  /** Porcelain status code, e.g. ` M`, `??`, `R ` */
  code: string
  /** Path relative to the repository root, as git prints it */
  path: string
  /** What a click puts after `@`: the path relative to the session's directory (absolute when
   *  outside it); null for a deleted file */
  mention: string | null
}

export type WorkspaceGit = {
  branch: string
  ahead: number
  behind: number
  files: GitFile[]
  total: number
}

export type TreeRow = {
  depth: number
  name: string
  /** Relative to the session's directory; '' for a note */
  path: string
  /** `note` is a "… N more" or error line, not an entry */
  kind: 'dir' | 'file' | 'note'
  isOpen: boolean
}

export type UsageLimit = {
  /** `5h`, `7d`, `spend`, or the engine's own name */
  label: string
  /** null when no session has a reading yet */
  percent: number | null
  /** Milliseconds from the snapshot until the window resets; null when unknown */
  resetsInMs: number | null
}

export type WorkspaceSnapshot = {
  /** Shape version: a snapshot kept in $.state from an older module version is not drawn */
  schema: number
  /** The session's directory, absolute: the tree's paths are relative to it */
  root: string
  /** The session's directory, $HOME shown as ~ */
  cwdLabel: string
  model: string
  /** Reasoning effort of the main loop: the last request's, or the settings' before the first */
  effort: string | null
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  limits: UsageLimit[]
  git: WorkspaceGit | null
  tree: TreeRow[]
  errors: string[]
}

declare module 'claude-code' {
  interface PluginState {
    workspace: {
      snapshot: WorkspaceSnapshot | null
      isDismissed: boolean
      effort: string | null
      /** Folders the person opened in the tree, relative to the session's directory */
      expanded: string[]
    }
  }
}
