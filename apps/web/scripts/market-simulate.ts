import { performance } from "node:perf_hooks";
import { simulateMarket } from "../lib/market/simulation.ts";
const started = performance.now();
console.log(JSON.stringify({ ...simulateMarket(), runtimeMs: Math.round(performance.now() - started), unit: "VU micros" }));
