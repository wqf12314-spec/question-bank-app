<script setup>
import { ref } from "vue";
import { LogIn, LogOut, UserRound } from "lucide-vue-next";
import { useAuthStore } from "../stores/auth";

defineProps({ compact: Boolean });

const authStore = useAuthStore();
const dialog = ref(null);
const email = ref("");
const password = ref("");

function openLogin() {
  authStore.clearError();
  dialog.value?.showModal();
}

function closeLogin() {
  dialog.value?.close();
}

async function submitLogin() {
  try {
    await authStore.login({ email: email.value, password: password.value });
    password.value = "";
    closeLogin();
  } catch {
    // Store 已保存可展示的错误，保持对话框打开供用户修正。
  }
}

async function logout() {
  try {
    await authStore.logout();
  } catch {
    // 本地会话已在 finally 中清理，服务端暂时不可用不阻塞退出。
  }
}
</script>

<template>
  <div class="account-access" :class="{ compact }">
    <button
      v-if="!authStore.user"
      class="login-trigger"
      type="button"
      :disabled="authStore.isBusy"
      @click="openLogin"
    >
      <LogIn :size="17" aria-hidden="true" />
      <span>登录</span>
    </button>

    <div v-else class="account-session">
      <UserRound :size="17" aria-hidden="true" />
      <span class="account-email" :title="authStore.user.email">
        {{ authStore.user.email }}
      </span>
      <button
        class="logout-button"
        type="button"
        title="退出登录"
        aria-label="退出登录"
        :disabled="authStore.isBusy"
        @click="logout"
      >
        <LogOut :size="16" aria-hidden="true" />
      </button>
    </div>

    <dialog ref="dialog" class="login-dialog" @cancel="closeLogin">
      <form class="login-form" @submit.prevent="submitLogin">
        <header>
          <div class="login-icon"><UserRound :size="20" /></div>
          <div>
            <h2>登录知识航线</h2>
            <p>登录后可检查并迁移这台设备上的练习记录。</p>
          </div>
        </header>

        <label>
          <span>邮箱</span>
          <input
            v-model.trim="email"
            type="email"
            autocomplete="email"
            required
            maxlength="320"
          />
        </label>
        <label>
          <span>密码</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            minlength="8"
            maxlength="100"
          />
        </label>

        <p v-if="authStore.error" class="login-error" role="alert">
          {{ authStore.error }}
        </p>
        <p v-if="authStore.errorRequestId" class="login-request-id">
          请求 ID：{{ authStore.errorRequestId }}
        </p>

        <footer>
          <button type="button" class="cancel-action" @click="closeLogin">
            取消
          </button>
          <button
            type="submit"
            class="submit-action"
            :disabled="authStore.isBusy"
          >
            <LogIn :size="17" aria-hidden="true" />
            {{ authStore.isBusy ? "登录中" : "登录" }}
          </button>
        </footer>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.account-access {
  min-width: 0;
}

button {
  font: inherit;
}

.login-trigger,
.account-session {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border-strong);
  border-radius: var(--control-radius);
  color: var(--primary-strong);
  background: rgba(255, 255, 255, 0.9);
}

.login-trigger {
  padding: 7px 11px;
  cursor: pointer;
}

.account-session {
  max-width: 280px;
  padding: 4px 5px 4px 10px;
}

.account-email {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logout-button {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  place-items: center;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}

.logout-button:hover {
  color: var(--danger);
  background: #fff0f3;
}

.compact .login-trigger {
  min-height: 32px;
  padding: 4px 9px;
}

.compact .account-session {
  min-height: 32px;
  max-width: 180px;
}

.compact .logout-button {
  width: 26px;
  height: 26px;
  flex-basis: 26px;
}

.login-dialog {
  width: min(92vw, 430px);
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--module-radius);
  color: var(--text);
  background: #fbfefe;
  box-shadow: 0 24px 70px rgba(31, 79, 87, 0.24);
}

.login-dialog::backdrop {
  background: rgba(28, 52, 57, 0.46);
  backdrop-filter: blur(4px);
}

.login-form {
  display: grid;
  gap: 15px;
  padding: 20px;
}

.login-form header {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.login-icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border-radius: 9px;
  place-items: center;
  color: var(--primary-strong);
  background: var(--primary-soft);
}

h2,
p {
  margin: 0;
}

h2 {
  font-size: 20px;
}

header p {
  margin-top: 3px;
  color: var(--muted);
  font-size: 13px;
}

label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  font-weight: 650;
}

input {
  width: 100%;
  min-height: 44px;
  padding: 9px 11px;
  border: 2px solid rgba(64, 165, 174, 0.38);
  border-radius: var(--control-radius);
  background: var(--field-surface);
  color: var(--text);
  font: inherit;
}

.login-error {
  color: var(--danger);
  font-size: 14px;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

footer button {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 13px;
  border-radius: var(--control-radius);
  cursor: pointer;
}

.cancel-action {
  border: 1px solid var(--border);
  color: var(--muted);
  background: transparent;
}

.submit-action {
  border: 1px solid var(--primary);
  color: #fff;
  background: var(--primary);
}

button:disabled {
  cursor: wait;
  opacity: 0.62;
}

@media (max-width: 480px) {
  .compact .account-email {
    display: none;
  }
}
</style>
