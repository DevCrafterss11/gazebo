import axios from 'axios';

export class BackendUnavailableError extends Error {
  constructor() {
    super('Backend unavailable');
    this.name = 'BackendUnavailableError';
  }
}

export const httpClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api',
  timeout: 10_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

httpClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && !error.response) {
      return Promise.reject(new BackendUnavailableError());
    }
    if (axios.isAxiosError(error) && error.response) {
      const detail: unknown = (error.response.data as { detail?: unknown } | undefined)?.detail;
      if (typeof detail === 'string') return Promise.reject(new Error(detail));
    }
    return Promise.reject(error);
  },
);
