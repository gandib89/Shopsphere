import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

let http: AxiosInstance;
let session: typeof import('./session');
const user = { id: 'buyer-1', email: 'buyer@example.test', role: 'customer', admin: false, seller: false, sellerVerified: false };
const ok = (config: InternalAxiosRequestConfig, data = { accessToken: 'fresh-access', user }) => ({ config, data, status: 200, statusText: 'OK', headers: {} });

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem('token', 'session');
  http = (await import('axios')).default;
  http.interceptors.request.clear();
  http.interceptors.response.clear();
  session = await import('./session');
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('persistent session recovery', () => {
  it('restores the access token after reload using one shared credentialed refresh', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ok(config));
    http.defaults.adapter = adapter;
    expect(session.getAccessToken()).toBeNull();
    await Promise.all([session.refreshSession(), session.refreshSession()]);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(adapter.mock.calls[0][0].withCredentials).toBe(true);
    expect(session.getAccessToken()).toBe('fresh-access');
    expect(localStorage.getItem('token')).toBe('session');
    expect(Object.values(localStorage)).not.toContain('fresh-access');
  });

  it.each([undefined, 429, 500, 503])('preserves login hints and reports a temporary refresh failure (%s)', async status => {
    const failure = { response: status ? { status } : undefined, message: 'Temporary failure' };
    http.defaults.adapter = async () => { throw failure; };
    await expect(session.refreshSession()).rejects.toBe(failure);
    expect(localStorage.getItem('token')).toBe('session');
    expect(session.getAccessToken()).toBeNull();
    http.defaults.adapter = async config => ok(config);
    await expect(session.refreshSession()).resolves.toBe('fresh-access');
  });

  it('clears an expired or revoked session on refresh 401', async () => {
    http.defaults.adapter = async config => { throw { config, response: { status: 401 } }; };
    await expect(session.refreshSession()).resolves.toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(session.getAccessToken()).toBeNull();
  });

  it('does not send an unauthenticated fetch when restoration is temporarily unavailable', async () => {
    const failure = new Error('offline');
    http.defaults.adapter = async () => { throw failure; };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(session.authFetch('/api/v1/auth/me')).rejects.toBe(failure);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBe('session');
  });

  it('surfaces refresh outages instead of returning the original protected-request 401', async () => {
    const unavailable = { response: { status: 503 } };
    http.defaults.adapter = async config => {
      if (config.url?.endsWith('/auth/refresh')) throw unavailable;
      throw { config, response: { status: 401 } };
    };
    await expect(http.get('/api/v1/auth/me')).rejects.toBe(unavailable);
    expect(localStorage.getItem('token')).toBe('session');
  });
});
