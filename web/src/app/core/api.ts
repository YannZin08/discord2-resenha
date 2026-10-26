import { Injectable } from '@angular/core';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class Api {
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch('/api' + path, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });
    } catch {
      throw new ApiError(0, 'Sem conexão com o servidor.');
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error ?? `Erro ${res.status}`;
      throw new ApiError(res.status, msg);
    }
    return data as T;
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = unknown>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body);
  }
  patch<T = unknown>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  put<T = unknown>(path: string, body: unknown = {}) {
    return this.request<T>('PUT', path, body);
  }
  delete<T = unknown>(path: string) {
    return this.request<T>('DELETE', path);
  }

  /** Uploads a file with progress, returns the stored file's key. */
  upload(file: Blob, name: string, onProgress?: (fraction: number) => void): Promise<{ key: string; name: string; size: number; mime: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-filename', encodeURIComponent(name));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        let data: { error?: string } & Record<string, unknown> = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          // non-JSON error page
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data as never);
        else reject(new ApiError(xhr.status, data.error ?? `Falha no envio (${xhr.status})`));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Falha no envio do arquivo.'));
      xhr.send(file);
    });
  }
}
