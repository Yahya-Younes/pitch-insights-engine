# Infrastructure snapshot (point-in-time export)

`main.bicep` in this directory is a **point-in-time export** of everything actually deployed in the `pitch-hackathon-rg` resource group, generated read-only via:

```
az group export --name pitch-hackathon-rg --include-parameter-default-value
az bicep decompile --file main.json
```

This is **not** the source-of-truth template used to deploy the system -- that's [`../main.bicep`](../main.bicep), which is parameterized and hand-written, and the one `infra/deploy.ps1` actually runs. This snapshot exists purely for judge/reviewer reproducibility: a literal, checkable record of what the live resource group contains, generated the same day as submission.

**Known gaps** (both are `az group export` limitations, not errors in this project's own infra):
- Cosmos DB's `sqlDatabases/containers` child resources (the `handoff_log` and `match_state` containers) aren't captured by `az group export` -- they exist live (see `../main.bicep`'s `handoffLogContainer`/`matchStateContainer` resources, which *are* the source of truth for them) but don't appear in this snapshot.
- A handful of other child-resource types (Cognitive Services computes/workbenches, Event Hubs schema groups, Log Analytics data sources, etc.) are similarly skipped by the export command itself -- none of them are resources this project created or manages.

**Do not deploy this snapshot.** It hardcodes this exact resource group's generated names (e.g. the `uniqueString()`-derived suffixes already baked in as literals) and several read-only properties the Bicep decompiler couldn't cleanly re-parameterize -- `az bicep build` confirms it compiles (syntax-valid), but it was never run as an actual deployment and isn't meant to be. To stand up a fresh copy of this system, use `../main.bicep` + `deploy.ps1` instead.
