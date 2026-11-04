export function PosterSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex gap-4 overflow-hidden py-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="w-[8.6rem] shrink-0 md:w-[10.5rem] xl:w-[11.6rem]">
          <div className="skeleton aspect-[2/3] w-full" />
          <div className="skeleton mt-2 h-3 w-4/5" />
          <div className="skeleton mt-1.5 h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  )
}

export function WideSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-4 overflow-hidden py-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="w-[17rem] shrink-0 md:w-[19rem] xl:w-[21rem]">
          <div className="skeleton aspect-video w-full" />
          <div className="skeleton mt-2 h-3 w-3/4" />
        </div>
      ))}
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="shell-x space-y-10 pt-28 pb-24">
      <div className="skeleton h-[52vh] w-full rounded-lg" />
      <div className="space-y-3">
        <div className="skeleton h-5 w-48" />
        <PosterSkeleton />
      </div>
      <div className="space-y-3">
        <div className="skeleton h-5 w-40" />
        <PosterSkeleton />
      </div>
    </div>
  )
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="skeleton aspect-[2/3] w-full" />
          <div className="skeleton mt-2 h-2.5 w-4/5" />
        </div>
      ))}
    </div>
  )
}
