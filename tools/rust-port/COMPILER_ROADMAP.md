# Compiler roadmap after complete native execution

The compiler already lowers all 22,986 functions into Rust. Babel parses and
analyses source at build time; it is absent from native battle execution.
The next compiler work should reduce the JavaScript operations emitted by that
lowering while preserving their observable behavior.

The [qualified bottleneck breakdown](../../benchmarks/CURRENT_BOTTLENECK_BREAKDOWN.md)
records 15,388 warm-window CPU samples: semantics runtime 83.18%, generated game
functions 11.23%, unresolved 4.09%. Literal reads (11.18%), generic property reads
(9.57%) and own-property lookup (7.07%) justify prioritizing representation and
property-operation elimination. These are sampled self costs; overlapping
inclusive source rows must not be added.

## Existing compiler foundation

[`compile.mjs`](compile.mjs) uses Babel parser/traverse, then
[`expressions.mjs`](expressions.mjs) and [`statements.mjs`](statements.mjs) emit
Rust. [`bindings.mjs`](bindings.mjs) analyses stable local bindings and shadowing.
Current passes include:

- Cached local bindings, canonical environment-name IDs and static UTF-16 literals.
- Native local/immutable parameter storage, with activation elision under explicit
  restrictions for captures, implicit arguments, eval and declarations.
- Guarded numeric operations, numeric literal keys and literal property-slot reads.
- Source-hash-bound substitutions for selected copies, constructors, dispatch,
  parsing, buff loops and battle GC safe points.
- Large-function and workspace partitioning to keep Rust compilation feasible.

The emitted manifest records pass options, source ranges/hashes, selected
specializations, native bindings and explicit unsupported bodies. Compilation
coverage is separate from runtime qualification.

## Intermediate representation and first useful transformations

1. **Introduce a small effect-aware operation representation.** Retain current
   evaluation order while representing binding reads, property reads/writes,
   calls, allocations and control edges explicitly. Attach source ranges and
   operations that may invoke user code, throw, allocate or expose references.
   First emit the same Rust operations and require unchanged differential output.
2. **Scalar-replace proven local temporary records.** Start with freshly created
   objects whose references never escape, whose keys are statically known and
   whose descriptors/prototypes are never observed. Keep values as binary64 or
   existing tagged values unless stronger facts are proved. Reject eligibility
   on unknown calls, alias stores, reflection, eval, enumeration or accessor paths.
3. **Fuse repeated property operations inside a proved region.** Carry validated
   owner/slot facts across operations only while no intervening effect can alter
   the owner, prototype, descriptor or relevant binding. Coercion and getter
   evaluation remain ordered effects. A failed guard executes the original
   operation sequence before any irreversible optimized effects occur.
4. **Specialize stable mechanics at function boundaries.** Use the original
   source hash plus explicit input/storage guards to select compact records or
   batched numerical operations. Preserve object identity, property enumeration,
   callback order and exact RNG consumption wherever the source observes them.
   Keep generic runtime paths for unsupported shapes.

The local-temporary transformation is small enough to evaluate before designing
a whole typed battle engine. Broader record specialization needs field/alias
and mutation evidence from real battles, including rare descriptor changes.
Matrix, SIMD or GPU work needs an independent-battle or independent-operation
proof; regrouping floating-point reductions can change binary64 results.

## Acceptance and measurement

For each pass, retain a manifest entry explaining eligibility and rejected
reasons. Test mutation, aliases, getters, prototypes, exceptions, implicit
arguments, coercions and NaN payloads. Compare ordered events and snapshots with
raw number bits where observed. Then compare complete Node reports and host
input tapes for the original 20 measured/3 warmup workload, with build/input
provenance and actual mechanic admission counters.

Use an optimized/reference toggle in the same linked binary and alternate
measurement order under the exclusive timing lock. Record compile time,
allocation traffic, resident memory and complete-battle throughput separately.
Component gains require a subsequent complete-battle measurement before promotion.
Keep failed and regressing trials published.

The current fixed-fixture qualification is 0.582225 serial and 2.537886 aggregate
battles/second. Neither 1,000 nor 10,000 battles/second follows from this plan.
Even an impossible removal of the entire measured 83.18% runtime category would
bound that particular serial workload to about 5.95× speedup if all remaining
cost stayed fixed. Reaching thousands requires much broader reductions and
fresh measured evidence. Random 5v5 corpus qualification remains separate from
repeating this one fixed fixture.
