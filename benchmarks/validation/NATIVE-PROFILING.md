Run `node tools/bootstrap-native-profiler.mjs` to extract SHA-pinned Debian perf
and its missing libraries into `work/downloads/perf`, without installing packages
globally. The launcher `work/downloads/perf/perf` sets its private library path
and preserves any existing private VM library path.

Collect a separate diagnostic execution after timing runs finish, for example:

```sh
work/downloads/perf/perf record -e cpu-clock:u -F 99 --call-graph dwarf,16384 -o work/native-profile.data -- work/native-candidate -Xhermes-internal-test-methods
work/downloads/perf/perf report --stdio -i work/native-profile.data
```

Use the exact candidate arguments, private VM environment and input paths recorded
by its result. Archive the profile command, executable/VM/input hashes and text
reports. Profiling overhead is excluded from throughput comparisons. The software
user CPU clock works in this environment; kernel/hardware events may have
different permissions. The package version and perf's reported version differ;
both are retained in `native-profiler-bootstrap.json`.
