# Changelog

## 1.1.3 - 2026-07-25
### Features
- Show uncommitted changes as inline blame after save (`You` / `Not Committed Yet`), with a link to open the Diff view.
- Show blame on the left side of VS Code's built-in Git Diff view (including special refs such as `~`).
- Support multi-level remote URLs (e.g. GitLab `group/subgroup/repo`) for “View on …” links.
- Open commit Diff views using the historical file path after renames, so blame-linked diffs are no longer empty.

## 1.1.2 - 2026-05-01
### Fixes
- Support stash actions from workspace contexts.
- Refresh blame decorations after unsaved file changes to avoid misplaced inline blame.

## 1.1.1 - 2026-04-12
- Resolve the correct Git repository per file across the workspace (multi-root folders and nested repositories).
- Clearer, more consistent user-facing copy and messages.

## 1.1.0 - 2026-02-11
- Support blame annotations in diff view (left/right panes show their own blame).
- Improve blame hover trigger/positioning to be less intrusive and closer to the inline blame.

## 1.0.0
- Inline Git blame annotations at the end of each line.
- Rich hover details with commit info and links.
- GitHub/GitLab integration for commit and author links.
- View commit diff from inline blame.
- Smart stash actions from SCM view (staged/unstaged).
- Theme-aware styling (light/dark).
- High performance with caching and visible-range updates.
- Multilingual support (English, Simplified Chinese).
- Customizable blame format and message length.
- Multi-line commit message display.
