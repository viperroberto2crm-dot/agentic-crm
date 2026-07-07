import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardLoading() {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Greeting */}
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-16 bg-[#E8E4DC]/60" />
        <Skeleton className="h-7 w-44 bg-[#E8E4DC]/60" />
        <Skeleton className="h-3 w-72 bg-[#E8E4DC]/60" />
      </div>

      {/* Agent summary card */}
      <Skeleton className="h-[88px] w-full bg-[#E8E4DC]/60 rounded-lg" />

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 bg-[#E8E4DC]/60 rounded-lg" />
        ))}
      </div>

      {/* Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-72 bg-[#E8E4DC]/60 rounded-lg" />
        <Skeleton className="h-72 bg-[#E8E4DC]/60 rounded-lg" />
      </div>
    </div>
  )
}
