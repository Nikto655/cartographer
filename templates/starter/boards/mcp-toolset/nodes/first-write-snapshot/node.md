---
id: first-write-snapshot
title: First write? snapshot
created: '2026-08-01'
status: built
tags: []
description: 'Before a token''s first write to each board: copy it whole.'
---

One snapshot per board per run — a token's writes within thirty minutes — so restoring it undoes the run in one action. Best-effort and swallowed on failure — a safety net that can refuse the work it protects is the worse failure mode.
