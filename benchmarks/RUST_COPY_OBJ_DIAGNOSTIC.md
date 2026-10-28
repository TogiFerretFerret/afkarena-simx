# Real-battle copyObj diagnostic

The [instrumented battle](results/2026-10-28T19-18-00.655Z-rust-copy-obj-battle.json)
calls the existing released `ed.copyObj` unchanged through a diagnostic wrapper.
It matches every non-timing final-report field against pinned Node, including
ClassManager counters. The
[separate host audit](validation/rust-copy-obj-battle-host-audit.json) also matches
the original prefix: 260 consumed clock inputs and two random inputs, with the
remaining 5,720 clock entries intentionally unconsumed.

| Input category | Calls | One additional object | More than one |
| --- | ---: | ---: | ---: |
| Empty arrays | 15,752 | 15,752 | 0 |
| Flat objects with 47 finite numeric fields | 2,387 | 2,387 | 0 |
| Other flat finite numeric objects | 40 | 40 | 0 |
| Other shapes | 2,808 | 0 | 2,808 |
| Total | 20,987 | 18,179 | 2,808 |

The one-object signature covers 86.62% of calls. It is evidence of likely native
admission, not an internal guard-hit counter. Every observed intrinsic descriptor
matches its initial value. Eligible numeric objects and empty arrays show no
unexplained fallback signature. Lexical environment internals were not inspected.

There are 4,903 top-level calls, with recursion reaching depth two. Their original
function calls take 262 ms within a 5.750-second diagnostic battle, about 4.56%.
The timer includes nested observer overhead; recursive inclusive row times
overlap. Most remaining clone time belongs to mixed 72-field objects with 41
finite numeric fields and standard data descriptors. These calls correctly take
the general recursive path.

The instrumented 0.176 battles/second is a cold, contended diagnostic, not a
promoted speed result against the uninstrumented 0.158 baseline. The wrapper
changes function identity; the retained final-report and ClassManager comparisons
detect no effect in this fixture. This does not qualify intermediate-state
tracing or a wider corpus. The tool compiles only its small app against the
SHA-pinned release libraries and never rebuilds the working runtime:

```sh
node tools/rust-port/diagnose-copy-obj-battle.mjs
```
