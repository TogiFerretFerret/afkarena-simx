# Experimental dynamic own-data hints

The isolated candidate adds one bounded lookup table per Runtime, indexed by
canonical StringId. An entry stores only a physical property slot, encoded as
Option<NonZeroUsize>; 65,536 live entries contain at most 512 KiB of hint payload. Vec may retain
additional geometric spare capacity, so this is not a hard 512 KiB allocation
cap. Larger StringIds use
the original path. Objects gain no fields and hints hold no Values, object IDs,
function identities or GC roots. Key IDs are append-only.

The hook follows original receiver checks, primitive key coercion and the
existing typed numeric-index path. Every hit independently verifies that the
current receiver is an ordinary object or array, is not a function, has no
mapped argument bindings, and is not reading virtual array length. The current
physical slot must contain the exact key and a data descriptor; its current
Value is returned. The outer get diagnostic remains unchanged. Accessors,
prototypes, functions and exotic receivers retain the original execution path.

On a miss the entire original lookup executes, including all getters and
throws. Only afterward can the current own data descriptor populate a hint.
Changing layouts, deletion, descriptors or reused GC object IDs cannot make a
stale slot return a value for a different key. Ordinary hash lookup handles
misses; this is a lookup hint rather than a cache of semantic results.

The directed source gate runs the same generated entry with hints OFF and ON.
It covers key coercion side effects, accessor replacement, getter mutation,
layout changes, mapped arguments and virtual lengths. The paired component
fixture executes byte-identical original Buff.applyPercentValue and
Buff.applyFixedValue bodies, where dynamic attribute/map reads are frequent.
It observes raw values after the first 128 pairs and the complete terminal
attribute state. It does not replace those methods with algebra or omit their
callbacks. Component throughput cannot qualify full battles.

A separate possible experiment would place descriptor hints at the final
physical lookup in own_descriptor, after all virtual/mapped checks, covering
accessor descriptors as well. That alternative is not included here.

The controlled same-binary Buff component run observes 1.193x aggregate, with
round ratios 1.182x and 1.204x. An earlier potentially contended 1.142x sample is
also retained. All 256 observed prefix states and terminal state match Node in
every trial. Historical per-round fields `sipElapsedNs`/`fxElapsedNs` are legacy
names from the benchmark template: they mean hints OFF/ON here; both variants
use the same Fx string hash runtime. The primary rows label those variants
`baseline` and `cached`, and the explicit runtimeDynamicOwnSlots field is
false/true. No string hash policy changes between these arms.
