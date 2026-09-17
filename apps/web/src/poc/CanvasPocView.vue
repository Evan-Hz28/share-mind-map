<script setup lang="ts">
import type { CloudDocumentV1 } from "@share-mind-map/document-model";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import { createAdapter } from "./adapters/index.js";
import { sampleDocument } from "./sample.js";
import {
  CANVAS_CANDIDATES,
  type CanvasBenchmarkMeasurement,
  type CanvasCandidate,
  type CanvasFunctionalChecks,
  type CanvasPocRuntime,
  type MindMapAdapter,
  type MindMapViewState,
} from "./types.js";

const properties = defineProps<{
  candidate: CanvasCandidate;
  nodeCount: number;
  startedAt: number;
}>();

const host = ref<HTMLDivElement | null>(null);
let adapter: MindMapAdapter | null = null;
const status = ref<"mounting" | "ready" | "failed">("mounting");
const mountMilliseconds = ref<number | null>(null);
const firstUsableMilliseconds = ref<number | null>(null);
const nodeLabel = computed(() => properties.nodeCount.toLocaleString("en-US"));
const sourceDocument = sampleDocument(properties.nodeCount);

function currentHeap(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory?.usedJSHeapSize ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function requireAdapter(): MindMapAdapter {
  if (adapter === null) throw new Error("The canvas adapter is not ready.");
  return adapter;
}

function requireSheet(document: CloudDocumentV1) {
  const sheet = document.sheets[0];
  if (sheet === undefined) throw new Error("The canvas sample has no sheet.");
  return sheet;
}

function interactionState(document: CloudDocumentV1): MindMapViewState {
  const sheet = requireSheet(document);
  const selectedNodeId = sheet.nodes[sheet.rootNodeId]?.childIds[1] ?? sheet.rootNodeId;
  return {
    selectedNodeId,
    expandedNodeIds: [sheet.rootNodeId, selectedNodeId],
    viewport: { x: 38, y: -24, zoom: 1.2 },
    readOnly: true,
  };
}

function replacementDocument(): CloudDocumentV1 {
  const replacement = structuredClone(sourceDocument);
  replacement.version += 1;
  const sheet = requireSheet(replacement);
  const root = sheet.nodes[sheet.rootNodeId];
  if (root === undefined) throw new Error("The canvas sample root is missing.");
  root.title = `${root.title} replacement`;
  return replacement;
}

async function checksum(document: CloudDocumentV1): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(document)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function animationFrame(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => {
      resolve();
    }),
  );
}

async function runFunctionalChecks(): Promise<CanvasFunctionalChecks> {
  const checks: CanvasFunctionalChecks = {
    readOnly: false,
    focus: false,
    zoomPan: false,
    collapse: false,
    snapshotReplacement: false,
    stateRestoration: false,
    deterministicExport: false,
    cleanup: false,
  };
  const instance = requireAdapter();
  try {
    const state = interactionState(sourceDocument);
    instance.setReadOnly(true);
    checks.readOnly = instance.getViewState().readOnly;
    checks.focus =
      state.selectedNodeId !== null &&
      (await instance.focusNode(state.selectedNodeId)) &&
      instance.getViewState().selectedNodeId === state.selectedNodeId;
    await instance.restoreViewState(state);
    const restoredBeforeReplacement = instance.getViewState();
    checks.zoomPan =
      restoredBeforeReplacement.viewport.x === state.viewport.x &&
      restoredBeforeReplacement.viewport.y === state.viewport.y &&
      restoredBeforeReplacement.viewport.zoom === state.viewport.zoom;
    const collapsedState = structuredClone(state);
    collapsedState.expandedNodeIds = [requireSheet(sourceDocument).rootNodeId];
    await instance.restoreViewState(collapsedState);
    checks.collapse = instance.getViewState().expandedNodeIds.length === 1;
    await instance.restoreViewState(state);

    const replacement = replacementDocument();
    await instance.applySnapshot(replacement);
    checks.snapshotReplacement =
      JSON.stringify(instance.exportSnapshot()) === JSON.stringify(replacement);
    checks.stateRestoration = JSON.stringify(instance.getViewState()) === JSON.stringify(state);
    checks.deterministicExport =
      JSON.stringify(instance.exportSnapshot()) === JSON.stringify(instance.exportSnapshot());
  } finally {
    instance.destroy();
    checks.cleanup = host.value?.childElementCount === 0;
  }
  return checks;
}

