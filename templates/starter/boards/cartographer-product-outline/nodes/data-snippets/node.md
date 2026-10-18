---
id: data-snippets
title: Data snippets
created: '2026-07-31'
status: documented
tags: []
description: Labelled code or data attached to a node; one can be marked as the output.
---

The marked snippet flows to every node this one points at, so a documented pipeline carries its own example payloads. Each node's **Incoming** list is computed from the graph on every read — the same never-stored discipline as the links. Stored in a `data.json` sidecar that is deleted when emptied.
