import { useEffect, useState } from 'react'

/** 轻量 media query hook, 用于响应式分支 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])

  return matches
}

/** 是否是 Tailwind md breakpoint 以上 (>= 768px) */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)')
}
