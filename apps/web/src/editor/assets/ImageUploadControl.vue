<script setup lang="ts">
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const properties = defineProps<{
  disabled?: boolean;
  upload: (file: File) => Promise<string>;
}>();

const emit = defineEmits<{
  "asset-selected": [assetId: string];
  rejected: [message: string];
}>();

async function processFile(file: File | undefined): Promise<void> {
  if (properties.disabled || file === undefined) return;
  if (!ACCEPTED_TYPES.has(file.type)) {
    emit("rejected", "仅支持 PNG、JPEG 或 WebP 图片。");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    emit("rejected", "图片不能超过 5 MiB。");
    return;
  }
  try {
    emit("asset-selected", await properties.upload(file));
  } catch {
    emit("rejected", "图片上传失败。");
  }
}

function handleChange(event: Event): void {
  void processFile((event.target as HTMLInputElement).files?.[0]);
}

function handlePaste(event: ClipboardEvent): void {
  event.preventDefault();
  void processFile(event.clipboardData?.files[0]);
}

function handleDrop(event: DragEvent): void {
  event.preventDefault();
  void processFile(event.dataTransfer?.files[0]);
}
</script>

<template>
  <div class="image-upload-control">
    <input
      id="document-image-upload"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      :disabled="properties.disabled"
      aria-label="选择图片"
      @change="handleChange"
    />
    <button
      type="button"
      :disabled="properties.disabled"
      @paste="handlePaste"
      @dragover.prevent
      @drop="handleDrop"
    >
      上传图片
    </button>
    <label for="document-image-upload">选择文件，或粘贴/拖放图片</label>
  </div>
</template>
