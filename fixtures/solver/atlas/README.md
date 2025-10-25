# Atlas → Solver Regression Fixtures

These fixtures capture the canonical Atlas CLI outputs that feed the Solver
regression suite:

- `dense-urban-scores.csv` – blended score export used to seed store `score`
  values in `dense-urban-trip.json`.
- `dense-urban-trace.jsonl` – combined prior/posterior/blend traces emitted by
  the scoring CLI.
- `dense-urban-posterior-trace.csv` – posterior-only traces with wide columns
  for detailed audits.
- `dense-urban-anchors.csv` / `dense-urban-anchor-assignments.csv` – DBSCAN
  anchor summary and assignments for the dense urban scenario.
- `dense-urban-subclusters.jsonl` – hierarchy materialised from
  `dense-urban-subcluster-spec.json` for anchor `metro-anchor-001`.
- `atlas-diagnostics-v0.2.*` – default diagnostics sidecars emitted alongside
  the score export (kept to mirror the CLI behaviour validated in Atlas tests).
- `dense-urban-trip.json` – Solver trip definition that references the Atlas
  score output.

## Regeneration

1. Install Atlas Python dependencies if they are not already present:

   ```bash
   cd packages/atlas-python
   pip install jsonschema numpy pandas pyarrow
   ```

2. Regenerate the Atlas outputs and Solver trip directly from the repository
   root:

   ```bash
   python fixtures/solver/atlas/regenerate_trip.py
   ```

   The helper script shells into the Atlas CLI to rewrite scores, traces,
   diagnostics, anchors, and sub-clusters before rebuilding the Solver trip.

The Solver regression test `npm run test:integration` will fail if the
regenerated fixtures drift from the JSON schemas in `schema/atlas/v1`.
