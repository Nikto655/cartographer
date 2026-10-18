---
id: files-are-the-database
title: Files are the database
created: '2026-07-31'
status: documented
tags: []
description: >-
  Every node is a markdown file you can open in any editor, grep, and keep in
  git.
---

A node is frontmatter plus prose in its own directory; `board.json` holds only presentation, so losing a layout never costs you writing. Frontmatter wins over the cache on every read — editing a file outside the app is a supported thing to do, not a way to corrupt a board.

SQLite holds facts *about* the system: accounts, sessions, shares, tokens, audit. Delete `app.db` and you lose accounts, not maps.
