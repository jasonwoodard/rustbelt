# Atlas → Solver Regression Fixtures

These fixtures capture the canonical Atlas CLI outputs that feed the Solver
regression suite:

- `dense-urban-scores.csv` – blended score export used to seed store `score`
  values in `dense-urban-trip.json`.
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

2. Recreate the outputs from the canonical fixtures:

   ```bash
   cd packages/atlas-python
   PYTHONPATH=src python -m atlas.cli score \
     --mode blended \
     --stores src/atlas/fixtures/dense_urban/stores.csv \
     --affluence src/atlas/fixtures/dense_urban/affluence.csv \
     --observations src/atlas/fixtures/dense_urban/observations.csv \
     --output ../../fixtures/solver/atlas/dense-urban-scores.csv \
     --lambda 0.5

   PYTHONPATH=src python -m atlas.cli anchors \
     --stores src/atlas/fixtures/dense_urban/stores.csv \
     --output ../../fixtures/solver/atlas/dense-urban-anchors.csv \
     --store-assignments ../../fixtures/solver/atlas/dense-urban-anchor-assignments.csv \
     --metrics ../../fixtures/solver/atlas/dense-urban-anchor-metrics.json \
     --algorithm dbscan \
     --eps 0.03 \
     --min-samples 2 \
     --metric euclidean \
     --id-prefix metro-anchor

   PYTHONPATH=src python -m atlas.cli subclusters \
     --anchor-id metro-anchor-001 \
     --spec ../../fixtures/solver/atlas/dense-urban-subcluster-spec.json \
     --output ../../fixtures/solver/atlas/dense-urban-subclusters.jsonl \
     --id-prefix metro-anchor-001-sc
   ```

3. Rebuild the Solver trip JSON with the blended scores:

   ```bash
   cd ../../
   python fixtures/solver/atlas/regenerate_trip.py
   ```

   (Or adapt the helper script to match future schema additions.)

The Solver regression test `npm run test:integration` will fail if the
regenerated fixtures drift from the JSON schemas in `schema/atlas/v1`.
