import axios from 'axios';

export class BackendUnavailableError extends Error {
  constructor() {
    super('Backend unavailable');
    this.name = 'BackendUnavailableError';
  }
}

function createHttpClient(baseURL: string) {
  const client = axios.create({
    baseURL,
    timeout: 10_000,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.response.use(
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
  return client;
}

export const httpClient = createHttpClient(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api');
export const securityHttpClient = createHttpClient(import.meta.env.VITE_SECURITY_API_BASE_URL ?? 'http://127.0.0.1:8004/api');
