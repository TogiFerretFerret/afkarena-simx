# Compact property storage candidate

The public `Descriptor` / `PropertyKind` / `Value` APIs remain Copy and retain
their existing types. Object dictionaries instead hold a physical vector of
24-byte `StoredProperty` entries: canonical key, a 64-bit payload, and flags.
The original optional key/descriptor entry occupies 56 bytes on this host.
This reduces entry bytes by 57.1%, while an optional per-object accessor arena
adds eight bytes to Object (expected 152 to 160 bytes; paired executable layout
measurements are retained with the component result).

The tag is independent of the payload: Undefined, Null, Bool, Number, String,
Object, Function or Accessor. Number payloads use `to_bits` / `from_bits` with no
arithmetic or NaN boxing. All 64 Number bits remain available, including signed
zero, signaling NaNs and payloads. Attribute bits encode writable, enumerable
and configurable. A separate tombstone bit preserves physical indices, holes
and insertion order after deletion.

Accessor descriptors reference a slot in
`Option<Box<Vec<Option<(Option<Value>, Option<Value>)>>>>`. Accessor replacement
reuses its slot; changing to data or deleting clears the old slot. New accessors
reuse empty holes before extending the arena. Reuse clears the arena logically
while retaining allocated capacity. Cloning property storage copies both the
physical entries and arena, preserving accessor identities and descriptor flags.

`iter_properties` decodes live entries only. Garbage collection traces these
live descriptors rather than scanning the arena, so unused bytes cannot retain
WeakMap keys or alias newly reused IDs. The source-qualified regression test
runs 23 original GC safepoints, retaining a live owner/getter while replacing and
deleting dead getters/setters, checking WeakMap pruning and ID reuse. It also
plants unreachable nonempty arena slots to prove physical stale handles remain
untraced.

Every cache hit still checks the current physical key and descriptor tag.
`data_slot` returns only current data Values; `set_existing_data_slot` additionally
checks writable. Reflection, enumeration, mapped arguments, primary numeric
arrays, native dense shift, copyObj, Buff writes and reachability use the new
helpers. Primary numeric arrays remain separate authoritative virtual entries.
No source callbacks, RNG operations or mechanics are removed.

Initial qualification passes 80 library tests plus 26 integration tests. Broad
source-oracle gates and paired component evidence are recorded separately.
This candidate is isolated until it passes those gates and an actual complete
battle comparison. Storage size and component rates do not qualify as battle
throughput.

`benchmark-compact-properties.mjs` freezes the complete baseline runtime at
`1aaeea3` and the compact runtime into independent source trees, compiling both
against the same generated original Unit.update and copyObj fixtures. Both use
opt3, CGU64 and LTO off. Unit trials retain every ordered callback and selected
raw-bit state. Copy trials retain every fresh source-visible output and run 23
exact-source GC safepoints, checking ordered final raw bits and destination ID
reuse. All frozen runtime sources, generated code and expected/actual payloads
are archived with hashes. Copy intermediate outcomes are not traced.
