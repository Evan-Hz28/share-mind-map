import {
  authChangePassword,
  authCsrf,
  authLogin,
  authLogout,
  getMe,
  type ChangePasswordDto,
  type LoginDtoWritable,
  type SessionResponseDto,
} from "@share-mind-map/api-client";
import { defineStore, type Pinia } from "pinia";

import { apiClient, bindApiAuthentication, toApiFailure, type RequestFailure } from "../api.js";

export type AuthenticationState = "unknown" | "anonymous" | "authenticated" | "expired";

interface AuthStoreState {
  state: AuthenticationState;
  session: SessionResponseDto | null;
  csrfToken: string | null;
  loading: boolean;
  error: RequestFailure | null;
}

const useAuthStoreDefinition = defineStore("auth", {
  state: (): AuthStoreState => ({
    state: "unknown",
    session: null,
    csrfToken: null,
    loading: false,
    error: null,
  }),
  getters: {
    mustChangePassword: (state): boolean => state.session?.mustChangePassword ?? false,
    role: (state): SessionResponseDto["role"] | null => state.session?.role ?? null,
  },
  actions: {
    clear(nextState: AuthenticationState): void {
      this.state = nextState;
      this.session = null;
      this.csrfToken = null;
    },
    handleUnauthorized(): void {
      this.clear(this.state === "authenticated" ? "expired" : "anonymous");
    },
    async bootstrap(): Promise<void> {
      if (this.state !== "unknown") return;
      await this.refreshSession();
    },
    async refreshSession(): Promise<boolean> {
      this.loading = true;
      this.error = null;
      try {
        const current = await getMe({ client: apiClient });
        if (current.data === undefined) {
          if (this.state === "unknown") this.clear("anonymous");
          return false;
        }
        const csrf = await authCsrf({ client: apiClient });
        if (csrf.data === undefined) {
          this.error = toApiFailure(csrf.error);
          this.clear("anonymous");
          return false;
        }
        this.session = current.data;
        this.csrfToken = csrf.data.csrfToken;
        this.state = "authenticated";
        return true;
      } finally {
        this.loading = false;
      }
    },
    async login(input: LoginDtoWritable): Promise<boolean> {
      this.loading = true;
      this.error = null;
      try {
        const result = await authLogin({ client: apiClient, body: input });
        if (result.data === undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        const { csrfToken, ...session } = result.data;
        this.session = session;
        this.csrfToken = csrfToken;
        this.state = "authenticated";
        return true;
      } finally {
        this.loading = false;
      }
    },
    async changePassword(input: ChangePasswordDto): Promise<boolean> {
      this.loading = true;
      this.error = null;
      try {
        const result = await authChangePassword({ client: apiClient, body: input });
        if (result.error !== undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        this.clear("anonymous");
        return true;
      } finally {
        this.loading = false;
      }
    },
    async logout(): Promise<boolean> {
      this.loading = true;
      this.error = null;
      try {
        const result = await authLogout({ client: apiClient });
        if (result.error !== undefined) {
          this.error = toApiFailure(result.error);
          return false;
        }
        this.clear("anonymous");
        return true;
      } finally {
        this.loading = false;
      }
    },
    acknowledgeExpiration(): void {
      this.clear("anonymous");
      this.error = null;
    },
  },
});

export function useAuthStore(pinia?: Pinia): ReturnType<typeof useAuthStoreDefinition> {
  const store = useAuthStoreDefinition(pinia);
  bindApiAuthentication({
    getCsrfToken: () => store.csrfToken ?? undefined,
    onUnauthorized: () => {
      store.handleUnauthorized();
    },
  });
  return store;
}
