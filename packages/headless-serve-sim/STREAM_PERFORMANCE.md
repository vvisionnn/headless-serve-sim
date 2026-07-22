# Stream performance optimization report

Measured on 2026-07-23 with the isolated `serve-sim-perf-20260722` simulator
(`DDC6DB96-ABF2-4E0E-88BA-57343480CA6C`), iOS 26.2, 1179×2556, in `perf`
mode. The unrelated booted simulator was never selected. Unless stated otherwise,
each native result is a 12-second AVCC motion or idle run.

Baseline: commit `cbb6060`. Quality gates for every accepted native candidate were
zero torn frames, zero invalid frames, and zero intervals over 50 ms.

## Measurement tools

- `scripts/stream-performance-benchmark.ts` refuses any simulator that is not
  booted and named `serve-sim-perf-*`. It records decoded quality, one-second FPS,
  frame interval percentiles, host CPU/RSS, capture admission, snapshot cost, and
  AVCC socket-write time.
- `scripts/stream-performance-report.ts` compares one baseline with any number of
  progressive stages and scores each metric in its desired direction.
- The browser pass uses the production preview and Connection Stats panel to
  measure presented FPS, decoder time, jitter, dropped frames, queue time, and
  recoveries. Native and browser results are kept separate.

Example:

```sh
bun run packages/headless-serve-sim/scripts/stream-performance-benchmark.ts \
  --url http://127.0.0.1:3499 \
  --udid DDC6DB96-ABF2-4E0E-88BA-57343480CA6C \
  --pid <helper-pid> --duration 12 --workload motion \
  --label final-motion --output /tmp/final-motion.json

bun run packages/headless-serve-sim/scripts/stream-performance-report.ts \
  --baseline /tmp/baseline.json \
  --stage final=/tmp/final-motion.json \
  --output /tmp/stream-performance.md
```

## Progressive results

| Stage                              |                                               Before |                                                          After | Result                                                                               |
| ---------------------------------- | ---------------------------------------------------: | -------------------------------------------------------------: | ------------------------------------------------------------------------------------ |
| Bounded AVCC transport             |        Detached batches hid bytes in a blocked write |      One in-flight chunk; pending + in-flight pressure tracked | Queue cannot grow an invisible multi-frame batch; slow clients are isolated          |
| Stream liveness                    |            Open TCP/decode could freeze indefinitely | 2.5 s byte timeout; 750 ms decode timeout; 1 Hz idle heartbeat | Four deterministic watchdog cases pass; frozen pipelines reconnect or request an IDR |
| Idle capture scheduling            | 33 framebuffer offers, 11 snapshots, 11 JPEG encodes |                             1 offer, 1 snapshot, 1 JPEG encode | 97.0%, 90.9%, and 90.9% reductions                                                   |
| Idle helper CPU                    |                              1.56% average, 5.5% p95 |                                        0.38% average, 2.5% p95 | 75.6% and 54.5% reductions                                                           |
| JPEG seeding during motion         |                                      13 JPEG encodes |                                                  1 JPEG encode | 92.3% reduction; AVCC still gets instant first paint                                 |
| Native motion FPS                  |             59.63 average, 58 minimum one-second FPS |                                      59.99 average, 59 minimum | Full 60 FPS target retained                                                          |
| Native frame p95 / p99             |                                     20.92 / 24.82 ms |                                               18.31 / 20.40 ms | 12.5% / 17.8% lower                                                                  |
| Motion intervals over 25 ms        |                                                    7 |                                                              2 | 71.4% fewer; zero over 50 ms                                                         |
| Motion helper CPU                  |                            19.88% average, 27.6% p95 |                                      16.86% average, 21.6% p95 | 15.2% / 21.7% lower in the apples-to-apples single-client run                        |
| Motion bandwidth                   |                                            1.14 Mbps |                                                      1.10 Mbps | 3.5% lower                                                                           |
| Browser presenter A/B              |   155 dropped; 56 average FPS; 3.6 ms average jitter |               7 dropped; 60 average FPS; 1.8 ms average jitter | 95.5% fewer drops, full FPS, 50% lower jitter                                        |
| Browser decode/recovery            |          1.8 ms decode; 0 recoveries; 0 server drops |                    1.7 ms decode; 0 recoveries; 0 server drops | Presentation gain did not move work into the decoder or recovery path                |
| Recording scheduler microbenchmark |          120 animation callbacks; 30–32 compositions |         0 animation callbacks; 30–32 event-driven compositions | Continuous polling removed without changing requested recording FPS                  |
| Local AVCC socket writes           |                                       Not observable |      0.0506 ms average; 0 queue drops in a 6-second motion run | Transport is not the local bottleneck and is now measurable                          |

The final framebuffer snapshot averaged about 0.54 ms in the last comparable
12-second motion run. The owned BGRA snapshot remains necessary: SimulatorKit
reuses and mutates one IOSurface, so passing it asynchronously to VideoToolbox can
tear a frame.

## Rejected experiment: NV12 pixel transfer

The native NV12 candidate was measured rather than assumed to be faster. It was
removed from production because it made smoothness substantially worse:

| Metric                 |     BGRA | NV12 candidate |
| ---------------------- | -------: | -------------: |
| Average FPS            |    60.04 |          37.27 |
| Minimum one-second FPS |       60 |             31 |
| p99 frame interval     | 18.79 ms |       38.31 ms |
| Maximum frame interval | 26.44 ms |      226.26 ms |
| Frames over 25 ms      |        3 |            260 |
| Snapshot/transfer time |  0.56 ms |        1.39 ms |
| H.264 busy drops       |       28 |            293 |

Its apparently lower CPU came from encoding far fewer frames. It was not an
optimization.

## Feature regression checks

- Screenshot UI produced a complete 1179×2556 PNG data URL.
- Recording UI produced a playable MP4 blob (`readyState=4`) at 1178×2556 while
  the concurrent native stream remained 60.00 FPS, tear-free, with no interval
  over 50 ms.
- MJPEG remains available and uses the same safe BGRA snapshot path.
- AVCC initial JPEG seed, snapshot correctness, touch overlays, device frames,
  MP4/WebM fallback, stop/cancel, and recorder cleanup remain covered by tests.

## Remote transport decision

The accepted path keeps the existing HTTP AVCC endpoint for compatibility with
middleware, tunnels, snapshots, and recording. Per-client bounded queues prevent
one slow remote TCP client from blocking other viewers. For lossy/high-RTT WAN
links, WebRTC media transport can avoid TCP head-of-line blocking, but adopting it
requires signaling, ICE/TURN, authentication, and a native sender dependency. It
was not added speculatively because it would materially expand deployment and
feature risk; the new transport counters establish when that larger change is
actually justified.
