import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('essay model API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('queues and polls a model essay job', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(response({ job_id: 'essay-job-1', status: 'processing' }, 202))
      .mockResolvedValueOnce(response({
        status: 'done',
        result: {
          title: '范文',
          content: '正文',
          highlights: [],
          structure_note: '',
        },
      }))

    await expect(api.generateEssayModel(7)).resolves.toMatchObject({ content: '正文' })
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/essays/model-essay/essay-job-1',
      expect.anything(),
    )
  })
})

describe('scan solve API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('queues and polls a scan-solve job', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(response({ job_id: 'scan-job-1', status: 'processing' }, 202))
      .mockResolvedValueOnce(response({
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
      }))

    const file = new File(['image'], 'question.jpg', { type: 'image/jpeg' })
    await expect(api.scanSolveMistake(file, false)).resolves.toMatchObject({ answer: '2' })
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/mistakes/scan-solve/scan-job-1',
      expect.anything(),
    )
  })
})
