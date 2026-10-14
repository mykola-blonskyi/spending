# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase. This repo is single-context: `apps/api` and `apps/web` share one domain vocabulary. It
keeps its domain docs in `knowledge/` and its decisions in `docs/decisions.md` instead of the
default `CONTEXT.md` and `docs/adr/` layout.

## Before exploring, read these

- **`knowledge/glossary.md`**: the vocabulary. Plays the role of `CONTEXT.md`.
- **`knowledge/domain-model.md`**: entities, fields and relationships.
- **`knowledge/business-rules.md`**: numbered rules (`BR-n`). Cite them by number in code, tests,
  issues and PRs.
- **`docs/decisions.md`**: the ADRs (`ADR-NNN`), all in one file. Read the ones touching the area
  you are about to work in.

If a file is missing or a section is empty, **proceed silently**. Don't flag the gap and don't
suggest creating files up front.

## Where new knowledge goes

- New or sharpened terms go in `knowledge/glossary.md`.
- New entities or fields go in `knowledge/domain-model.md`.
- New or changed business rules go in `knowledge/business-rules.md`, with the next free `BR-n`.
- New decisions go in `docs/decisions.md` as the next `ADR-NNN`.

Never create `CONTEXT.md`, `CONTEXT-MAP.md` or `docs/adr/`. That would duplicate the files above.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a
test name), use the term as `knowledge/glossary.md` and `knowledge/domain-model.md` define it.
Don't drift to synonyms the glossary avoids.

If the concept you need isn't there yet, that's a signal. Either you're inventing language the
project doesn't use (reconsider), or there's a real gap (note it for `/domain-modeling`).

## Flag ADR and rule conflicts

If your output contradicts an existing ADR or business rule, surface it explicitly rather than
silently overriding it:

> _Contradicts ADR-006 (one write path for transactions), but worth reopening because…_
