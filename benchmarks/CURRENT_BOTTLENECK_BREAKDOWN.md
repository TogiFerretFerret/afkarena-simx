# Native simulator bottleneck breakdown

The largest measured cost is implementing dynamic JavaScript operations inside
Rust: property access, descriptors, object storage, calls and lexical bindings.
The native executable still performs those operations dynamically. Compiling the
source into Rust has not yet produced a compact, statically typed battle core.

## Throughput and wall time

The latest qualified signed-camp fixture completes 20 measured battles after
three warmups with 309,060 callbacks. Reports, RNG/clock host consumption and
captured terminal floating-point bits match the JS reference.

| Measurement | Result |
| --- | ---: |
| One worker, measured battle loop | 0.582225 battles/second |
| Four workers, aggregate | 2.537886 battles/second |
| One-worker measured loop, 20 battles | 34.351 seconds |
| Complete one-worker process | 42.455 seconds |
| Startup + three warmups + final reporting, combined remainder | 8.104 seconds |

The original unprofiled remainder cannot be subdivided from its retained timers.
The new diagnostic driver adds source-neutral per-module elapsed markers. In
that profiled run, modules 0–5 initialize in approximately **0.214 seconds**;
module 6 spends approximately **7.375 seconds before the measured window**
(module setup plus three warmups), **31.462 seconds in the measured window**,
and **0.130 seconds afterward**. These diagnostic timings are from a different
run and must not be substituted into the unprofiled 42.455-second result. Setup
and warmups inside module 6 still cannot be separated from these markers alone.
Startup work must not be charged to every battle in a long-running worker.
Parallel throughput must not be reported as single-worker throughput.

Evidence: [full qualification](validation/rust-program-signed-camp-wave-full.json)
and [four-worker run](results/2026-10-30-signed-camp-wave-fork-four.json).
These bind the frozen signed-camp build, not subsequent main-branch changes.

## Fresh measured CPU breakdown

The signed-camp profile covers only the measured battle window, with startup
and warmups excluded: **15,388 samples at 499 Hz, zero lost samples**. The full
report and host-input consumption match JS again, all frozen build inputs and
eight linked libraries verify, and 12 GC collections occur. Percentages describe sampled
user CPU, not exact wall-clock durations or independently measured speedups.

| Disjoint native self-cost category | CPU share |
| --- | ---: |
| JavaScript semantics runtime implemented in Rust | 83.18% |
| Generated game-source functions | 11.23% |
| Unresolved symbols | 4.09% |
| Other classified allocator, collection and memory symbols | 0.92% |
| Other Rust/system code | 0.58% |

Allocator symbols alone do not measure the entire cost of allocation. Object
initialization, property insertion, retained memory, cache misses and subsequent
GC appear in other functions. Likewise, source function self time excludes the
runtime functions that source code calls.
GC traversal is already included in the runtime category; the 0.92% row is not
the total cost of memory management. Software CPU-clock sampling also includes
on-CPU memory stalls without distinguishing them from computation. Cache misses,
instruction counts, branch misses and memory bandwidth were not measured, so
allocation or RSS reductions alone do not establish improved cache behavior.

The complete symbol-based operation partition is below. Every sample belongs
to exactly one row; naming rules are explicit in the analyzer, so these remain
operation-classification estimates rather than hardware event measurements.

| Exclusive operation category | CPU share |
| --- | ---: |
| Property reads and descriptor routing | 37.32% |
| Other JavaScript semantics runtime | 12.83% |
| Generated source body | 11.23% |
| Property writes and key-index tables | 8.14% |
| GC and reachability | 7.70% |
| Strings and canonical keys | 6.03% |
| Bindings and environments | 5.91% |
| Unresolved leaf | 4.09% |
| Object allocation, container growth and memory | 3.29% |
| Calls, closures and arguments | 2.53% |
| Other native/library/system code | 0.86% |
| Regular expressions | 0.05% |

