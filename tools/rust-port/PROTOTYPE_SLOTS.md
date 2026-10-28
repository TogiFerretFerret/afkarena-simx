# Isolated prototype data cache candidate

The generic runtime leaves this optimization disabled. Audited generated hosts
may call `enable_trusted_generated_property_caches()` before running source.
While enabled, hosts must use the runtime property APIs rather than modifying
public property vectors/indexes directly. Call the disable method before raw
host writes; enablement rebuilds all current blooms. Default raw host writes
retain their existing behavior.

Each enabled object maintains a conservative 256-bit own-key bloom. Insertions
set both bits; deletion leaves bits set; pooled reset clears them. The audited
bulk property clone in copy_obj copies the bloom. Object.own keeps its original
hash lookup: a bloom prefilter there regressed the first component experiment.

A prototype entry accepts different receiver IDs sharing the same first
prototype. It verifies receiver own-key absence, every intermediate object's
own-key absence and current prototype edge, then the owner's current slot key
and Data descriptor. It reads the value fresh. Every involved object must be an
ordinary nonfunction object; arrays, accessors and other exotic chains fall
back. The path is capped at eight nodes. Cache references are weak locations:
current edges/keys/kinds/blooms make recycled IDs safe without retaining objects.
Existing own-slot caching remains unchanged.

Validation passed: 41 library tests, four existing own-slot tests, seven new
directed tests (including 23 GC/ID reuse rounds), 22 generated OFF/ON property
cases, 47 closure/receiver cases and 40 argument/reflection cases against pinned
Node. Source hashes remained fixed across each source gate.

The final component benchmark uses ten alternating receivers with 40 own
fields and 200,000 inherited reads per sample. Median baseline versus IC times
were 16.43 versus 3.73 ms at depth one, and 20.00 versus 4.14 ms at depth three.
All modes share candidate object layout; this is not a battle speed result.

The unchanged-source Unit.update paired benchmark matched every event and full
snapshot (15,024 events) but improved only 1.15% across three paired trials:
13,097 versus 13,248 updates/second. This is insufficient evidence to promote.
Object size also increases from 160 to 192 bytes, and the paired benchmark does
not measure original-layout memory overhead. Keep isolated pending broader
method-call workload evidence and real memory/throughput qualification.
