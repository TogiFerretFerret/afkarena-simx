These archives retain the actual host random/clock inputs, original-source reference,
emitted Node output, and emission metadata. JSON and output files use gzip; each
manifest records compressed and uncompressed SHA256 hashes and rebuild commands.
`tools/emit-native-oracle.mjs --host-inputs PATH.json.gz` replays these external
inputs and rejects extra or missing consumption.

| Fixture | What was checked | Reference profile |
| --- | --- | --- |
| `frozen-2026-observed-pinned` | Source versus emitted Node: complete terminal report, numeric bits, device/audio state, 296 ticks and 15,453 callbacks; 2 host random inputs and 260 clock inputs consumed | Pinned Node 24.19.0 `--jitless`, empty `NODE_OPTIONS` |
| `frozen-2026-broad-unpinned` | Source versus emitted Node with all battle definitions and conservative dependency closure: 49,353 factory functions across 25 units | Historical unpinned run |
| `frozen-2026-observed-native-unpinned` | Exact inputs and source output supporting the initial native diagnostic | Historical unpinned run |
| `frozen-2026-warm20-native-unpinned` | Exact inputs and source output supporting the warmed 20-battle native diagnostic | Historical unpinned run |

Newer diagnostic archives also include:

- `frozen-2026-warm20-pinned`: the exact 23-battle host input stream (3 warmups, 20 measured battles) and complete terminal capture used for the Rust bridge diagnostic.
- `frozen-2026-table-policy-pinned`: a complete battle with two explicitly mutable tables and 36 other tables protected against writes.
- `frozen-2026-eager-pinned`: the full original battle module executes eagerly, replacing the earlier lazy battle loader.
- `frozen-2026-capsule-pinned`: the same complete battle with tracked mutable table writes; the terminal report also matches the unwrapped eager source baseline.
- `frozen-2026-counter-initial-pinned`: startup graph including the observed private Cocos allocation counters, with 10,914 nodes and 32,834 code entries; zero battles completed.
- `frozen-2026-initial-global-descriptor-failure`: preserved failed startup graph comparison, exposing contextified global descriptor differences.
- `frozen-2026-initial-ordinary-global-passed`: passing startup graph comparison after the ordinary-global realm correction; 10,912 nodes and 32,828 code entries, with zero battles completed.

A recorded pinned profile is historical evidence for that archive, not automatic
qualification against later revisions of `config/source-oracle-runtime.json`.
Run `node tools/verify-native-fixtures.mjs` to check compressed/plain hashes,
input consumption, exact emitter snapshots, replay options against the captured source configuration, and the recorded Node comparison. Replay validation rejects omitted tracking/initialization modes and altered scenario or source-profile metadata.
Declared failed comparisons remain negative evidence.

Every fixture uses the frozen realistic level-360 A5 5v5 with gear, SI30, and one
beast per side. These are diagnostic fixtures, **not throughput qualification**:
actor/effect/view lifecycle remains excluded from their execution adapters, and
observed factory scope does not establish coverage of other team compositions.
Historical results are not upgraded by the later runtime pin. The pinned fixture
also includes the exact emitter source snapshot used for its source run.
