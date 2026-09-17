import { createApp } from "vue";

import "mind-elixir/style.css";
import "simple-mind-map/dist/simpleMindMap.esm.css";
import "jsmind/style/jsmind.css";
import "./poc.css";

import CanvasPocView from "./CanvasPocView.vue";
import { CANVAS_CANDIDATES, type CanvasCandidate } from "./types.js";

const startedAt = performance.now();
const parameters = new URLSearchParams(window.location.search);
const requestedCandidate = parameters.get("candidate");
const requestedNodeCount = Number(parameters.get("nodes") ?? "100");

function isCandidate(value: string | null): value is CanvasCandidate {
  return value !== null && CANVAS_CANDIDATES.some((candidate) => candidate === value);
}

const candidate = isCandidate(requestedCandidate) ? requestedCandidate : "simple-mind-map";
const nodeCount =
  Number.isInteger(requestedNodeCount) && requestedNodeCount >= 1 && requestedNodeCount <= 20_000
    ? requestedNodeCount
    : 100;

createApp(CanvasPocView, { candidate, nodeCount, startedAt }).mount("#poc-app");
