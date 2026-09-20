import { onBeforeRouteLeave } from "vue-router";
import { onBeforeUnmount, onMounted, type Ref } from "vue";

export interface UnsavedGuardOptions {
  dirty: Ref<boolean> | (() => boolean);
  confirmLeave?: () => boolean;
  onDiscard?: () => void;
  onCopyJson?: () => string | undefined;
  onExportDraft?: () => Promise<void>;
}

export interface UnsavedGuard {
  canLeave(): boolean;
  handleBeforeUnload(event: BeforeUnloadEvent): void;
  retry(): boolean;
  discard(): void;
  copyJson(): string | undefined;
  exportDraft(): Promise<void>;
}

function isDirty(source: Ref<boolean> | (() => boolean)): boolean {
  return typeof source === "function" ? source() : source.value;
}

export function useUnsavedGuard(options: UnsavedGuardOptions): UnsavedGuard {
  const guard: UnsavedGuard = {
    canLeave: () => !isDirty(options.dirty) || (options.confirmLeave?.() ?? false),
    handleBeforeUnload: (event) => {
      if (!isDirty(options.dirty)) return;
      event.preventDefault();
    },
    retry: () => !isDirty(options.dirty) || (options.confirmLeave?.() ?? false),
    discard: () => {
      options.onDiscard?.();
    },
    copyJson: () => options.onCopyJson?.(),
    exportDraft: async () => {
      await options.onExportDraft?.();
    },
  };

  const beforeUnload = (event: BeforeUnloadEvent): void => {
    guard.handleBeforeUnload(event);
  };
  onBeforeRouteLeave(() => {
    return guard.canLeave();
  });
  onMounted(() => {
    window.addEventListener("beforeunload", beforeUnload);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", beforeUnload);
  });
  return guard;
}