async function runBenchmark(): Promise<CanvasBenchmarkMeasurement> {
  const instance = requireAdapter();
  const replacement = replacementDocument();
  const state = interactionState(replacement);
  const heapAfterMount = currentHeap();

  const replacementStart = performance.now();
  await instance.applySnapshot(replacement);
  const replacementMs = performance.now() - replacementStart;
  const heapAfterReplacement = currentHeap();

  const interactionStart = performance.now();
  instance.setReadOnly(true);
  const focused = state.selectedNodeId !== null && (await instance.focusNode(state.selectedNodeId));
  await instance.restoreViewState(state);
  const interactionMs = performance.now() - interactionStart;
  const exported = instance.exportSnapshot();
  const exportChecksum = await checksum(exported);
  const deterministicExport = exportChecksum === (await checksum(instance.exportSnapshot()));
  const stateRestoration = JSON.stringify(instance.getViewState()) === JSON.stringify(state);
  const snapshotReplacement = JSON.stringify(exported) === JSON.stringify(replacement);

  instance.destroy();
  await animationFrame();
  await animationFrame();
  const heapAfterDestroy = currentHeap();

  return {
    mountMs: mountMilliseconds.value ?? Number.NaN,
    firstUsableMs: firstUsableMilliseconds.value ?? Number.NaN,
    replacementMs,
    interactionMs,
    heap: {
      beforeMount: window.__CANVAS_POC__?.heapBeforeMount ?? null,
      afterMount: heapAfterMount,
      afterReplacement: heapAfterReplacement,
      afterDestroy: heapAfterDestroy,
    },
    exportChecksum,
    functional: {
      readOnly: state.readOnly,
      focus: focused,
      zoomPan: instance.getViewState().viewport.zoom === state.viewport.zoom,
      collapse: state.expandedNodeIds.length > 0,
      snapshotReplacement,
      stateRestoration,
      deterministicExport,
      cleanup: host.value?.childElementCount === 0,
    },
  };
}

function changeCandidate(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  const url = new URL(window.location.href);
  url.searchParams.set("candidate", value);
  window.location.assign(url);
}

function changeNodeCount(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  const url = new URL(window.location.href);
  url.searchParams.set("nodes", value);
  window.location.assign(url);
}

const runtime: CanvasPocRuntime = {
  ready: false,
  candidate: properties.candidate,
  nodeCount: properties.nodeCount,
  heapBeforeMount: currentHeap(),
  capabilities: {
    readOnly: true,
    stableIds: true,
    createDelete: true,
    reparenting: true,
    reordering: true,
    collapse: true,
    keyboardHooks: true,
    zoomPan: true,
    undoHook: properties.candidate !== "jsmind",
    image: true,
    label: properties.candidate !== "jsmind",
    icon: properties.candidate !== "jsmind",
    basicStyle: true,
    snapshotReplacement: true,
    stateRestoration: true,
    deterministicExport: true,
    cleanup: true,
    noCloudDependency: true,
  },
  errors: [],
  runFunctionalChecks,
  runBenchmark,
};
window.__CANVAS_POC__ = runtime;

onMounted(async () => {
  try {
    await nextTick();
    const element = host.value;
    if (element === null) throw new Error("The canvas host did not mount.");
    const instance = createAdapter(properties.candidate, element);
    adapter = instance;
    const mountStart = performance.now();
    await instance.mount(sourceDocument);
    mountMilliseconds.value = performance.now() - mountStart;
    firstUsableMilliseconds.value = performance.now() - properties.startedAt;
    runtime.ready = true;
    status.value = "ready";
  } catch (error) {
    runtime.errors.push(errorMessage(error));
    runtime.ready = true;
    status.value = "failed";
  }
});

onBeforeUnmount(() => {
  adapter?.destroy();
});
</script>

<template>
  <!-- eslint-disable vue/max-attributes-per-line -->
  <main class="poc-shell">
    <header class="poc-toolbar">
      <div class="poc-title-block">
        <h1>Canvas evaluation</h1>
        <span :class="['poc-status', `is-${status}`]">{{ status }}</span>
      </div>
      <div class="poc-controls">
        <label>
          <span>Component</span>
          <select :value="candidate" @change="changeCandidate">
            <option v-for="name in CANVAS_CANDIDATES" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
        </label>
        <label>
          <span>Nodes</span>
          <select :value="nodeCount" @change="changeNodeCount">
            <option :value="100">100</option>
            <option :value="5000">5,000</option>
            <option :value="20000">20,000</option>
          </select>
        </label>
      </div>
      <dl class="poc-metrics">
        <div>
          <dt>Sample</dt>
          <dd>{{ nodeLabel }}</dd>
        </div>
        <div>
          <dt>Mount</dt>
          <dd>{{ mountMilliseconds === null ? "-" : `${mountMilliseconds.toFixed(1)} ms` }}</dd>
        </div>
      </dl>
    </header>
    <div ref="host" class="poc-canvas" role="region" aria-label="Mind map canvas" />
  </main>
</template>
