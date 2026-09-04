import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch } from './session';
import { adminDate, getAdminCollection } from './adminData';

vi.mock('./session', () => ({ authFetch: vi.fn() }));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => vi.resetAllMocks());

describe('admin collection loading', () => {
  it('follows all pages and passes the abort signal through', async () => {
    const signal = new AbortController().signal;
    vi.mocked(authFetch).mockResolvedValueOnce(response({items:[{id:1}],total:2})).mockResolvedValueOnce(response({items:[{id:2}],total:2}));
    expect(await getAdminCollection('/orders',signal)).toEqual([{id:1},{id:2}]);
    expect(authFetch).toHaveBeenNthCalledWith(2,expect.stringContaining('/orders?page=2&limit=200'),{signal});
  });
  it.each([[{id:1}], {sellers:[{id:1}]}])('supports an unpaginated collection', async body => {
    vi.mocked(authFetch).mockResolvedValue(response(body));
    expect(await getAdminCollection('/sellers')).toEqual([{id:1}]);
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
  it('rejects failed authentication instead of displaying empty data', async () => {
    vi.mocked(authFetch).mockResolvedValue(response({},401));
    await expect(getAdminCollection('/orders')).rejects.toThrow('sign in again');
  });
  it('stops an incomplete empty page instead of looping', async () => {
    vi.mocked(authFetch).mockResolvedValue(response({items:[],total:2}));
    await expect(getAdminCollection('/orders')).rejects.toThrow('Refresh');
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
  it('rejects an unexpected payload', async () => {
    vi.mocked(authFetch).mockResolvedValue(response({message:'unexpected'}));
    await expect(getAdminCollection('/orders')).rejects.toThrow('unexpected response');
  });
  it('does not render Invalid Date for missing timestamps', () => {
    expect(adminDate()).toBe('—');
    expect(adminDate('invalid')).toBe('—');
  });
});
