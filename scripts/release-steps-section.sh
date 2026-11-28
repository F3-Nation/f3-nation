#!/usr/bin/env bash
# Reads a pull request body on stdin and prints its "Release steps" section:
# the lines under the first heading whose text is "Release steps" (any level,
# any case, emoji or punctuation around it allowed), up to the next heading of
# the same or a higher level or a thematic break. HTML comments and the blank
# lines around the
# section are dropped. Inside a fenced code block, nothing counts as a heading
# or a comment, so `# comment` lines in a shell block stay part of the steps.
# Fences follow CommonMark: a block closes only on a fence of the same
# character, at least as long as the one that opened it, with nothing after it
# but whitespace, and a backtick fence can't have a backtick after it. Inline
# code spans are left alone, so a literal `<!--` in one doesn't start a comment.
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
# has steps (0) or is missing/empty (4 or 5), skipping only None (3).
#
#   scripts/release-steps-section.sh <pr-body.md
set -euo pipefail

awk '
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
# Length of the run of c (a backtick or a tilde) at the start of s.
function run_length(s, c,   n) {
  n = 0
  while (substr(s, n + 1, 1) == c) n++
  return n
}
# Drops comment text from one line, carrying an open comment to the next line.
# Outside a comment, an inline code span (a run of backticks up to the next
# run of exactly the same length) is copied through untouched.
function strip_comments(line,   out, rest, p, q, n, used, tail, r, span) {
  out = ""
  rest = line
  while (rest != "") {
    if (in_comment) {
      p = index(rest, "-->")
      if (p == 0) { rest = "" } else { rest = substr(rest, p + 3); in_comment = 0 }
      continue
    }
    p = index(rest, "<!--")
    q = index(rest, "`")
    if (q > 0 && (p == 0 || q < p)) {
      out = out substr(rest, 1, q - 1)
      rest = substr(rest, q)
      n = run_length(rest, "`")
      used = n
      tail = substr(rest, n + 1)
      span = 0
      while ((q = index(tail, "`")) > 0) {
        r = run_length(substr(tail, q), "`")
        used += q - 1 + r
        if (r == n) { span = used; break }
        tail = substr(tail, q + r)
      }
      # No closing run: the backticks are literal text.
      if (span == 0) span = n
      out = out substr(rest, 1, span)
      rest = substr(rest, span + 1)
    } else if (p == 0) {
      out = out rest
      rest = ""
    } else {
      out = out substr(rest, 1, p - 1)
      rest = substr(rest, p + 4)
      in_comment = 1
    }
  }
  return out
}
# Sets fence_char and fence_len when text opens a fenced code block.
function opens_fence(text,   t, c, n) {
  t = text
  sub(/^ ? ? ?/, "", t)
  c = substr(t, 1, 1)
  if (c != "`" && c != "~") return 0
  n = run_length(t, c)
  if (n < 3) return 0
  if (c == "`" && index(substr(t, n + 1), "`") > 0) return 0
  fence_char = c
  fence_len = n
  return 1
}
function closes_fence(line,   t, n) {
  t = line
  sub(/^ ? ? ?/, "", t)
  n = run_length(t, fence_char)
  return n >= fence_len && substr(t, n + 1) ~ /^[ \t]*$/
}
BEGIN { state = 0; n = 0; in_comment = 0; fence_char = "" }
{
  line = $0
  gsub(/\r/, "", line)
  if (fence_char != "") {
    # Inside a fence, only its closing fence ends it; all else is content.
    if (closes_fence(line)) fence_char = ""
    if (state == 1) lines[++n] = line
    next
  }
  had_comment = in_comment || index(line, "<!--") > 0
  text = strip_comments(line)
  if (had_comment && text ~ /^[ \t]*$/) next
  opens_fence(text)
  level = (fence_char == "") ? heading_level(text) : 0
  if (state == 0) {
    if (level > 0 && is_release_steps(text)) { state = 1; section_level = level }
    next
  }
  if (state == 1 && level > 0 && level <= section_level) { state = 2; next }
  # A thematic break (---, ***, ___) also ends the section, as Renovate puts
  # one between its notes and the rest of its PR body.
  if (state == 1 && fence_char == "" && text ~ /^ ? ? ?([-*_][ \t]*)([-*_][ \t]*)([-*_][ \t]*)+$/) {
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
