The raw-bit reference profile is pinned in `config/source-oracle-runtime.json`:
Node v24.19.0, V8 13.6.233.17-node.51, Linux x64, `--jitless`, and empty
`NODE_OPTIONS`. Consumers must use and report that profile before claiming raw-bit
qualification. Existing results are not automatically requalified by this pin.

`node tools/probe-oracle-tiers.mjs work/component-verification/damage-primitives`
reproduces the experiment. It runs three fresh processes for each of default,
`--jitless`, and `--no-opt`, both cold and after two complete corpus warmups. Every
run uses the same compiled Rust binary and the same 20,000 adversarial inputs. The
tool asserts identical binary, input and Rust-output hashes across all 18 runs.
Original source bodies are hash-checked. Raw outputs are captured before the older
semantic-NaN comparison; the experiment compares those unmodified bits. Captures
remain under ignored `work/oracle-tier-probe/`.

The committed experiment found:

| Runtime flags | Cold hashes across 3 processes | Warm hashes across 3 processes |
| --- | ---: | ---: |
| default | 3 | 1 |
| `--jitless` | 1 | 1 |
| `--no-opt` | 2 | 1 |

All six `--jitless` processes had the same source-output hash. Warm default runs
matched it; warm `--no-opt` runs differed. `--no-opt` disables TurboFan but leaves
Maglev available in this V8 build, so it is insufficient for this profile.

All observed source-to-source differences were NaN bit patterns; RNG consumption,
callback order and other captured state matched. For example, `ed.fixProbability`
returned `7ff8000000000000` in cold default case 528 and `fff8000000000000` under
`--jitless`. The first cold default process differed from `--jitless` in 185 output
values. This is source-reference variability with an unchanged Rust executable.

Pinning the source does not fix Rust mismatches. Under this pinned profile, the same
adversarial runner has 348 raw NaN differences and remains unqualified for that
domain. The bounded-finite damage corpus separately passed all 20,000 cases under
`--jitless`. No NaNs were normalized to obtain either result.

Throughput runs can use the native candidate's normal optimized build. A source
performance baseline can also use different, explicitly reported flags, but that
timing must not silently redefine reference bit patterns. Qualification still
requires the candidate's complete traces to match the pinned source profile over
the stated battle domain. The probe establishes reproducibility only for its tested
corpus; it does not prove all JavaScript behavior or full-battle fidelity.
