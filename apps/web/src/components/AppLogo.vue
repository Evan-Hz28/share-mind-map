<script setup lang="ts">
defineProps<{ tagline?: string }>();
</script>

<template>
  <span class="app-logo" aria-label="Kitar TestHub">
    <img class="app-logo__mark" src="/kitar.jpeg" alt="" />
    <span class="app-logo__text">
      <span class="app-logo__name">Kitar TestHub</span>
      <span v-if="tagline" class="app-logo__tagline">{{ tagline }}</span>
    </span>
  </span>
</template>
