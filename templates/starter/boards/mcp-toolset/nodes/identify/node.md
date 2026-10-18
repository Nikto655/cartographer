---
id: identify
title: identify
created: '2026-08-01'
status: built
tags: []
description: 'Hash the secret → token row → {userId, tokenId, scope}. Else 401.'
---

The row is joined on `is_disabled = 0` and re-resolved on **every** call — revoking a token or disabling its owner stops an agent mid-run. Each call counts against the token's 120/min ceiling → 429 beyond it.
