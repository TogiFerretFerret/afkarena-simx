# Exact outer battle-loop safepoint

Collection is disabled in an ordinary `Runtime`. The compiler's `nativeBattleGc`
option also defaults to false. The verified seven-module program driver must opt
in explicitly after validating its frozen source inputs and root call site.

Only the complete `__nativeRun` source with SHA-256
`d7f91f446d24282b489ef9943494f0658f778232b5948d66b8d941d3f42e950d`
can receive a compiler hook. Its only direct outer `for` statement is:

```js
for (var battleIndex = -warmup; battleIndex < battles; battleIndex++) {
  // Unchanged original scenario construction, battle loop and result capture.
}
```

The hook runs after the body statement's Rust closure returns Normal and after
the completion match, before `battleIndex++`. Body temporaries, callback calls,
inner loops and any catch/finally work have completed. Break/return/throw paths
leave before this hook. The exact body contains no outer continue or pending
finally. The hook therefore runs after each of three warmups and twenty measured
battles in the original workload, including the last measured iteration.

All surviving source bindings are environment cells in the main compiler. The
function environment is passed explicitly as a root, including parameters,
materialized scenario, current/last engine, latest callback phase, result arrays,
checksum, loop index and helper closures. Cached BindingRefs refer to this same
rooted environment. The only outer loop-head SSA values are numeric bounds/index
and the Boolean test. The body closure does not return a heap Value on the Normal
path. Helper-split functions are excluded. A future context with promoted native
locals (`nativeBindingNames.size > 0`) suppresses this hook; environment-only
tracing cannot safely collect while those native Values are live.

The verified caller is the final top-level statement in frozen unit 6:

```js
void (__nativeResult = __nativeRun(
  __nativeRuntime, __nativeWire, 20, 3, __nativeWallNow, "final"
));
```

That script and its Rust helpers do not push JS call frames. Caller heap-valued
arguments are also stored in globals and the callee's parameter cells. The callee
FunctionId is an active runtime root. The assignment target is a global binding;
the report is constructed only after the loop. The caller therefore retains no
additional unrooted heap temporary across this exact backedge.

Runtime guards independently require one active JS frame, the exact function
source, global parent environment, integer numeric battle bounds/index and empty
construction/join stacks. Diagnostic wrappers add a second JS frame and skip
collection. Arbitrary host-held handles require explicit host roots. Collector
tracing must cover internal intrinsic caches, arguments maps, captured cells,
bound function values, native callback closures, views/backing buffers, accessors
and collection/ephemeron edges without invoking source getters, RNG or clocks.

The source text and `Function.prototype.toString` metadata stay unchanged. This
document proves only the placement/root contract; it does not establish collector
correctness, battle parity or benchmark speed. Those require native source gates
and the original complete battle workload.
