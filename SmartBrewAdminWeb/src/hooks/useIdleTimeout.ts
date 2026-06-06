import { useEffect, useRef } from 'react'

const IDLE_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const

export function useIdleTimeout(onIdle: () => void, timeoutMs: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function reset() {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(onIdle, timeoutMs)
    }

    reset()
    IDLE_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }))

    return () => {
      if (timer.current) clearTimeout(timer.current)
      IDLE_EVENTS.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [onIdle, timeoutMs])
}
