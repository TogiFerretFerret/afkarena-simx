`tools/battle-trace-portable.js` and `tools/battle-trace-instrumentation.js` are
injected verbatim in the source VM and compiled candidate. Instrumentation calls
each original method/callback exactly once. It records ordered callback, mechanic,
RNG, clock, device, and frame events. Every event covers the reachable descriptor
graph and payload numbers as raw binary64 bits, preserving aliases and identities.

Compact events use `sha256-merkle-v1`: each complete serialized node has a SHA-256
digest; the final digest covers roots, ordered node identities/digests, function
code digests, and declared graph boundaries. An unchanged node digest is reused
only after the exporter visits all children and verifies every current descriptor.
The Node oracle may use native crypto; the candidate uses the tested portable
SHA-256 implementation. Verbose traces retain full graphs for mismatch diagnosis.

The instrumentation reports its root contract. The default covers engine, queues,
loaded hero scripts, RNG, battle log, and device state. `programState: true` also
covers `ed`, `cc`, and the complete supplied source-global catalog without invoking
lazy getters. A comparison rejects different root contracts. Loader adapters need
explicit logical identities and source manifests; original game accessor code is
retained. Lexical closures and weak collections remain explicit boundaries.

Private table-cache state needs separate coverage. The optional immutable-reference
hook accepts metadata only from the qualification table membrane's private proxy
registry. Each leaf retains object identity, named-table path, type, and a digest
of the complete cold descriptor graph, including all numeric bits. The membrane
must reject every mutation operation and `assertClean()` must run at each event
and completion, so catching a write exception cannot qualify a battle. Raw parsed
table objects and membrane capabilities must remain outside game-visible globals.
An unenforced identity cache is insufficient to activate this hook.

`node tools/probe-portable-native.mjs` compiles actual exporter probes and compares
them with the pinned `--jitless` Node reference. The committed report confirms
finite values, infinities, signed zero, object aliases, source-function data,
Map/Set, typed buffers, and ordinary literal NaN. It still fails arbitrary scalar
NaN payload preservation in Static Hermes. The historical report retains the
literal NaN sign bug caught before its compiler fix. `--finite` selects the small
passing subset; neither command qualifies whole battles or measures throughput.

A completed matching trace is evidence for its stated roots and battle input.
It does not establish omitted host lifecycle phases, arbitrary closure state,
uncovered table mutations, a complete battle corpus, or 10,000 battles/second.
