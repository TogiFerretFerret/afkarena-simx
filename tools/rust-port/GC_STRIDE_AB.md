The GC stride A/B tool links one derivative wrapper against the eight libraries from a completed full-battle build. Run from this tool's checkout with `--repository /workspace/afkarena-simx` to validate main's completed proof and use main's frozen libraries. The tool must be executed only after that full proof passes.

Example (replace the baseline path with the newly qualified report):

```
node tools/rust-port/benchmark-program-gc-strides.mjs --repository /workspace/afkarena-simx --baseline benchmarks/validation/rust-program-hot-execution-wave-full.json --strides 1,2 --trials 1 --run
```

Omit `--run` to link and archive preparation without executing battles. The runtime GC policy is configured before host installation and source execution. Constructor optimization flags remain unchanged; a nonempty manifest `runtimeOptions` field is rejected. Default variants are strides 1 and 2; explicit strides must be unique integers from 1 through 8.

At manifest cadence 2, the unchanged 23 total source battles request 12 collections. Stride 1 must record 12 requests and 12 actual collections; stride 2 must record 12 requests and 6 actual collections. Final collection remains mandatory. Both variants must match the complete Node report and host tape, retain source/build hashes, and print exact request and collection counts. Alternating trial order, sampled RSS, kernel VmHWM, and full raw outputs are archived. A single cohort is preliminary timing, and a longer stride can trade higher memory for less GC CPU. No speed claim follows from preparing the tool.
