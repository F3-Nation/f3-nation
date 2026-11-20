#!/usr/bin/env bash
# open_file <path>: open a file in the desktop's default app on macOS, Linux or WSL.
# Returns non-zero when no opener is available, so the caller can say where the file is.
open_file() {
  local file="$1"
  if grep -qi microsoft /proc/version 2>/dev/null; then
    if command -v wslview >/dev/null 2>&1; then
      wslview "$file"
    else
      # explorer.exe exits non-zero even when it opens the file.
      explorer.exe "$(wslpath -w "$file")" || true
    fi
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    open "$file"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$file" >/dev/null 2>&1
  else
    return 1
  fi
}
