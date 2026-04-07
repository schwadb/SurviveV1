import { useState, useEffect, useRef, useCallback } from 'react'

export type TimelineSpeed = 1 | 5 | 30 | 60 | 300

export interface TimelineState {
  currentTime: Date
  isPlaying: boolean
  speed: TimelineSpeed
  isLive: boolean
}

export interface TimelineControls {
  play: () => void
  pause: () => void
  setSpeed: (speed: TimelineSpeed) => void
  scrubTo: (date: Date) => void
  goLive: () => void
  stepForward: (minutes?: number) => void
  stepBackward: (minutes?: number) => void
}

export function useTimeline(): TimelineState & TimelineControls {
  const [currentTime, setCurrentTime] = useState<Date>(new Date())
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeedState] = useState<TimelineSpeed>(1)
  const [isLive, setIsLive] = useState(true)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const speedRef = useRef(speed)
  speedRef.current = speed

  const clearTick = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startTick = useCallback(() => {
    clearTick()
    intervalRef.current = setInterval(() => {
      setCurrentTime(prev => {
        const next = new Date(prev.getTime() + speedRef.current * 1000)
        const now = new Date()
        if (next >= now) {
          setIsLive(true)
          return now
        }
        setIsLive(false)
        return next
      })
    }, 1000)
  }, [clearTick])

  const play = useCallback(() => {
    setIsPlaying(true)
    startTick()
  }, [startTick])

  const pause = useCallback(() => {
    setIsPlaying(false)
    clearTick()
  }, [clearTick])

  const setSpeed = useCallback((s: TimelineSpeed) => {
    setSpeedState(s)
    speedRef.current = s
    // Restart tick if playing so new speed takes effect
    if (intervalRef.current) {
      startTick()
    }
  }, [startTick])

  const scrubTo = useCallback((date: Date) => {
    const now = new Date()
    setCurrentTime(date >= now ? now : date)
    setIsLive(date >= now)
  }, [])

  const goLive = useCallback(() => {
    setCurrentTime(new Date())
    setIsLive(true)
  }, [])

  const stepForward = useCallback((minutes = 5) => {
    setCurrentTime(prev => {
      const next = new Date(prev.getTime() + minutes * 60_000)
      const now = new Date()
      if (next >= now) { setIsLive(true); return now }
      setIsLive(false)
      return next
    })
  }, [])

  const stepBackward = useCallback((minutes = 5) => {
    setIsLive(false)
    setCurrentTime(prev => new Date(prev.getTime() - minutes * 60_000))
  }, [])

  // Live mode: keep syncing to real time when not playing back
  useEffect(() => {
    if (isLive && !isPlaying) {
      const sync = setInterval(() => setCurrentTime(new Date()), 5000)
      return () => clearInterval(sync)
    }
  }, [isLive, isPlaying])

  useEffect(() => () => clearTick(), [clearTick])

  return {
    currentTime,
    isPlaying,
    speed,
    isLive,
    play,
    pause,
    setSpeed,
    scrubTo,
    goLive,
    stepForward,
    stepBackward,
  }
}
