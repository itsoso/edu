import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ReflectionField from './ReflectionField'
import { api } from '../api'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    api: {
      ...actual.api,
      listReflections: vi.fn().mockResolvedValue([]),
      upsertReflection: vi.fn().mockResolvedValue({
        id: 1,
        content: 'test',
      }),
    },
  }
})

describe('ReflectionField', () => {
  it('does not fetch reflections until the field is expanded', async () => {
    render(<ReflectionField kind="mistake_note" relatedId={42} />)

    expect(api.listReflections).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /写下我的想法/i }))

    await waitFor(() => {
      expect(api.listReflections).toHaveBeenCalledTimes(1)
    })
  })
})
