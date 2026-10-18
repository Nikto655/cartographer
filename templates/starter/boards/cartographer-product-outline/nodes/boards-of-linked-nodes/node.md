---
id: boards-of-linked-nodes
title: Boards of linked nodes
created: '2026-07-31'
status: documented
tags: []
description: 'The unit of work: a canvas of nodes, edges, frames and annotations.'
---

A board belongs to one *world*, which decides how it is drawn and what a node means there. An unknown world falls back to a map rather than erroring — which is what lets a node pasted between worlds arrive intact, its data riding along inert.
