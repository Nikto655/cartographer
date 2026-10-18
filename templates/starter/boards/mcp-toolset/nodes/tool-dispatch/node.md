---
id: tool-dispatch
title: Tool dispatch
created: '2026-08-01'
status: built
tags: []
description: 'tools.ts shapes the arguments, checks write scope, and resolves the Workspace.'
---

`workspaceFor(userId)` hands back the same Workspace the cookie door gets — an agent sees exactly what its owner sees, and the tools take no owner argument. No board logic lives here: a rule about boards in the tool layer would be a second implementation, and the two would drift.
