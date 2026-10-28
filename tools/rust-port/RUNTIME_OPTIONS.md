# Static runtime options and app-only regeneration

`generate-program.mjs --runtime-options JSON` embeds selected boolean switches as literal Rust assignments immediately after `Runtime::new()` and before environment capture, host installation or any source unit runs. There is no environment lookup or dynamic selector in the generated application.

Only these current public switches are accepted:

- `primary_numeric_arrays_enabled`
- `ordinary_set_fast_path_enabled`
- `dynamic_own_slots_enabled`

Unknown keys, non-boolean values, non-object JSON, malformed JSON and duplicate CLI options fail before generation writes. Key order is canonical. Omitted switches retain constructor defaults; omitted `--runtime-options` leaves the normal generated app and unit manifests unchanged. The program manifest gains `runtimeOptions` only when options were explicitly supplied. Its generator source fingerprint necessarily changes when the generator changes; preserving an old fingerprint would invalidate source provenance. When options are present, the runtime-options helper is included in manifest source fingerprints and the frozen build captures it automatically.

After full-workload A/B identifies the fastest faithful configuration, update an existing generated application without regenerating game units:

```sh
node tools/rust-port/generate-program.mjs --app-only --out work/rust-battle-full \
  --runtime-options '{"primary_numeric_arrays_enabled":false,"ordinary_set_fast_path_enabled":false,"dynamic_own_slots_enabled":true}'
node tools/rust-port/build-program.mjs --profile release --jobs 4 \
  --output benchmarks/validation/selected-options-build.json
node tools/rust-port/check-program.mjs --profile release \
  --binary work/rust-port-shared-target/release/rust-battle-program \
  --build-proof benchmarks/validation/selected-options-build.json \
  --output benchmarks/validation/selected-options-full.json
```

The flags above illustrate selection syntax; they are not a recommendation or a measured winner. The new binary must pass the complete reference gate before claiming throughput. The old binary/build proof does not qualify the new application.

`--app-only` reads the existing manifest, preserves its unit reports, verifies frozen JS and compiler fingerprints, and rejects changes to through/chunk-size/GC-cadence/native-GC configuration. It leaves unit crates, UTF-16 pools, unit manifests and workspace Cargo files untouched. The existing app Cargo/host files are rewritten only if their bytes differ; selecting runtime switches changes app `main.rs` and the program manifest. Cargo can reuse game/runtime libraries when their inputs and build settings are unchanged; this does not promise cache reuse after unrelated source or compiler changes.

The manifest records `reusedUnitsFromManifestSha256` for the first app-only update. Repeating app-only generation with unchanged inputs is byte- and mtime-idempotent. An app-only call without `--runtime-options` retains an existing selection; explicit `{}` restores constructor defaults while recording an explicit empty selection.

Diagnostic wrappers that construct their own `Runtime` must apply the same selected manifest options before claiming to profile or benchmark this application configuration. The component A/B driver intentionally overrides the three switches for each named variant.

The integration test generates a tiny JS fixture with both the preserved old generator and the new generator. It compares every default generated file, normalizes only the output path and actual generator fingerprint in the program manifest, verifies app-only changes and unchanged mtimes, checks idempotence, and rejects changed source/configuration. It does not execute a native battle.
