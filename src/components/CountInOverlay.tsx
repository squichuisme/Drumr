import type { Store } from '../core/store'
import { useStore } from '../core/store'

/** Big "1 2 3 4" shown over the score during the count-in. */
export function CountInOverlay({ store }: { store: Store<number | null> }) {
  const count = useStore(store)
  if (count === null) return null
  return (
    <div className="count-in" aria-live="assertive">
      <span key={count} className="count-in-number">
        {count}
      </span>
    </div>
  )
}
