# Harness Plugin

Omni-based plugin collection for reusable agent capabilities across harnesses.

## Packages

- `@in404/plugin-noesis` — Noesis knowledge workflows, including `collect`, `digest`, and `retrieval-reflex`.
- `@in404/plugin-english-improver` — English writing improvement skill and related hook/command assets adapted from `english-improver`.

## Standalone Skills

- `patent-disclosure-cn` — Evidence-traceable Chinese invention and utility-model disclosure drafting for inventor–AI–patent-agent collaboration.
- `employee-offboarding` — Verify and clean up employee access in PineRouter and Cursor, with identity checks and safe handling of missing accounts.
- `write-rd-monthly-report` — Evidence-based R&D operating monthly reports organized by technical tracks and product mappings.

Install the standalone skill through Omni:

```bash
omni skills add . --skill write-rd-monthly-report
```

From a consuming project, reference this repository as the skill source:

```bash
omni skills add ../code/harness-plugin --skill patent-disclosure-cn
```

## Omni Layout

Each package is an Omni plugin package:

```text
packages/plugin-*/
├── package.json
├── skills/
├── agents/
├── hooks/
├── commands/
└── scripts/
```

Omni discovers skills from `skills/<skill-name>/SKILL.md` and plugin metadata from `package.json#omni`.

## Local Install Example

```bash
omni install \
  --source file:./packages/plugin-noesis \
  --harness claude,codex \
  --scope project
```

```bash
omni install \
  --source file:./packages/plugin-english-improver \
  --harness claude,codex \
  --scope project
```
