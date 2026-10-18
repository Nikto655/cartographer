---
id: sessions
title: Stateless
created: '2026-07-31'
status: documented
tags: []
description: No MCP sessions — every request is decided by its own token.
---

Sessions lived in memory, so every restart dropped them and some clients never recovered. Now nothing is issued and nothing is remembered: a revoked token fails on its next call, and "one snapshot per board per run" counts a token's writes within thirty minutes.
