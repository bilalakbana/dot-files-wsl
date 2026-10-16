# ~/.zshrc (WSL): zsh4humans (z4h) v5 + powerlevel10k (prompt config: ~/.p10k.zsh).
# Docs: https://github.com/romkatv/zsh4humans/blob/v5/README.md
# Shared with bash: ~/.config/shell/env.sh (PATH, exports) and ~/.config/shell/aliases.sh.

# ── z4h settings (must come before `z4h init`) ───────────────────────────────
zstyle ':z4h:'                auto-update            'no'      # update by hand: z4h update
zstyle ':z4h:bindkey'         keyboard               'pc'
zstyle ':z4h:'                prompt-at-bottom       'no'
zstyle ':z4h:'                term-shell-integration 'yes'     # marks prompts (OSC 133)
zstyle ':z4h:autosuggestions' forward-char           'accept'  # Right arrow accepts the whole suggestion
zstyle ':z4h:fzf-complete'    recurse-dirs           'no'
zstyle ':z4h:direnv'          enable                 'no'
zstyle ':z4h:ssh:*'           enable                 'no'      # don't carry z4h over ssh
# z4h's menus (Ctrl+R history, Tab completion, Alt+Down cd) use the fzf in ~/.local/bin (latest
# release), not the old one z4h ships and pins in its cache
zstyle ':z4h:*'               fzf-command            ~/.local/bin/fzf

# ── tmux autostart ───────────────────────────────────────────────────────────
# Runs only in the terminal's outer shell: never inside tmux (new panes/windows), never in shells
# without a tty (e.g. Claude Code shell snapshots).
if [[ -z $TMUX && -t 0 && -t 1 ]]; then
  # renumber numbered sessions 1, 2, 3, ...; named sessions are left alone
  i=1; for s in $(tmux list-sessions -F "#{session_name}" 2>/dev/null | grep -E '^[1-9][0-9]*$' | sort -n); do [[ $s == $i ]] || tmux rename-session -t "=$s" "$i"; i=$((i+1)); done
  # reattach a detached numbered session (terminal closed or crashed) instead of starting a new one
  s=$(tmux list-sessions -F "#{session_attached} #{session_name}" 2>/dev/null | awk '$1==0 && $2~/^[1-9][0-9]*$/{print $2}' | sort -n | head -n1)
  if [[ -n $s ]]; then
    zstyle ':z4h:' start-tmux command tmux -u attach -t "=$s"
  else
    # With a systemd user session (WSL with systemd on), start the server in its own scope, so an
    # OOM kill in the terminal's scope cannot take the whole tmux server down. Without one, the
    # `tmux new -A` below starts the server itself.
    if ! tmux has-session 2>/dev/null && command -v systemd-run >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
      SHELL=${${:-/proc/self/exe}:A} systemd-run --user --scope --quiet -p OOMPolicy=continue -- tmux -u new-session -d -s "$i"
    fi
    zstyle ':z4h:' start-tmux command tmux -u new -A -s "$i"
  fi
  unset i s
fi

# Installs/updates z4h components and initializes zsh. Nothing above may need console input
# after this point; everything else goes below.
z4h init || return

# ── Environment and shared aliases ───────────────────────────────────────────
source ~/.config/shell/env.sh
source ~/.config/shell/aliases.sh
typeset -U path                      # drop duplicate PATH entries
export GPG_TTY=$TTY
export FZF_DEFAULT_OPTS="-i -e --bind=ctrl-h:backward-kill-word"

# ── Options ──────────────────────────────────────────────────────────────────
setopt no_auto_menu                  # require an extra TAB press to open the completion menu
setopt no_nomatch                    # pass unmatched globs (e.g. *) through, like bash

# ── zsh-only aliases and functions ───────────────────────────────────────────
alias tree='tree -a -I .git'
alias ls="${aliases[ls]:-ls} -A"
autoload -Uz zmv
function md() { [[ $# == 1 ]] && mkdir -p -- "$1" && cd -- "$1" }   # mkdir + cd
compdef _directories md

# ── Search functions (~/.SearchFunctions, the search-functions-wsl repo) ──────
# Skipped with a note (not an error at every prompt) until the repo is cloned there.
if [[ -d ~/.SearchFunctions ]]; then
  source ~/.SearchFunctions/advancedsearch                  # advancedsearch
  source ~/.SearchFunctions/advancedsearch_plus             # advancedsearch_plus
  source ~/.SearchFunctions/detailedsearch                  # detailedsearch
  source ~/.SearchFunctions/search_in_file_content          # ugrep-fzf | ugrep-fzf-plus | rga-fzf | rga-fzfS
  source ~/.SearchFunctions/search_in_file_path_and_content # ugf | ugf-plus | rgf | rgfS
  source ~/.SearchFunctions/find_files                      # f
  source ~/.SearchFunctions/sub-functions/list_functions    # fbr
  source ~/.SearchFunctions/sub-functions/git_logs          # gfzf* | logs* (need git-delta; show_diffs needs git-split-diffs)
else
  print -P '%F{yellow}~/.SearchFunctions is missing: git clone the search-functions-wsl repo there%f'
fi

# ── Widgets ──────────────────────────────────────────────────────────────────
function zsh_autosuggest_clear() { zle autosuggest-clear }
zle -N zsh_autosuggest_clear

function open_folder_list() {
  tmux new-window -n folders ~/.SearchFunctions/sub-functions/folder_list_ugrep; tmux select-pane -T folder-list
}
zle -N open_folder_list

function open_file_list() {
  tmux new-window -n files ~/.SearchFunctions/sub-functions/file_list; tmux select-pane -T file-list
}
zle -N open_file_list

function tmux_clear_history() {
  if [[ -n $TMUX ]]; then
    clear
    tmux clear-history
    zle reset-prompt
  fi
}
zle -N tmux_clear_history

# ── Key bindings ─────────────────────────────────────────────────────────────
z4h bindkey z4h-backward-kill-word  Ctrl+Backspace Ctrl+H
z4h bindkey z4h-backward-kill-zword Alt+Backspace
z4h bindkey undo                    Ctrl+/ Shift+Tab   # undo the last command line change
z4h bindkey redo                    Alt+/              # redo the last undone change
z4h bindkey z4h-cd-back             Alt+Left           # cd into the previous directory
z4h bindkey z4h-cd-forward          Alt+Right          # cd into the next directory
z4h bindkey z4h-cd-up               Alt+Up             # cd into the parent directory
z4h bindkey z4h-cd-down             Alt+Down           # cd into a child directory

bindkey '\e'   zsh_autosuggest_clear   # Esc: drop the autosuggestion
bindkey '^[j'  open_folder_list        # Alt+J: folder list (new tmux window)
bindkey '^J'   open_file_list          # Ctrl+J: file list (new tmux window)
bindkey '^K'   tmux_clear_history      # Ctrl+K: clear screen and tmux scrollback
bindkey '\e^H' kill-whole-line         # Ctrl+Alt+Backspace (Ctrl+Alt+H): clear the line

typeset -g HISTORY_SUBSTRING_SEARCH_HIGHLIGHT_FOUND='bg=green,fg=black,bold'
