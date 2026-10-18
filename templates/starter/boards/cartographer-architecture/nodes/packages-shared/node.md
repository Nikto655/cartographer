---
id: packages-shared
title: packages/shared
created: '2026-08-01'
status: built
tags:
  - shared
description: 'Types and constants, imported by both sides. Zero runtime deps.'
---

Both halves compile against the same file, so a storage-shape change breaks the client at build time rather than at runtime.
