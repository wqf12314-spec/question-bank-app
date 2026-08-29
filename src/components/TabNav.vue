<script setup>
import {
  BarChart3,
  BookOpenCheck,
  BrainCircuit,
  House,
  LibraryBig,
} from "lucide-vue-next";
import { computed } from "vue";
import { useAuthStore } from "../stores/auth";
import { filterByPermission } from "../utils/permissions";

const authStore = useAuthStore();
const navItems = [
  { to: "/", label: "首页", icon: House },
  {
    to: "/questions",
    label: "题库",
    icon: LibraryBig,
    roles: ["LEARNER", "EDITOR", "ADMIN"],
  },
  { to: "/practice", label: "刷题", icon: BrainCircuit },
  { to: "/stats", label: "统计", icon: BarChart3 },
];
const visibleNavItems = computed(() =>
  filterByPermission(navItems, authStore.user),
);
</script>

<template>
  <nav class="tab-nav" aria-label="主导航">
    <div class="nav-brand">
      <span><BookOpenCheck :size="22" /></span>
      <div>
        <strong>知识航线</strong>
        <small>Frontend Practice</small>
      </div>
    </div>

    <RouterLink v-for="item in visibleNavItems" :key="item.to" :to="item.to">
      <component :is="item.icon" :size="20" />
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tab-nav {
  position: sticky;
  bottom: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 6px 8px 8px;
  border-top: 2px solid var(--border-strong);
  background: rgba(248, 253, 254, 0.92);
  box-shadow: 0 -8px 24px rgba(44, 112, 123, 0.08);
  backdrop-filter: blur(18px) saturate(1.08);
}

.nav-brand {
  display: none;
}

a {
  display: flex;
  min-width: 0;
  min-height: 48px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
  text-decoration: none;
}

.router-link-active {
  color: var(--primary-strong);
  background: var(--primary-soft);
  font-weight: 650;
}

a:hover {
  color: var(--primary-strong);
  background: #f2f5f5;
}

a:focus-visible {
  outline: 3px solid rgba(223, 102, 148, 0.32);
  outline-offset: 2px;
}

@media (min-width: 900px) {
  .tab-nav {
    position: fixed;
    top: 0;
    right: auto;
    width: 212px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 18px 12px;
    border-top: 0;
    border-right: 2px solid var(--border-strong);
    background: rgba(248, 253, 254, 0.9);
    box-shadow: 8px 0 28px rgba(44, 112, 123, 0.08);
  }

  .nav-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding: 2px 4px 14px;
    border-bottom: 1px solid var(--border);
  }

  .nav-brand > span {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    color: #0e9da0;
    background: rgba(233, 251, 250, 0.86);
  }

  .nav-brand strong,
  .nav-brand small {
    display: block;
  }

  .nav-brand strong {
    color: #234047;
    font-size: 17px;
  }

  .nav-brand small {
    margin-top: 2px;
    color: #789097;
    font-size: 11px;
  }

  a {
    min-height: 44px;
    flex-direction: row;
    justify-content: flex-start;
    gap: 10px;
    padding: 8px 10px;
    font-size: 14px;
    text-align: left;
  }

  .router-link-active {
    box-shadow: inset 3px 0 0 var(--primary);
  }

  .router-link-active::after {
    width: 6px;
    height: 6px;
    margin-left: auto;
    border-radius: 50%;
    background: var(--accent);
    content: "";
  }
}
</style>
