# Security

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/RenasDemirbas/BlockSmooth/security/advisories/new)
instead. You can expect a first answer within a week. Fixes go into the latest release; there are no
backports to older versions.

| Version | Supported |
| --- | --- |
| 1.0.x (latest) | Yes |

## Scope

BlockSmooth is a Blockbench plugin with no server, no network access and no runtime dependencies.
It reads and writes only the open project: the `blocksmooth` data on meshes, and the mesh data during
an export, which is restored afterwards.

| Risk | Defence |
| --- | --- |
| A crafted `.bbmodel` with hostile BlockSmooth data | Stored data is validated and clamped on every read (`src/model/schema.ts`). Unknown modifiers are kept as plain data and never executed. Levels are capped, and a face budget stops a file from requesting a mesh too large to compute. |
| An export leaves a model half-replaced | Swapped data is restored by reference in a `finally` path, and the project codec always runs with the cages swapped in. |
| A failure inside Blockbench's render loop | Every hook is isolated; a failing mesh falls back to its plain display. |

## Privacy

No telemetry, analytics, accounts or update checks. The plugin opens no network connections.
