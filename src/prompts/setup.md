# Autoresearch Setup Phase

You are setting up an autoresearch experiment. The project should already have (or you should create) an `autoresearch.sh` script that serves as the benchmark harness.

## Requirements for autoresearch.sh

1. **Print metrics in `METRIC name=value` format** — one per line
   Example:
   ```
   METRIC compile_time=1200
   METRIC binary_size=45000
   ```

2. **Optional: Print ASI (Agent State Info) in `ASI key=value` format**
   Example:
   ```
   ASI hypothesis=reduced_loop_iterations
   ASI next_action_hint=try_unrolling_factor_4
   ```

3. **Exit with code 0 on success**, non-zero on failure

4. **Be deterministic** — same code should produce same metrics

## Setup Steps

1. Check if `./autoresearch.sh` exists
2. If not, create it with an appropriate benchmark for the project
3. Ensure it prints at least one `METRIC` line
4. Test it with `bash autoresearch.sh`
5. Once working, call `init_experiment` to start the autoresearch loop

## What to Benchmark

- Compile time: `METRIC compile_time_ms=<milliseconds>`
- Runtime performance: `METRIC execution_time_ms=<milliseconds>`
- Bundle size: `METRIC bundle_size_bytes=<bytes>`
- Memory usage: `METRIC peak_memory_mb=<megabytes>`
- Test duration: `METRIC test_duration_ms=<milliseconds>`

Choose metrics relevant to the current optimization goal.
