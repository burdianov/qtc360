import axios, { AxiosError, AxiosRequestConfig } from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  // Let browser set Content-Type with boundary for FormData
  if (config.data instanceof FormData) {
    delete config.headers["Content-Type"];
  }
  return config;
});

// Single-flight refresh: a parallel burst of 401s should only kick off ONE refresh.
let refreshPromise: Promise<{ access_token: string; refresh_token: string }> | null = null;

function performRefresh(refresh: string) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = axios
    .post(`${api.defaults.baseURL}/auth/refresh`, { refresh_token: refresh })
    .then((res) => {
      const data = res.data as { access_token: string; refresh_token: string };
      localStorage.setItem("access_token", data.access_token);
      localStorage.setItem("refresh_token", data.refresh_token);
      return data;
    })
    .finally(() => {
      // Defer clearing so concurrent .then callbacks see the same resolved promise.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    });
  return refreshPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (!original) return Promise.reject(error);
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = typeof window !== "undefined" ? localStorage.getItem("refresh_token") : null;
      if (refresh) {
        try {
          const data = await performRefresh(refresh);
          if (original.headers) {
            (original.headers as Record<string, string>).Authorization = `Bearer ${data.access_token}`;
          }
          return api(original);
        } catch {
          if (typeof window !== "undefined") {
            localStorage.removeItem("access_token");
            localStorage.removeItem("refresh_token");
            window.location.href = "/login";
          }
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
