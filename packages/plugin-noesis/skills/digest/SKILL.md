---
name: digest
description: Digest a collected article source note into Noesis structural knowledge. Use when the user asks to 消化, 吸收, 内化, digest, integrate, update my knowledge base, turn an article into structural knowledge, create a derived article/skill/workflow, or asks for /grill-digest before changing notes.
---

# Digest

Turn a collected source note into Noesis structural knowledge. Digestion is
**knowledge metabolism**, not a mere summary: the source changes the user's
concepts, workflows, articles, skills, decisions, or project notes.

Start from an existing source note whenever possible. If the article has not
been collected yet, run `collect` first or create the source note as the first
step, then continue.

## Boundary

Digestion may produce several kinds of changes:

- update an existing concept note
- create a new structural note
- add a section to an existing article draft
- create a new article outline or draft
- refine a skill, workflow, checklist, or project decision
- mark the source note as digested and add a digestion log

The goal is not a longer summary. The goal is that Noesis now thinks
differently because the source was integrated.

## Grill gate

Use a Matt-style grilling loop before making structural changes, especially
when the user invokes `/grill-digest` or the digestion target is ambiguous.

- Look up facts by reading the source note, related notes, indexes, and code or
  skill files when relevant.
- Ask decisions one at a time: what changed in the user's understanding, which
  notes should be authoritative, whether to create a new article, and how far
  to operationalize the idea.
- Recommend an answer with each question.
- Do not modify structural notes until the user confirms the digestion plan or
  the requested change is already precise.

Facts are yours to investigate. Decisions belong to the user.

## Workflow

1. **Load the source note.** Read the collected article note and identify its
   `Key Claims`, `My Notes`, `Related`, and `Digestion Queue`.

2. **Survey the neighborhood.** Search Noesis for related concepts, tags,
   article drafts, skills, and project docs. Prefer `rg` and existing indexes
   such as `MOC.md` and topic `知识索引.md` files.

3. **Make a digestion plan.** List the concrete files that should change and
   the role of each change:
   - `update`: existing structural knowledge becomes more accurate
   - `create`: new concept/article/workflow is needed
   - `operationalize`: knowledge becomes a checklist, skill, script, or process
   - `defer`: promising but not worth changing now

4. **Confirm decisions when needed.** If multiple reasonable knowledge homes
   exist, grill the user one decision at a time. If the plan is obvious and low
   risk, proceed and state the assumption.

5. **Apply the changes.** Edit only the planned files. Preserve existing voice
   and structure. Keep source attribution where the digested claim depends on
   the article.

6. **Update the source note.** Change `ingestion_stage` to `digested` or
   `operationalized` as appropriate. Add a `# Digestion Log` entry with the
   date, changed files, and the resulting structural knowledge.

Completion criterion: every planned structural update is applied, the source
note records what changed, and deferred ideas are explicit.

## Digestion Plan Template

```md
# Digestion Plan

## Source

- [[source note]]

## What Changes

- Before:
- After:

## File Changes

- update: [[...]] — why
- create: [[...]] — why
- operationalize: [[...]] — why
- defer: ... — why

## Decisions Needed

1. ...
```

## Digestion Log Template

```md
# Digestion Log

- YYYY-MM-DD: Digested into [[...]], updated [[...]], deferred [[...]].
```

## Quality Bar

- No orphan insight: every important claim either lands somewhere structural or
  is explicitly deferred.
- No duplicate authority: if a concept already has a home, update that note
  rather than creating a competing one.
- No attribution laundering: keep source links near claims that rely on the
  article.
- No over-absorption: do not update half the knowledge base just because a
  source is interesting.
