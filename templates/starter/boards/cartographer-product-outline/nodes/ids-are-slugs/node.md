---
id: ids-are-slugs
title: Ids are slugs
created: '2026-07-31'
status: documented
tags: []
description: 'Directory names are slugified titles — legible, mutable, and reusable.'
---

`signup-onboarding` is legible where a UUID is not. Two consequences follow, both originally missed: renaming re-slugs and moves the directory, and archiving frees the slug for the next board of that name — so a stale reference is not merely dangling, it can come to point at somebody's *newer* board. A share row once did exactly that; everything keyed on an id now follows renames and lets go on archive.
