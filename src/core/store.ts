import { useSyncExternalStore } from 'react'

/**
 * A minimal observable value. Fast-changing playback state (cursor step,
 * count-in number) lives in stores so that only the small components that
 * display it re-render — not the whole app on every 16th note.
 */
export interface Store<T> {
  get(): T
  set(value: T): void
  subscribe(listener: () => void): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const l of listeners) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get)
}
