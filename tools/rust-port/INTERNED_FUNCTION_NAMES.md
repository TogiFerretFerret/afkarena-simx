# Interned captured function names

`FunctionRecord.name` uses the canonical immutable UTF-16 StringId already
stored in the function's initial own `name` descriptor. The captured internal
name stays distinct from later source writes, redefinitions and deletion of
that descriptor. Native and bound creation keep every descriptor and callback.
Bound Function.prototype.toString still uses its native-code rendering.

All internal name consumers are adapted: native toString, Error and Date
intrinsic dispatch, unsupported diagnostics, stack observer and source-proven GC
guard. Live Function records root their internal name IDs, including giant names
whose source `name` properties have been removed. Dead records use interned
empty names. The JS name remains raw UTF-16; the prior lossy internal rendering
is applied only when its original consumers require Rust text.

Validation passes 61 library and 26 integration tests; new coverage preserves a
giant captured name through 23 actual source safepoints after deleting own.name,
and distinguishes captured native names from replacement properties and bind
names. Pinned Node gates pass closures47, reflection24, Date36, Error40,
arguments40 and the trace-on/off diagnostic observer. Three preexisting V8 stack
operations remain explicitly unsupported. An initial diagnostic launch omitted
--jitless and was corrected; the failed launcher is retained.

The fixed warmed 10,000-function allocation diagnostic measures FunctionRecord
176 to160 bytes. Native function allocations fall30,005 to20,005; bound
allocations40,005 to30,005 and reallocations30,010 to20,010. These are allocation
counts, not CPU percentages or battles/sec. Complete battle qualification is
pending. The original Unit.update paired executable benchmark is preparation
only until a quiet measurement slot is released.

Evidence: `benchmarks/validation/rust-interned-function-names*.json` and unique
compressed reports, allocation logs, drivers and both complete runtime sources.

The quiet three-pair original Unit.update run passes all 150,220 ordered events
and selected state per trial. Throughput is 14,903.9 versus 14,791.3 updates/sec,
a 0.99245x ratio: no CPU improvement is established in this fixture. The
allocation and record-size reductions above remain measured independently.
Evidence: `2026-10-28T23-00-47.897Z-rust-function-names-unit-update.json`.
