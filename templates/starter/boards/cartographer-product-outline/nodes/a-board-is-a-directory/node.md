---
id: a-board-is-a-directory
title: A board is a directory
created: '2026-07-31'
status: documented
tags: []
description: 'Boards, nodes and sidecars are folders and files, all the way down.'
---

```
boards/<board-id>/
  board.json
  nodes/<node-id>/
    node.md
    data.json   (optional)
```

Since v1.6 the whole tree lives under one private workspace per account — see [[Accounts and workspaces]].
