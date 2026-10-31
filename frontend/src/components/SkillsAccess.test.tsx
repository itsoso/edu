import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SkillsAccess from './SkillsAccess'

describe('SkillsAccess', () => {
  it('copies the onboarding instruction and discovery URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<SkillsAccess />)
    fireEvent.click(screen.getByRole('button', { name: '复制接入说明' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已复制'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('https://edu.executor.life/api/skills/edu-learning/SKILL.md'))
    fireEvent.click(screen.getByRole('button', { name: '复制订阅地址' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('https://edu.executor.life/.well-known/edu-skills.json'))
  })

  it('provides manual recovery when clipboard access fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    render(<SkillsAccess />)
    fireEvent.click(screen.getByRole('button', { name: '复制接入说明' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('复制失败'))
    expect(screen.getByRole('link', { name: '查看 / 下载 SKILL.md' })).toHaveAttribute('href', 'https://edu.executor.life/api/skills/edu-learning/SKILL.md')
  })
})