Property reads and writes together account for **45.46%**. This is the broadest
measured target for compiler specialization. Allocation-related work is spread
across several categories; the 3.29% row is not a complete allocation budget.
All **608 merged self symbols**, nearest-source owners and owner-by-operation
cross tables are in the [complete matrix](validation/signed-camp-bottleneck-matrix.json).

### Largest exclusive operations

Duplicate code-generation-unit instances are merged by demangled symbol.
Rows below are self costs and do not include callees; they are selected entries,
not an exhaustive partition of the entire run.

| Operation | Self CPU | What it does |
| --- | ---: | --- |
| Literal property reads | 11.18% | Validates cached slots and routes misses |
| Generic `Runtime::get(Value)` | 9.57% | Routes dynamic property reads |
| `Object::own` | 7.07% | Finds an object's own property |
| GC `Trace::drain` | 6.28% | Traverses reachable runtime records |
| `resolve_binding_id` | 3.13% | Resolves lexical/global bindings |
| Static string lookup | 2.86% | Resolves compiled string constants |
| Property-index hash insertion | 2.57% | Maintains per-object key-to-slot maps |
| Own-descriptor lookup | 2.50% | Resolves property descriptors |
| `call_value` | 2.40% | Dispatches dynamic function calls |
| Typed own-descriptor routing | 2.39% | Checks specialized receiver descriptors |
| Object allocation | 1.74% | Allocates/reuses object records |
| Inner property-read routing | 1.51% | Handles prepared property keys |
| Binding reads | 1.33% | Reads resolved binding values |
| String interning | 1.20% | Resolves dynamic string identities |
| Dictionary insertion | 1.16% | Adds property storage |

The first three operations alone account for **27.82% exclusive CPU**. Adding
GC arena collection (0.83%) and trace initialization (0.58%) to trace draining
gives **7.70% in identified GC functions**, excluding their generic callees.

### Which game operations call into these costs?

These are **inclusive** stack shares. They overlap and must not be added.
For example, buff creation can execute inside `Unit.update` and contributes to
both rows. An inclusive constructor share is not time spent solely dispatching
that constructor.

| Source operation | Inclusive CPU |
| --- | ---: |
| `Unit.update` | 51.28% |
| `Unit.addBuff` | 30.26% |
| `Puppeteer.Puppet_update` | 22.32% |
| Cocos constructor, unit 0/function 1107 | 20.55% |
| `TwinsB.update` | 18.53% |
| `Unit.resetBuffApply` | 18.39% |
| `Buff.create` | 14.71% |
| Buff constructor | 12.43% |
| `Skill.update` | 12.22% |
| `createDataObj` | 11.40% |
| Callback drain, `__nativeDrain` | 7.01% |
| `copyObj` | 6.52% |

The constructor and override dispatch already have native specializations.
Callback draining executes game callbacks and snapshots used by the oracle;
its time cannot simply be removed as logging.

### Nearest source owner: separating nested game functions

Assigning each sample to its nearest generated source frame gives disjoint
ownership, including runtime callees but excluding samples owned by nested
generated functions. This is useful for choosing compiler regions; it is not
the same thing as the generated function's native self cost.

| Nearest source owner | CPU share |
| --- | ---: |
| `__nativeRun`, largely GC | 8.38% |
| `Unit.resetBuffApply` | 6.61% |
| `copyObj` | 6.52% |
| `Unit.update` | 6.26% |
| `createDataObj` | 5.21% |
| `Skill.update` | 3.05% |
| `applyBuffEffects` | 2.61% |
| `applyEffect` | 2.33% |
| Buff percent application | 2.29% |
| `Unit.addBuff` | 2.05% |
| `__nativeDrain` | 2.02% |

Within inclusive `Unit.update`, literal reads alone consume **7.79% of all CPU**,
generic reads **5.94%**, and own-property lookup **4.43%**. Those are subsets of
the 51.28% inclusive row, not additional costs. In `Unit.addBuff`, the respective
whole-profile shares are 2.33%, 2.72% and 2.22%; these overlap the Unit subtree.

