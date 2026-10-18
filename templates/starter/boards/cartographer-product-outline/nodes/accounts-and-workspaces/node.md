---
id: accounts-and-workspaces
title: Accounts and workspaces
created: '2026-07-31'
status: documented
tags: []
description: 'One private workspace per account, on the same volume.'
---

Everything is scoped by user at the filesystem level: a file can only be named through a workspace obtained for a specific user, so forgetting to scope does not compile. Even reads that opportunistically write check whose files they are holding — browsing someone's board never edits it.
