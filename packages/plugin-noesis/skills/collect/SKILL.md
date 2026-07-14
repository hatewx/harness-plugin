---
name: collect
description: Collect an external article into Noesis as a reusable source note. Use when the user gives an article URL/text/file and asks to 收录, 归档, 整理, collect, save to Noesis, or asks for /grill-collect before filing it.
---

# Collect

Turn an external article into a clean Noesis source note. This skill is about
**collecting**, not digesting: preserve the article as a reusable knowledge
object, summarize key information, and leave structural knowledge untouched.

## Boundary

Collecting answers:

- What is this source?
- Where did it come from?
- What does it claim?
- Why did the user save it?
- What can be reused later without reopening the article?

Do not update existing concept notes, skills, project docs, or blog drafts. If
the article should change the user's structural knowledge, finish the source
note and point the user to `digest`.

## Grill gate

Use a Matt-style grilling loop when the user's intent, filing location, or
summary depth is unclear, especially when they invoke `/grill-collect`.

- Look up facts yourself: title, author, date, canonical URL, and source details.
- Ask decisions one at a time: why save it, target folder, desired depth, tags,
  whether it should be publishable later.
- Provide a recommended answer with each question.
- Stop grilling once the source note can be created without inventing intent.

Do not grill when the request is already specific enough; proceed and state the
assumptions.

## Workflow

1. **Acquire the source.** Use the supplied URL/text/file. If the article is
   online and the user did not forbid browsing, fetch it and cite the source.
   If only partial text is available, say the note is based on the provided
   excerpt.

2. **Choose a home.** Prefer an existing topic folder when obvious. Otherwise
   use `pendings/` so the note can be digested later. Do not create a new
   taxonomy branch for one article unless the user asked for it.

3. **Create or update one source note.** Use a concise filename that reflects
   the article, avoiding URL encoding. If a matching note already exists,
   update it instead of creating a duplicate.

4. **Write the note.** Follow the template below. Keep quotes short. Separate
   facts from author claims and personal notes. Use `publish: false` by default.

5. **Leave a digestion pointer.** End with a short `# Digestion Queue`
   section when the article appears worth internalizing, listing candidate
   notes/files to update later. Do not perform those updates here.

Completion criterion: a single source note exists, has enough metadata and
summary to be reused later, and any future digestion work is explicit.

## Source Note Template

```md
---
type: source-note
title:
description:
source_url:
author:
published:
captured: YYYY-MM-DD
tags: []
publish: false
ingestion_stage: collected
---

# Summary

一句话说明这篇文章讲什么，以及为什么值得保存。

# Key Claims

- ...

# Evidence / Examples

- ...

# Useful Quotes

> Keep quotes short and selective.

# My Notes

- ...

# Related

- [[...]]

# Digestion Queue

- [ ] Consider updating [[...]]
- [ ] Possible output:
```

## Quality Bar

- The note should be useful even if the original URL disappears.
- The summary should not flatten disagreement: mark claims as claims.
- Use the user's existing concise Noesis style from `模板/文档创建指南.md`.
- Preserve source attribution clearly enough for later blog or research use.
