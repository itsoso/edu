import { fireEvent, render, screen, within } from '@testing-library/react'
import Explore from './Explore'

describe('Explore', () => {
  it('combines subject and keyword filters and recovers from no results', () => {
    render(<Explore />)
    expect(screen.getAllByRole('article')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: '化学' }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '抛物线' } })
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(screen.getAllByRole('article')).toHaveLength(4)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  氧气  ' } })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: '跟着一个氧分子，走进身体' })).toBeInTheDocument()
  })

  it('requires an answer, explains mistakes and clears stale feedback when retrying', () => {
    render(<Explore />)
    const card = within(screen.getByRole('article', { name: '跟着一个氧分子，走进身体' }))
    fireEvent.click(card.getByText('探索任务与自测'))
    const submit = card.getByRole('button', { name: '检查理解' })
    expect(submit).toBeDisabled()
    fireEvent.click(card.getByLabelText('心脏把肺泡中的氧气直接吸入血管'))
    fireEvent.click(submit)
    expect(card.getByRole('status')).toHaveTextContent('再想一想')
    fireEvent.click(card.getByLabelText('氧气沿浓度差扩散'))
    expect(card.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(submit)
    expect(card.getByRole('status')).toHaveTextContent('答对了')
    expect(card.getByRole('status')).toHaveTextContent('气体交换依靠扩散')
    const chemistry = within(screen.getByRole('article', { name: '配平方程式：原子一个也不能少' }))
    expect(chemistry.queryByRole('status')).not.toBeInTheDocument()
  })

  it('links to original resources in a separate window', () => {
    render(<Explore />)
    const links = screen.getAllByRole('link', { name: /打开交互资源/ })
    expect(links).toHaveLength(4)
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link.getAttribute('href')).toMatch(/^https:\/\//)
    }
  })
})
