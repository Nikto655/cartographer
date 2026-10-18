---
id: session-check
title: No session
created: '2026-08-01'
status: built
tags: []
description: Nothing carries over between requests; each one is decided by its own token.
---

The mount is stateless: a fresh server per request, no session id issued or asked for. Sessions lived in memory, so every restart dropped them and some clients never recovered. Now a revoked token stops working on its next call, and nothing is lost to a deploy.
