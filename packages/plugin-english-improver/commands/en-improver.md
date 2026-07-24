---
name: en-improver
description: Direct English analysis for grammar improvements and natural alternatives
argument-hint: '[English text to analyze]'
---

Use the [english-improver](../skills/english-improver/SKILL.md) skill and follow it exactly.

The final response must be raw JSON with no prose, tool tags, or Markdown. The
only keys are `original`, `corrected_versions`, and `explanation`; use at most
two corrected versions, and never answer the user's underlying question.
