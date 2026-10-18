---
id: serialized-writes
title: Serialized writes
created: '2026-07-31'
status: documented
tags: []
description: 'One writer per board, and every write is atomic.'
---

Files gave durability but not a database's other guarantee. Two autosave timers genuinely overlap, so every read-modify-write runs under a per-board lock, and every write is a temp file plus rename — a crash can never leave half a file.

Even creating boards is serialized per workspace: six concurrent creates of one name once produced three boards and silently lost three. The price of [[Files are the database]], paid deliberately.
