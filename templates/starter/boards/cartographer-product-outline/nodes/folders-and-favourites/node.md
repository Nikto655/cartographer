---
id: folders-and-favourites
title: Folders and favourites
created: '2026-07-31'
status: documented
tags: []
description: >-
  A folder is a label, not a place — filing moves nothing on disk and hides
  nothing.
---

Arrangement and stars live in `folders.json`, read and written whole. A board sits in at most one folder.

An assignment whose folder is gone is dropped; one whose *board* is absent is kept — absence is not deletion here (see [[Archive, never delete]]), and a restored board must land back where it lived. Pruning by absence would quietly unfile everything waiting under `archive/`.
