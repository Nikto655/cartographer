---
id: modules-boards
title: modules/boards
created: '2026-08-01'
status: built
tags:
  - modules
description: 'Board CRUD, saveGraph, listBoards.'
---

getBoard reconciles cache against frontmatter; saveGraph merges onto known nodes only — unknown ids ignored, client-sent createdVia discarded, absent keys left alone.