The profiled interval contains approximately 30.84 seconds of sampled user CPU
over 31.46 seconds of wall time (98.0%). This supports CPU work as the immediate
bottleneck for this single-worker capture; it does not distinguish instructions
from on-CPU memory stalls.

## Optimization order supported by this evidence

1. **Reduce repeated property and descriptor work.** Measure actual eligible
   shapes, keys, cache hits and fallback reasons; specialize source-proven
   records while preserving getters, prototype changes and property order.
   Several separate property-read operations dominate the self-cost list.
2. **Reduce object/property construction and improve locality.** Target buff
   construction, data-object creation and copying; keep immutable configuration
   reusable and reduce allocation/header/map overhead. Validate actual update
   workloads: the lazy small-property index saved allocations but regressed
   isolated Unit timing by roughly 10%, so it remains unmerged.
3. **Reduce dynamic calls and binding resolution where source proves it safe.**
   Resolve stable lexical locations and preserve original argument/reflection
   behavior. Inclusive call-stack presence is not dispatch self cost.
4. **Reduce graph-scanning cost by reducing transient records and redundant
   roots.** Merely collecting less often is not a demonstrated win: the full
   stride-two experiment was slower and used more memory than the default.
5. **Consider arithmetic batching only after measuring eligible coverage.** The
   existing source audit attributes less than 1% inclusive CPU to selected pure
   vector helpers in this fixture. A fast vector kernel alone cannot remove the
   dominant dynamic object/runtime work.

Use whole-battle A/B timings to accept changes. Improving a 5% self-cost region
by 2x yields at most about 2.6% overall speedup if everything else stays equal.
That is a budgeting calculation, not a performance prediction. Reaching 10,000
battles/second will require much broader changes than isolated small helpers.

## Allocation volume: historical evidence, not current-build counters

An older, separately instrumented warm 20-battle run measured **4,288,855
allocations and 185,910 reallocations per battle**. Fresh allocation requests
were 110.284 MB/battle; requested replacement capacities for reallocations were
168.543 MB/battle. Their combined 278.828 MB/battle is allocation traffic, **not
live memory**, and does not imply that reallocations copied that many bytes.
Later storage and lowering changes mean these counts must not be presented as
current signed-camp allocation rates.

Its 654 periodically sampled allocation stacks attributed 52.9% to builtin key
conversion, 22.2% to `Runtime::to_string`, 8.56% to array operations and 5.35% to
`parse_int`. These percentages describe allocation-count samples, not CPU time
or allocated-byte shares. The current CPU capture, rather than these historical
allocation samples, determines present optimization priority.

Evidence: [allocation counters](results/2026-10-28T21-22-31.989Z-rust-measured-allocations.json).

## Scope and reproducibility

- [Fresh CPU capture](results/2026-10-30T15-53-20.929Z-rust-program-perf.json)
  and [source-stack attribution](results/2026-10-30T15-53-20.929Z-rust-program-perf.source-stacks.json).
- Full raw perf data, stacks and reports are retained as hashed gzip chunks.
- 2,504/15,388 samples lack a main/wrapper ancestor. This diagnoses missing ancestry,
  not a precise count of truncated stacks; inclusive attribution can be incomplete.
- Inlining attributes work to the containing linked symbol. Unresolved samples
  are retained instead of assigned invented owners.
- Profiles change timing and do not establish battles/second. Current main's
  newer function-own-property cache is not part of this signed-camp capture.
- The first fresh profiling attempt was rejected by kernel permissions because
  perf requested kernel call chains. Explicit `--user-callchains` resolved the
  failure; the successful capture measures user-space CPU only.
- Fixed-fixture parity does not establish 20,000 random full-scene battle parity.

Compiler work following this profile is described in the
[implementation roadmap](../tools/rust-port/COMPILER_ROADMAP.md).
