# Aliases and functions shared by bash and zsh. Sourced from ~/.bashrc and ~/.zshrc.
# Keep this file POSIX-compatible (no zsh-only syntax).

# ── Git ──────────────────────────────────────────────────────────────────────
alias status='git status -s'
alias push='git push'
alias pull='git pull --no-rebase && git pull --no-rebase --recurse-submodules && git submodule update --progress --init --recursive'
alias pull-remote='git pull --no-rebase && git pull --no-rebase --recurse-submodules && git submodule update --progress --init --recursive --remote'
# Destructive: discard all local changes / delete untracked files (named after the git command on purpose)
alias git-reset-hard='git reset --hard && git submodule update --init --recursive --force'
alias git-reset-hard-remote='git reset --hard && git submodule update --init --recursive --force --remote'
alias git-clean-fd='git clean -fd'
commit() { git commit -m "$1"; }
add() { git add "$@"; }
remove() { git rm "$@"; }

# git diff through delta and less: unified / side by side, 10 lines of context or the whole file
alias diffs='COLUMNS=$(tput cols); git -c core.pager="delta --line-numbers --width=$COLUMNS --minus-style=\"syntax gray\" --plus-style=\"syntax gray\" | less -R -i --mouse" diff --unified=10'
alias diffs-sbs='COLUMNS=$(tput cols); git -c core.pager="delta --side-by-side --line-numbers --width=$COLUMNS --minus-style=\"syntax gray\" --plus-style=\"syntax gray\" | less -R -i --mouse" diff --unified=10'
alias diffs-full='COLUMNS=$(tput cols); git -c core.pager="delta --line-numbers --width=$COLUMNS --minus-style=\"syntax gray\" --plus-style=\"syntax gray\" | less -R -i --mouse" diff --unified=99999999999'
alias diffs-full-sbs='COLUMNS=$(tput cols); git -c core.pager="delta --side-by-side --line-numbers --width=$COLUMNS --minus-style=\"syntax gray\" --plus-style=\"syntax gray\" | less -R -i --mouse" diff --unified=99999999999'
alias get-author-names="git rev-list --all --pretty=format:'%aN <%aE>' --no-commit-header | grep -v '^commit' | sort | uniq -c | sort -nr | awk '{match(\$0, /<.*>/); email=substr(\$0,RSTART,RLENGTH); name=substr(\$0,index(\$0,\$2),RSTART-index(\$0,\$2)); printf \"\033[1;32m%-5s\033[0m \033[1;34m%-25s\033[0m \033[1;33m%s\033[0m\n\",\$1,name,email}'"

# ── Files ────────────────────────────────────────────────────────────────────
# numbered long listing
alias lsd='lsd -al --color=always | awk '\''{if(NR>2) printf "\033[31m%3d\033[0m: %-s\n", NR-2, $0}'\'''
