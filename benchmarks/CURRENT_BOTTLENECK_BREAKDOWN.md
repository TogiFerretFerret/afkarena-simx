# Current native simulator bottlenecks

The latest retained CPU profile attributes **45.23% of sampled user CPU** to dynamic property and descriptor work. The latest qualified simulator adds the nested-copy shortcut; its new throughput is below. **3 and 10,000 battles/second remain unmet**.

## Current build and throughput

The throughput table binds frozen source **da74854**, including guarded nested copying. The original 20 measured battles and three warmups preserve complete reports, captured floating-point bits, RNG/clock host consumption and **309,060 callbacks**. The CPU tables later in this document retain the previous **7e718b1** profile; they have not been remeasured for the new shortcut.

| Unprofiled measurement | Result |
| --- | ---: |
| One worker, measured battle loop | 0.819269 battles/second |
| Four workers, aggregate | 2.633120 battles/second |
| One-worker measured loop, 20 battles | 24.412 seconds |
| Complete one-worker process | 31.200 seconds |
| Combined initialization, warmups and final-report remainder | 6.788 seconds |
| Four-worker measured window, 80 battles | 30.382 seconds |

The remainder cannot be charged to every battle in a persistent worker. It combines runtime/host setup, module initialization, warmups and reporting. Four-worker throughput is aggregate throughput.

The previous four-worker cohort measured 2.565778 battles/second. The new result is **2.6% higher in a separate cohort**, which does not establish a causal improvement. Each worker records **48,000 nested-copy attempts and hits inside the measured window**, excluding **7,200 startup/warmup hits**. Every fork child reports **12 actual collections**, with source GC cadence 2 and default request stride 1. Qualification passes 199 native tests, 29 source gates and four provenance tests.

Evidence: [full qualification](validation/rust-program-guarded-native-wave-full.json), [four-worker qualification](results/2026-10-30-guarded-native-wave-fork-four.json) and [combined source/generation contracts](validation/guarded-native-wave/result.json).

The subsequently merged [owner-percent extension](../tools/rust-port/OWNER_PERCENT_LOOP.md)
has 57 differential cases and strict component gains of 1.08–1.56×. It is not
included in this frozen whole-battle build. Actual measured battle admissions,
full-battle qualification and its effect on throughput remain pending.

## Latest retained CPU profile: previous source 7e718b1

This capture contains **7,880 samples at 299 Hz, zero lost samples**. Startup and three warmups are excluded through the original measured-window markers. TRACE0, the full report, raw bits, host tapes, 309,060 callbacks, 12 collections, its frozen build inputs and eight linked libraries all verify. Its percentages describe the previous build, not a new profile of da74854.

| Disjoint native self-cost group | CPU share |
| --- | ---: |
| Rust JavaScript semantics runtime | 83.60% |
| Generated source execution | 10.84% |
| Unresolved | 4.28% |
| Allocation, collections and memory | 0.93% |
| Other Rust and system code | 0.36% |

The complete operation partition assigns every sample to exactly one row. Percentages are rounded; categories use explicit symbol-name rules rather than hardware counters.

| Exclusive operation category | CPU share |
| --- | ---: |
| Property reads and descriptor routing | 36.83% |
| Other JavaScript semantics runtime | 13.15% |
| Generated source body | 10.84% |
| Property writes and key-index tables | 8.40% |
| GC and reachability | 8.13% |
| String and canonical-key work | 5.76% |
| Bindings and environments | 5.74% |
| Unresolved leaf | 4.28% |
| Calls, closures and arguments | 3.05% |
| Object allocation, container growth and memory | 2.92% |
| Other native/library/system code | 0.82% |
| Regular expressions | 0.09% |

Property reads and writes sum to **45.23%**. GC traversal is already included in the runtime group. Allocator symbols alone, or the object-allocation category alone, do not measure total allocation cost: construction, map updates, retained objects and subsequent scanning appear elsewhere. CPU-clock sampling includes on-CPU memory stalls; cache misses, bandwidth and branch misses were not measured.

### Largest merged self costs

Code-generation-unit instances are merged by demangled symbol. These selected rows exclude callees and are not another complete partition.

| Operation | Self CPU |
| --- | ---: |
| Literal property reads (`get_literal_cached_impl`) | 11.27% |
| Generic `Runtime::get(Value)` | 8.60% |
| `Object::own` | 6.93% |
| GC `Trace::drain` | 6.64% |
| Unresolved leaf | 4.28% |
| `resolve_binding_id` | 2.99% |
| Static string lookup | 2.99% |
| `call_value` | 2.89% |
| Own-descriptor lookup | 2.66% |
| Property-index hash insertion | 2.54% |
| Typed own-descriptor routing | 2.36% |
| Object allocation | 1.51% |
| Inner property-read routing | 1.47% |
| Property-index hash lookup | 1.27% |
| Binding reads | 1.15% |

The first three operations total **26.80% exclusive CPU**. The [complete matrix](validation/source-shortcut-bottleneck-matrix.json) retains all 455 merged self symbols and source-by-operation cross tables.

### Inclusive source costs

These shares include runtime callees and nested source functions. They overlap and **must not be added**; buff creation and callback work can already be inside an update subtree.

| Source operation | Inclusive CPU |
| --- | ---: |
| `Unit.update` | 50.71% |
| `Unit.addBuff` | 29.33% |
| `Puppeteer.Puppet_update` | 21.83% |
| Cocos `Class` constructor (0:1107) | 20.25% |
| `TwinsB.update` | 19.37% |
| `Unit.resetBuffApply` | 19.28% |
| `SBD.atk4_resetBuffApply` | 15.32% |
| `Skill.update` | 11.98% |
| `createDataObj` | 10.55% |
| Callback drain, `__nativeDrain` | 7.55% |
| `copyObj` | 6.26% |
| `applyBuffEffects` | 6.18% |

