The current isolated experiment uses two inline lookup entries, then promotes to the original integer-ID HashMap on the third distinct key. Default Cargo features remain empty: feature-off preserves the exact original public HashMap field type and Object layout. Observable JS enumeration still uses the unchanged physical property Vec; removing an index entry never compacts that Vec. Large clears retain capacity for GC reuse, and clone preserves physical indices.

Inline2 occupies40bytes versus32for the original map, so Object grows160→168bytes. The earlier inline4 experiment grew Object to200bytes and increased parsed-table memory; it is rejected and retained separately in SMALL_PROPERTY_INDEX_4.md.

Reliable allocation/retention measurements from both inline2 rounds:

| Component | Original | Inline2 |
| --- | ---: | ---: |
| Allocations per10,000original Unit.update calls | 2,138,984 | 1,993,874 |
| Retained live requested bytes after updates | 162,031,438 | 151,902,976 |
| Allocations parsing actual97MBtable | 15,384,493 | 15,193,076 |
| Retained live requested bytes after parse | 1,441,408,756 | 1,433,694,058 |

Unit.update throughput ratios were1.0621x and1.0013x; JSON parse ratios were0.9138x and1.1002x. These contended timings do not establish a repeatable speed gain. Both variants use the same atomic counting allocator, whose overhead can amplify allocation-saving speedups. Feature-on therefore remains experimental and disabled by default; no main integration or battle-throughput improvement is claimed.

All150,220ordered fixture events and selected state bits matched pinned jitless Node per unit trial. Parsed-table heap fingerprints matched across layouts, including physical property order, descriptors, raw numeric/string values, prototypes and IDs, with1,032,950objects. This verifies layout equivalence to the original runtime on this input, rather than independently qualifying every parsed value against Node. Feature-on passes50native library tests, including GC/reachability, map growth/deletion/clone/clear, reserve/get_mut/iteration, and property tombstone/descriptor checks.

Actual parsed-table property-count histogram (last bin means9or more):

| Properties | Objects |
| --- | ---: |
| 0 | 410,364 |
| 1 | 53,959 |
| 2 | 137,747 |
| 3 | 68,586 |
| 4 | 11,302 |
| 5 | 100,035 |
| 6 | 35,718 |
| 7 | 1,789 |
| 8 | 63,528 |
| 9+ | 149,922 |

About40%of table objects have no physical own properties, so increasing every Object's size matters even when no map allocation is avoided. Inline2 reduces retained memory by about10.13MB for the component fixture and7.71MB for the table; inline4 increased table memory despite fewer allocation calls.

The repository audit found property_index uses of get/insert/remove/clone/clear/len/is_empty/capacity/indexing; these remain supported. Iteration, reserve, mutable lookup and conversion from the original map are also supplied. Feature-off public Rust host compatibility is unchanged. Opting in changes the concrete field type; external hosts assigning HashMaps directly can use .into(). A complete HashMap API is not claimed.
