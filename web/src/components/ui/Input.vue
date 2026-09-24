<script setup lang="ts">
/* 📘 Input —— 对应 ui.tsx 的 Input；用 defineModel 支持 v-model（React 侧是 value + onChange） */
import { fieldCls } from './field'

const model = defineModel<string | number | undefined>()
</script>

<template>
  <input v-model="model" :class="[fieldCls, 'h-9']" />
</template>
