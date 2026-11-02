# Contributing to BlockSmooth

Bug reports, fixes, new modifiers and better documentation are all welcome.

## Ground rules

1. **Never break Blockbench.** BlockSmooth runs inside Blockbench's render and export paths. Hook
   bodies go through `guarded()` (`src/util/guard.ts`); a failure tears the display down and leaves
   the plain mesh visible. Exports must still succeed when baking fails.
2. **Never lose the cage.** Whatever is swapped during an export is put back by reference, and the
   `.bbmodel` codec always sees the cages.
3. **Everything is undoable.** Edits go through `Undo.initEdit` / `Undo.finishEdit`. Validate first
   and change the mesh only after everything that can throw has run (`editData` in `src/ops/edit.ts`).
4. **No dialogs, no network access, no runtime dependencies.**
5. **Same license.** BlockSmooth is licensed under the GNU GPL, version 3 or later. By sending a pull
   request you agree that your contribution is released under the same terms.

## How the code is organized

Imports only point downward: `core` and `model` are pure and know nothing of Blockbench; `bb` adapts
Blockbench; `export` and `ops` build on `bb`; `ui` and `api.ts` sit on top; `index.ts` only wires the
parts together. Keep files focused. If a module grows a second responsibility, split it. If it does
math, move the math into `core/` and give it a unit test.

## Adding a modifier

1. **Schema:** a type, its defaults and validation in `src/model/schema.ts`.
2. **Plan:** what it means in each context, in `src/model/plan.ts`.
3. **Geometry:** the math in `src/core/`, with tests in `test/`. Keep it linear in the cage positions
   where possible, so it can be precomputed (see `src/core/hierarchy.ts`).
4. **UI and API:** the panel template in `src/ui/panel.ts`; the API picks new types up from
   `MODIFIER_TYPES`.
5. **Docs:** the README and `CHANGELOG.md`.

## Tests

```bash
npm run typecheck
npm test
```

For changes to the Blockbench side, run `scripts/verify-blocksmooth.mjs` from the Blockbench MCP
repository with Blockbench open and your build loaded, and say in the pull request what you checked
by hand in the viewport.

## Pull requests

- One topic per pull request. Describe what changes for the person modeling.
- Commit messages: a short summary line, then what changed and why.
- Include the test output, and a screenshot when the change is visual.
