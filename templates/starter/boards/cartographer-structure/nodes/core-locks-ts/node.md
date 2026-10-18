---
id: core-locks-ts
title: core/locks.ts
created: '2026-08-01'
status: built
tags: []
description: One writer per board — autosaves and agents take the same lock.
---

Board creation is serialized too: minting a slug and claiming its directory are one step.
