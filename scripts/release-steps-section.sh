#!/usr/bin/env bash
# Reads a pull request body on stdin and prints its "Release steps" section:
# the lines under the first heading whose text is "Release steps" (any level,
# any case, emoji or punctuation around it allowed), up to the next heading of
# the same or a higher level or a thematic break. HTML comments and the blank
# lines around the
# section are dropped. Inside a fenced code block, nothing counts as a heading
# or a comment, so `# comment` lines in a shell block stay part of the steps.
#
# The exit status says what the section holds:
#   0  steps, printed
#   3  only "None" (or "None."), printed
#   4  no Release steps heading outside a comment
#   5  the heading, with nothing under it but comments and blank lines
# Any other status is an error.
#
# The PR Release Steps workflow requires a section (0 or 3), and the release
# skill's release-facts.sh lists every pull request in a release whose section
# has steps.
#
#   scripts/release-steps-section.sh <pr-body.md
set -euo pipefail

tr -d '\r' | awk '
function heading_level(text,   t) {
  t = text
  sub(/^ ? ? ?/, "", t)
  if (t !~ /^#+([ \t]|$)/) return 0
  match(t, /^#+/)
  return RLENGTH
}
function is_release_steps(text,   t) {
  t = tolower(text)
  sub(/^ ? ? ?#+/, "", t)
  sub(/^[^a-z]+/, "", t)
  sub(/[^a-z]+$/, "", t)
  return t == "release steps"
}
# Drops comment text from one line, carrying an open comment to the next line.
function strip_comments(line,   out, rest, p) {
  out = ""
  rest = line
  while (rest != "") {
    if (in_comment) {
      p = index(rest, "-->")
      if (p == 0) { rest = "" } else { rest = substr(rest, p + 3); in_comment = 0 }
    } else {
      p = index(rest, "<!--")
      if (p == 0) { out = out rest; rest = "" } else { out = out substr(rest, 1, p - 1); rest = substr(rest, p + 4); in_comment = 1 }
    }
  }
  return out
}
BEGIN { state = 0; n = 0; in_comment = 0; fence = "" }
{
  line = $0
  if (fence != "") {
    # Inside a fence, a closing fence of the same kind ends it; all else is content.
    if (line ~ ("^ ? ? ?" fence)) fence = ""
    if (state == 1) lines[++n] = line
    next
  }
  had_comment = in_comment || index(line, "<!--") > 0
  text = strip_comments(line)
  if (had_comment && text ~ /^[ \t]*$/) next
  if (text ~ /^ ? ? ?```/) fence = "```"
  else if (text ~ /^ ? ? ?~~~/) fence = "~~~"
  level = (fence == "") ? heading_level(text) : 0
  if (state == 0) {
    if (level > 0 && is_release_steps(text)) { state = 1; section_level = level }
    next
  }
  if (state == 1 && level > 0 && level <= section_level) { state = 2; next }
  # A thematic break (---, ***, ___) also ends the section, as Renovate puts
  # one between its notes and the rest of its PR body.
  if (state == 1 && fence == "" && text ~ /^ ? ? ?([-*_][ \t]*)([-*_][ \t]*)([-*_][ \t]*)+$/) {
    t = text; gsub(/[ \t]/, "", t)
    if (t ~ /^-+$/ || t ~ /^\*+$/ || t ~ /^_+$/) { state = 2; next }
  }
  if (state == 1) lines[++n] = text
}
END {
  if (state == 0) exit 4
  first = 1
  while (first <= n && lines[first] ~ /^[ \t]*$/) first++
  last = n
  while (last >= first && lines[last] ~ /^[ \t]*$/) last--
  if (first > last) exit 5
  for (i = first; i <= last; i++) print lines[i]
  if (first == last) {
    only = tolower(lines[first])
    gsub(/^[ \t]+|[ \t]+$/, "", only)
    if (only == "none" || only == "none.") exit 3
  }
  exit 0
}
'
