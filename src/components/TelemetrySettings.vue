<script setup>
import { ref } from "vue";
import {
  isTelemetryEnabled,
  setTelemetryEnabled,
} from "../utils/errorTelemetry.js";

const enabled = ref(isTelemetryEnabled());

function updateTelemetryPreference() {
  // Web 和 Electron 共用同一个本地隐私边界，默认关闭且不记录答案正文。
  setTelemetryEnabled(enabled.value);
}
</script>

<template>
  <label class="telemetry-setting">
    <input
      v-model="enabled"
      type="checkbox"
      @change="updateTelemetryPreference"
    />
    允许记录本地错误诊断与使用事件（不包含答案正文）
  </label>
</template>

<style scoped>
.telemetry-setting {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.telemetry-setting input {
  margin-top: 3px;
}
</style>
