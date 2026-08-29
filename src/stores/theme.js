import { computed, ref } from "vue";
import { defineStore } from "pinia";

const STORAGE_KEY = "knowledge-navigator-theme";

export const useThemeStore = defineStore("theme", () => {
  const theme = ref(
    typeof localStorage === "undefined"
      ? "neutral"
      : localStorage.getItem(STORAGE_KEY) || "neutral",
  );

  function apply(nextTheme) {
    theme.value = nextTheme === "focus" ? "focus" : "neutral";
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme.value;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, theme.value);
    }
  }

  function toggle() {
    apply(theme.value === "neutral" ? "focus" : "neutral");
  }

  if (typeof document !== "undefined") apply(theme.value);

  return { theme: computed(() => theme.value), apply, toggle };
});
