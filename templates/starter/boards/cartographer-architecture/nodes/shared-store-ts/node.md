---
id: shared-store-ts
title: shared/store.ts
created: '2026-08-01'
status: built
tags:
  - client
description: Zustand. Maps the board to React Flow and back.
---

pushHistory → set → scheduleSave; autosave at 1 s with 3 s retries; undo hangs off gesture starts. boardToFlow in, splitFlow out — member positions back to absolute.
