---
id: shared-store-ts
title: shared/store.ts
created: '2026-08-01'
status: built
tags: []
description: 'Zustand — the hinge: board in, React Flow out, autosave back.'
---

pushHistory → set → scheduleSave. Undo hangs off gesture starts; a failed save retries every 3 s.
