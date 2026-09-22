import { RotateCw } from 'lucide-react'

import { Button } from '@4242labs/design-system/components/button'

export function ErrorState({
  message,
  onRetry,
  title = "Couldn't load projections",
}: {
  message: string
  onRetry: () => void
  title?: string
}) {
  return (
    <div className="banner" data-status="error" role="alert">
      <strong className="banner-lead">{title}</strong>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
        <p>{message}</p>
        <Button className="btn" variant="outline" size="sm" onClick={onRetry}>
          <RotateCw />
          Retry
        </Button>
      </div>
    </div>
  )
}
