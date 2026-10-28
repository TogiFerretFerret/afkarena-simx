The pinned JS reference changes NaN bits during ordinary array storage. The
Rust runtime currently preserves the input bits, so these are known fidelity
gaps to address if a battle reaches them. This probe makes no runtime changes.

Run `node --jitless tools/rust-port/probe-array-number-storage.mjs` with the
version in `config/source-oracle-runtime.json` and an empty `NODE_OPTIONS`.
The report records 37 operations, 18 raw bit patterns and four call histories,
with 24 calls per row in a fresh realm. NaNs enter as hexadecimal strings and
are decoded directly into the operation parameter; each input is checked
before storage. Exact outputs and source snippets are archived alongside the
[report](validation/pinned-array-number-storage.json).
Two separate process runs produced byte-identical reports and output archives.

For signaling input `7ff0000000000001`, the first call gives:

| Source operation | Output bits |
| --- | --- |
| `[x][0]` | `7ff8000000000001` |
| `a=[0]; a[0]=x; a[0]` | `7ff8000000000000` |
| `a=[0.5]; a[0]=x; a[0]` | `7ff8000000000001` |
| `a=[null]; a[0]=x; a[0]` | `7ff0000000000001` |
| `[].concat(x)[0]` | `7ff8000000000000` |
| `Array.from({0:x,length:1})[0]` | `7ff8000000000000` |

Prior calls also matter. For the same `a=[0]; a[0]=x` source, finite warmup
preserves the quieted payload, while prior null arguments preserve the
signaling payload. Repeated identical inputs can change output bits during
the recorded calls. The probe records those transitions without claiming
which internal V8 representation caused them. Negative zero retained
`8000000000000000` in every tested operation and history.
