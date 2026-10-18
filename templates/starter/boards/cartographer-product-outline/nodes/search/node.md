---
id: search
title: Search
created: '2026-07-31'
status: documented
tags: []
description: Substring search over every node file in the workspace. Deliberately no index.
---

An index would be a second copy of the truth, and it would go stale exactly when someone edits a file outside the app — the case the product exists to support. What keeps it honest is a ceiling instead: 50 results, 4 000 files opened, and a `truncated` flag so a partial answer is never presented as a complete one.
