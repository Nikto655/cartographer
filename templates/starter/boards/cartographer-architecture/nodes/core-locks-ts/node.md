---
id: core-locks-ts
title: core/locks.ts
created: '2026-08-01'
status: built
tags:
  - core
description: 'Per-board serialization, plus the board-registry lock.'
---

Overlapping autosaves and agent writes take the same lock. Six concurrent creates of one name once silently lost three boards — minting and claiming are now one step.
