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

The remainder cannot be subdivided from the retained timers. Startup work must
not be charged to every battle in a long-running worker. Parallel throughput
must not be reported as single-worker throughput.

Evidence: [full qualification](validation/rust-program-signed-camp-wave-full.json)
and [four-worker run](results/2026-10-30-signed-camp-wave-fork-four.json).
These bind the frozen signed-camp build, not subsequent main-branch changes.

## Existing measured CPU breakdown

The following is the older layout-wave profile, pending a fresh signed-camp
capture. It covers only the measured battle window, with startup and warmups
excluded: 2,663 samples at 99 Hz, zero lost samples. Percentages describe sampled
user CPU, not exact wall-clock durations or independently measured speedups.

| Disjoint native self-cost category | CPU share |
| --- | ---: |
| JavaScript semantics runtime implemented in Rust | 82.91% |
| Generated game-source functions | 9.76% |
| Unresolved symbols | 5.78% |
| Explicit allocation, collection and memory symbols | 1.01% |
| Other Rust/system code | 0.53% |

Allocator symbols alone do not measure the entire cost of allocation. Object
initialization, property insertion, retained memory, cache misses and subsequent
GC appear in other functions. Likewise, source function self time excludes the
runtime functions that source code calls.

### Largest exclusive operations

Duplicate code-generation-unit instances are merged by demangled symbol.
Rows below are self costs and do not include callees; they are selected entries,
not an exhaustive partition of the entire run.

| Operation | Self CPU | What it does |
| --- | ---: | --- |
| Literal property reads | 9.01% | Validates cached slots and routes misses |
| `Object::own` | 7.81% | Finds an object's own property |
| Generic `Runtime::get(Value)` | 6.31% | Routes dynamic property reads |
| GC `Trace::drain` | 5.93% | Traverses reachable runtime records |
| Property-index hash insertion | 3.53% | Maintains per-object key-to-slot maps |
| `call_value` | 3.34% | Dispatches dynamic function calls |
| `resolve_binding_id` | 3.15% | Resolves lexical/global bindings |
| Dynamic slot reads | 2.93% | Routes variable-key property accesses |
| Static string lookup | 2.82% | Resolves compiled string constants |
| Own-descriptor lookup | 2.78% | Resolves property descriptors |
| Object allocation | 1.99% | Allocates/reuses object records |
| Typed own-descriptor routing | 1.95% | Checks specialized receiver descriptors |
| Dictionary insertion | 1.88% | Adds property storage |

### Which game operations call into these costs?

These are **inclusive** stack shares. They overlap and must not be added.
For example, buff creation can execute inside `Unit.update` and contributes to
both rows. An inclusive constructor share is not time spent solely dispatching
that constructor.

| Source operation | Inclusive CPU |
| --- | ---: |
| `Unit.update` | 49.49% |
| `Unit.addBuff` | 33.35% |
| Cocos constructor, unit 0/function 1107 | 19.68% |
| `Unit.resetBuffApply` | 17.31% |
| `Buff.create` | 14.12% |
| Buff constructor | 11.60% |
| `createDataObj` | 10.66% |
| Callback drain, `__nativeDrain` | 7.25% |
| `copyObj` | 6.35% |

The constructor and override dispatch already have native specializations.
Callback draining executes game callbacks and snapshots used by the oracle;
its time cannot simply be removed as logging.

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

## Scope and reproducibility

- [Existing CPU capture](results/2026-10-29T00-36-36.007Z-rust-program-perf.json)
  and [source-stack attribution](results/2026-10-29T00-36-36.007Z-rust-program-perf.source-stacks.json).
- Full raw perf data, stacks and reports are retained as hashed gzip chunks.
- 568/2,663 samples lack a main/wrapper ancestor. This diagnoses missing ancestry,
  not a precise count of truncated stacks; inclusive attribution can be incomplete.
- Inlining attributes work to the containing linked symbol. Unresolved samples
  are retained instead of assigned invented owners.
- Profiles change timing and do not establish battles/second. Current main's
  newer function-own-property cache is not part of this older CPU capture.
- Fixed-fixture parity does not establish 20,000 random full-scene battle parity.
