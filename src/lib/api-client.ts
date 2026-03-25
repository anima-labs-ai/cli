export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  apiKey?: string;
  debug?: boolean;
  timeout?: number;
}

interface ErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly debug: boolean;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeout = options.timeout ?? 30_000;
    this.debug = options.debug ?? false;

    this.headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (options.token) {
      this.headers.Authorization = `Bearer ${options.token}`;
    } else if (options.apiKey) {
      this.headers['X-API-Key'] = options.apiKey;
    }
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return this.request<T>('GET', url);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', `${this.baseUrl}${path}`, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', `${this.baseUrl}${path}`, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', `${this.baseUrl}${path}`, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', `${this.baseUrl}${path}`);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    if (this.debug) {
      console.error(`[debug] ${method} ${url}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody: ErrorResponse = {};
        try {
          errorBody = (await response.json()) as ErrorResponse;
        } catch {
          // Response may not be JSON
        }

        const code = errorBody.error?.code ?? `HTTP_${response.status}`;
        const message =
          errorBody.error?.message ?? errorBody.message ?? `Request failed with status ${response.status}`;

        throw new ApiError(response.status, code, message, errorBody);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(0, 'TIMEOUT', `Request timed out after ${this.timeout}ms`);
      }
      if (error instanceof TypeError) {
        throw new ApiError(0, 'NETWORK_ERROR', `Network error: ${error.message}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
