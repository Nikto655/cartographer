---
id: personal-access-tokens
title: Personal access tokens
created: '2026-07-31'
status: documented
tags: []
description: 'Read-only or read-and-write, resolving to exactly one person.'
---

Shown once, stored as a hash, rate-limited per token. An agent sees precisely what its owner sees and nothing of anyone else's, so tenancy needed no new cases.

Disabling an account stops its agents immediately — the token is re-resolved on every call — but merely *suspends* the tokens: re-enabling brings them back, because a secret pasted into a connector config somewhere is not a thing to destroy on a reversible action.
