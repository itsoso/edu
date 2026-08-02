import {api} from '../src/lib/api';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe('mobile API compatibility', () => {
  beforeEach(() => {
    global.fetch = jest.fn<typeof fetch>();
  });

  it('builds assignment queries without URLSearchParams.set', async () => {
    const globals = globalThis as typeof globalThis & {URLSearchParams?: unknown};
    const original = globals.URLSearchParams;
    globals.URLSearchParams = class {
      set(): never {
        throw new Error('URL.searchParams.set is not implemented');
      }
    } as any;
    jest.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([]));

    try {
      await expect(
        api.listAssignments({status: 'pending', mine_assigned: true}),
      ).resolves.toEqual([]);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/assignments?status=pending&mine_assigned=true'),
        expect.anything(),
      );
    } finally {
      globals.URLSearchParams = original;
    }
  });

  it('polls an asynchronous scan-solve job to completion', async () => {
    jest.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({job_id: 'job-1', status: 'processing'}, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'done',
          result: {
            question_text: '1+1=?',
            subject: '数学',
            knowledge_point: '加法',
            difficulty: 'easy',
            answer: '2',
            solution_steps: '1 加 1 等于 2',
            common_mistakes: '',
          },
        }),
      );

    const result = await api.scanSolveMistake('file://q.jpg', 'q.jpg', 'image/jpeg', false);
    expect(result.answer).toBe('2');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(jest.mocked(global.fetch).mock.calls[1][0]).toContain(
      '/api/mistakes/scan-solve/job-1',
    );
  });
});
