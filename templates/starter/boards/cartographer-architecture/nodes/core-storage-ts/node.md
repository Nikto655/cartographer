---
id: core-storage-ts
title: core/storage.ts
created: '2026-08-01'
status: built
tags:
  - core
description: The only module that touches the filesystem. Workspace lives here.
---

Atomic writes, path guards, slugs, archive moves. No global path builder: a file can only be named through a Workspace for a specific user, so forgetting to scope does not compile.