### Nearest source ownership

Each sample is assigned to its nearest generated source frame. This ownership is disjoint and includes runtime work, while excluding work owned by nested generated functions. It differs from native function self time.

| Nearest source owner | CPU share |
| --- | ---: |
| `__nativeRun`, largely GC | 8.97% |
| `Unit.resetBuffApply` | 6.97% |
| `copyObj` | 6.26% |
| `Unit.update` | 5.58% |
| `createDataObj` | 4.68% |
| Source snapshot wrapper (6:3689) | 3.10% |
| `applyBuffEffects` | 2.89% |
| `Skill.update` | 2.87% |
| `Buff.applyPercentValue` | 2.37% |
| `Buff.applyEffect` | 2.23% |
| `__nativeDrain` | 2.09% |
| `Unit.addBuff` | 2.06% |

Inside inclusive 'Unit.update', literal reads account for 7.69% of all sampled CPU, generic reads 5.18% and own-property lookup 4.16%. These are subsets of its 50.71% inclusive share, not additional costs. Callback drain and source snapshots participate in the faithful fixture; removing them would change the measured workload.

The measured profile window contains approximately **26.355 seconds of estimated sampled user CPU over 26.810 seconds of wall time (98.3%)**. This supports CPU work as the immediate bottleneck in this capture. It does not distinguish instructions from on-CPU memory stalls, and profiled timings are not an unprofiled throughput benchmark.

## What to target next

1. Reduce repeated property reads, descriptor routing and key-index work in the measured update and buff paths. Guard source-proven shapes while preserving getters, prototype mutation, property order and fallback behavior.
2. Reduce object/property construction and copying where actual inputs qualify. Reuse immutable battle configuration where semantics permit; validate full workloads before claiming an allocation reduction improves speed.
3. Reduce dynamic calls and binding work only where source and reflection rules permit. Inclusive call-stack presence is not dispatch self cost.
4. Reduce transient graph size and redundant GC roots. The stride-two experiment was slower and used more memory, so the default policy remains.
5. Rank further arithmetic/compiler work by measured source coverage. The small vector/scalar pattern inventory does not support predicting thousands of battles/second from isolated array elision.

The allocation-saving object-header/lazy-index candidate regressed isolated Unit timing by roughly 10%; it remains **isolated and rejected**, outside this build. The broader nested-copy candidate has source/native qualification on its branch but is **not enabled in this qualified main build and has no qualified whole-battle gain**.

## Compiler changes already included

The source-pinned Babel pass scalar-replaces one nonescaping two-element 'B' array in 'Unit.update': four reads, two truthiness reads, diagnostics fallback at entry and a stable host-diagnostics contract. Its original-source component improves **4.3%**, eliminating 10,000 arrays per 10,000 fixture updates. The TRACE1 fallback preserves original arrays and receiver diagnostics. See [pass qualification](../tools/rust-port/SCALAR_LOCAL_ARRAYS.md) and [coverage inventory](../tools/rust-port/SCALAR_ARRAY_INVENTORY.md).

The primitive-copy expansion improves the original 'createDataObj' controller on a real flat 13-field 'UnitRank' record by **2.05×**. This is a cold configuration-copy scope. Real nested buff parents remain outside that flat domain, and Unit/drain controls contain zero copy calls. It is not a hot-buff or whole-battle gain. See [actual eligibility and component timings](../tools/rust-port/COPY_PRIMITIVES_BENCHMARK.md).

The function-own-property cache is also included. Component wins do not multiply into a predicted battle rate; the full and four-worker measurements above remain the acceptance evidence.

## Historical allocation evidence

An **older, separately instrumented build** measured **4,288,855 allocations and 185,910 reallocations per battle**. These are not current-build counters, CPU percentages or live-memory measurements. Current allocation volume has not been remeasured. See [historical allocation evidence](results/2026-10-28T21-22-31.989Z-rust-measured-allocations.json). Earlier profile/throughput evidence is kept separately in [the historical layout report](CURRENT_LAYOUT_PROFILE.md).

## Scope and reproduction

- [Current CPU capture](results/2026-10-30T16-54-08.837Z-rust-program-perf.json), [source-stack attribution](results/2026-10-30T16-54-08.837Z-rust-program-perf.source-stacks.json) and [complete matrix](validation/source-shortcut-bottleneck-matrix.json) all bind current 7e718 source/manifests. The older 8fe capture predates these compiler/cache changes.
- All raw observations are retained as hashed gzip chunks. Verified raw-only cleanup journals record exact reconstruction hashes; binaries, libraries, source inputs and compressed evidence remain.
- 1,299/7,880 samples lack a main frame; 163 lack a known run-wrapper frame. These diagnose missing ancestry, not an exact count of truncated stacks. All samples retain a generated-source ancestor, but inclusive attribution can still be incomplete.
- Inlined work belongs to its containing linked symbol. 337 unresolved leaves remain unassigned rather than receiving invented owners. User-only call chains avoid kernel-callchain permission requirements.
- Fixed-fixture parity is not qualification across 20,000 random full-scene battles. Profiling does not establish a new battles/second claim.

Further compiler work is tracked in the [implementation roadmap](../tools/rust-port/COMPILER_ROADMAP.md).
