<script setup>
import TabNav from "./components/TabNav.vue";
</script>

<template>
  <div class="app-shell">
    <main class="app-main">
      <router-view />
    </main>
    <TabNav />
  </div>
</template>
