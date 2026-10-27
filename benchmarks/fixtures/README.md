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

Every fixture uses the frozen realistic level-360 A5 5v5 with gear, SI30, and one
beast per side. These are diagnostic fixtures, **not throughput qualification**:
actor/effect/view lifecycle remains excluded from their execution adapters, and
observed factory scope does not establish coverage of other team compositions.
Historical results are not upgraded by the later runtime pin. The pinned fixture
also includes the exact emitter source snapshot used for its source run.
