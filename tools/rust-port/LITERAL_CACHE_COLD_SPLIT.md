# Literal cache hot and cold paths

Candidate source `6821665`, baseline `6369efc`. Only `property_slots.rs` changes. The same ticket initialization fetch-add/CAS, cache growth, key interning, generic get, and post-getter cache learning are outlined with `#[cold] #[inline(never)]`. Existing hot own-data, virtual-length, prototype guards, diagnostics and fallback behavior remain. There are no additional Runtime/Object fields, ticket loads, or accepted guard domains.

Release gates: 90 library and 26 integration tests; 24 one-hop source cases with `RUST_PORT_TRACE=1`, 24 reflection cases, 19 literal-slot cases, and diagnostics raw-key/key-coercion/source-frame checks pass. Logs and source hash are archived in `benchmarks/validation/literal-cold-split`.

Prepared original-source Unit.update and copyObj fixtures compare two frozen runtime snapshots, identical generated code, opt-level 3 / 64 codegen units / no LTO. Twelve alternating native processes completed all 36 trials, exit zero, with unchanged source/binary hashes. The Node oracle matches every Unit ordered callback and final state, and copy final ordered Number bits. Each copy trial performs 23 actual source-triggered collections. Intermediate copy state is not traced.

Aggregate Unit throughput increases 1.10747× (12,085.6 to 13,384.4 updates/sec); copy 1.08315×, or 1.09639× including GC. Unit pair ratios are 1.2671, 1.0866, 0.9952; copy pair ratios 1.0504, 1.1991, 1.0056. This spread limits precision; whole-battle qualification remains necessary. Component operations/sec are not battles/sec.

Report: `benchmarks/results/2026-10-30T13-47-51.664Z-rust-compact-properties.json`. The inherited report variant name `compact` denotes this cold-split candidate, and its inherited descriptor-representation wording does not describe the change. Both runtimes use the same 24-byte properties and 160-byte Object. The archived runtime snapshots identify the exact source difference.

Reproduce preparation with `node --jitless tools/rust-port/benchmark-literal-cold-components.mjs --prepare-only`; reserve CPU for `node --jitless tools/rust-port/run-literal-cold-prepared.mjs`; analyze afterward with the benchmark tool and `--analyze-recorded`.
