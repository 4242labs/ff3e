export function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-label="Loading data" role="status">
      <div className="sec-head"><p>Loading</p></div>
      <div className="flex flex-col" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="row row-skeleton" key={index}>
            <div className="row-main">
              <div className="row-title">Loading</div>
              <div className="row-sub">Loading data</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
