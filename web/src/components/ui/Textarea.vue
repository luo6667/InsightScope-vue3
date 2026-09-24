<script setup lang="ts">
/* 📘 Textarea —— 对应 ui.tsx 的 Textarea */
import { fieldCls } from './field'

const model = defineModel<string | number | undefined>()
</script>

<template>
  <textarea v-model="model" :class="[fieldCls, 'py-2']" />
</template>
