---
id: snapshots
title: Snapshots
created: '2026-07-31'
status: documented
tags: []
description: 'Full directory copies, taken by hand or automatically before an agent run.'
---

`snapshots/<board>/<timestamp>/` — a plain copy you can diff. Restoring is itself undoable: the current state is snapshotted first, and old layouts are migrated on the way back in.
