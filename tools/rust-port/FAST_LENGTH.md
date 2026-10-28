# Isolated virtual literal-length fast path

Array length, primitive String length and boxed String length are own virtual
nonconfigurable descriptors in this runtime. Their values are determined by
the current array length or UTF16 unit count; a prototype or raw property
container cannot replace them. The literal read path returns those values
before tickets, interning, own-slot caches or prototype lookup. Functions,
ordinary objects, typed arrays and every other property keep the existing path.

LiteralReadSite precomputes its length-name classification in its const
constructor. A default-true runtime switch enables same-binary comparisons
without disabling the existing own-slot cache. Checking the precomputed site
flag first avoids string comparisons on unrelated property reads. Diagnostics
still record exactly one get with the same receiver/key/result, and allocate
or intern the key only when tracing is enabled.

47 library tests, three focused tests and four existing slot tests pass. The
focused tests cover current growth/shrink/max lengths, surrogate UTF16 lengths,
positive zero bits, ordinary negative-zero fallback and23 collection/ID-reuse
rounds.27 generated source OFF/ON cases pass pinned Node, including readonly
length and prototype getter poison. Further broad gates are queued behind the
active real fork benchmark; no main changes or full-battle claim are made.

The same-binary original Unit.update benchmark runs3 alternating paired trials
of10,000 updates per mode. Every mode matches150,220 ordered events and full
state to pinned Node. Aggregate throughput was13,343 versus14,486 updates/sec,
but one baseline outlier inflates the8.57% aggregate difference: individual
paired improvements are about1.7%,23.1% and1.3%. Treat the stable observed gain
as modest and require additional evidence before projecting real battle speed.
The earlier regression report is retained: it motivated precomputing the site
classification rather than comparing text on every enabled read.
