<script setup lang="ts">
/* 📘 Select —— 对应 ui.tsx 的 Select（options 走默认插槽传入原生 <option>） */
import { fieldCls } from './field'

const model = defineModel<string | number | undefined>()
</script>

<template>
  <select v-model="model" :class="[fieldCls, 'h-9 pr-8']">
    <slot />
  </select>
</template>
