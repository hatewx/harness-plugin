# Harness Plugin

Omni-based plugin collection for reusable agent capabilities across harnesses.

## Packages

- `@hatewx/plugin-noesis` — Noesis knowledge workflows, including `collect`, `digest`, and `retrieval-reflex`.
- `@hatewx/plugin-english-improver` — English writing improvement skill and related hook/command assets adapted from `english-improver`.

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

