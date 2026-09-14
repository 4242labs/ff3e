export function EmptyState({ message }: { message?: string }) {
  return (
    <div className="empty" role="status">
      <p className="lbl">Nothing here</p>
      <p>{message ?? 'No obligations in this range.'}</p>
    </div>
  )
}
