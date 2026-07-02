# Feature Plans

This directory contains planning documents for features that span multiple PRs.

## When to Create a Feature Plan

Create a feature plan when:

- A feature requires more than one PR to implement
- Multiple developers (human or AI) will work on the feature
- The feature needs architectural decisions documented before implementation

## Naming Convention

```
YYYY-MM-feature_name.md
```

Examples:

- `2025-12-user_dashboard.md`
- `2025-12-calculator_redesign.md`

## Template

```markdown
# Feature: [Feature Name]

## Overview

Brief description of what this feature does and why it's needed.

## Scope

- What's included
- What's explicitly NOT included

## Technical Approach

High-level technical decisions and architecture.

## PR Breakdown

### PR 1: [Title]

- **Branch:** `feat/feature-name-part-1`
- **Status:** [ ] Not started / [ ] In progress / [x] Merged
- **Description:** What this PR accomplishes
- **Files affected:** List key files

### PR 2: [Title]

- **Branch:** `feat/feature-name-part-2`
- **Status:** [ ] Not started
- **Description:** What this PR accomplishes
- **Depends on:** PR 1

[Add more PRs as needed]

## Open Questions

- List any unresolved decisions here

## Notes

Any additional context or learnings during implementation.
```

## Lifecycle

1. **Create** the plan before starting work
2. **Update** the plan as PRs are created and merged
3. **Delete** the plan file entirely once the feature is deployed to production

Do not archive completed plans - remove them to keep this directory clean.
