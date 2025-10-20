# Atlas synthetic fixtures

The `dense_urban` and `sparse_rural` directories contain small, fully synthetic
scenarios that exercise typical metro behaviour (highly visited stores with
complete covariates) and rural edge cases (sparser observations that rely on
posterior pooling). The CSVs are consumed by integration and regression tests
that execute the `atlas.cli` scoring pipeline end-to-end.

## Regenerating fixtures

The canonical definitions for each fixture live in
[`regenerate.py`](./regenerate.py). Run the module whenever the schema or the
scoring models change:

```bash
cd packages/atlas-python
PYTHONPATH=src python -m atlas.fixtures.regenerate
```

This rewrites every `stores.csv`, `affluence.csv`, and `observations.csv`
contained in the fixtures directory. After regenerating, rerun the CLI
integration suite to update any regression snapshots:

```bash
PYTHONPATH=src python -m pytest tests/test_cli_integration.py
```

If additional fields become mandatory, add them to the dictionaries in
`regenerate.py` so the script produces data that matches the new schema.
