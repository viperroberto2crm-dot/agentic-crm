import { Skeleton } from "@/components/ui/skeleton"

export default function LeadsLoading() {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-24 bg-zinc-800" />
        <Skeleton className="h-9 w-28 bg-zinc-800" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1 bg-zinc-800" />
        <Skeleton className="h-9 w-40 bg-zinc-800" />
        <Skeleton className="h-9 w-40 bg-zinc-800" />
      </div>
      <div className="space-y-0.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full bg-zinc-800/60" />
        ))}
      </div>
    </div>
  )
}
