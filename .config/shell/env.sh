# Environment shared by bash and zsh (POSIX sh). Sourced from ~/.bashrc and ~/.zshrc.

# Rust toolchain (rustup): adds ~/.cargo/bin (skipped until rustup is installed)
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

# Claude Code clamps colours to 256 inside tmux unless this is set; ~/.tmux.conf gives tmux
# 24-bit colour (terminal-features RGB), so let Claude use it
export CLAUDE_CODE_TMUX_TRUECOLOR=1

# PATH: prepend each directory unless it is already there. ~/.local/bin holds fzf (latest release)
# and the fd / bat links (Ubuntu names the binaries fdfind / batcat).
for dir in \
  "$HOME/bin" \
  "$HOME/.local/bin"
do
  case ":$PATH:" in
    *":$dir:"*) ;;
    *) PATH="$dir:$PATH" ;;
  esac
done
unset dir
export PATH
