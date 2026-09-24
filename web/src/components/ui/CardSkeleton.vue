<script setup lang="ts">
/* 📘 CardSkeleton —— 对应 ui.tsx 的 CardSkeleton（rows 行占位） */
import Card from './Card.vue'
import Skeleton from './Skeleton.vue'

withDefaults(defineProps<{ rows?: number }>(), { rows: 1 })
</script>

<template>
  <Card class="p-4">
    <Skeleton class="h-4 w-1/3" />
    <div class="mt-3 space-y-2">
      <Skeleton v-for="i in rows" :key="i" class="h-3 w-full" />
    </div>
  </Card>
</template>
