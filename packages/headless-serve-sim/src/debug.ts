import createDebug from "debug";

// Namespaces are scoped under `headless-serve-sim:*` so `DEBUG=headless-serve-sim*` enables all
// of them. The most common stream-died debugging path is:
//   headless-serve-sim:state    — state file lifecycle (helper alive? sim booted?)
//   headless-serve-sim:helper   — helper spawn / readiness / exit
//   headless-serve-sim:mw       — middleware state selection + stale-helper recycling
//   headless-serve-sim:cli      — top-level command dispatch
export const debugCli = createDebug("headless-serve-sim:cli");
export const debugHelper = createDebug("headless-serve-sim:helper");
export const debugState = createDebug("headless-serve-sim:state");
export const debugMw = createDebug("headless-serve-sim:mw");
