# Mapped argument lookup layout

`Object::arguments_map` now uses the existing `IdBuildHasher` for canonical
`PropertyKey(StringId(usize))` keys, matching the property lookup table.
The keys retain full equality checks. This removes the random hash seed fields
from every heap object, including the overwhelmingly common empty map.

Mapped arguments are consulted by key in reads, writes and descriptor changes.
Their map iteration is only used to trace string and environment roots. JavaScript
property enumeration still uses the ordered property vector, so hash iteration
order is not exposed. GC reaches the same fixed point regardless of traversal
order. Clearing pooled objects retains capacity as before.

This is a storage candidate until combined argument, GC and full-battle gates
pass. Throughput improvement has not yet been measured.
