---
id: rest-routes-api
title: REST routes (/api)
created: '2026-08-01'
status: built
tags:
  - http
description: >-
  The cookie door: boards, nodes, shares, tokens, folders — all behind
  requireAuth.
---

48 routes. Everything except login sits inside the guarded scope. /u/:ownerId is the one prefix for boards other people let you see — the same read-only rendering path either way.
