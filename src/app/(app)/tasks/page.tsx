import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { Badge } from "@/components/ui/badge"
import { NewTaskButton } from "./_components/new-task-button"
import { TaskStatusToggle } from "./_components/task-status-toggle"
import { getTranslations } from "next-intl/server"

type TypedClient = SupabaseClient<Database>
type TaskPriority = Database["public"]["Enums"]["task_priority"]
type TaskStatus = Database["public"]["Enums"]["task_status"]

function fmtDue(d: string | null) {
  if (!d) return null
  const date = new Date(d)
  const now = new Date()
  const diff = date.getTime() - now.getTime()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date)
  return { label: fmt, overdue: days < 0, soon: days >= 0 && days <= 2 }
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("tasks")

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  if (role === "provider") redirect("/appointments")
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const sp = params as Record<string, string | string[] | undefined>
  const statusFilter = typeof sp.status === "string" ? sp.status : "open"
  const priorityFilter = typeof sp.priority === "string" ? sp.priority : null

  const PRIORITY_CONFIG: Record<TaskPriority, { label: string; cls: string }> = {
    urgent: { label: t("urgent"), cls: "border-red-500/40 text-red-400" },
    high:   { label: t("high"),   cls: "border-orange-500/40 text-orange-400" },
    normal: { label: t("normal"), cls: "border-zinc-600 text-gray-500" },
    low:    { label: t("low"),    cls: "border-gray-300 text-gray-400" },
  }

  let query = sb
    .from("tasks")
    .select(
      `id, title, description, due_at, priority, status, created_at,
       lead:leads!tasks_related_lead_id_fkey(id, first_name, last_name),
       rep:users!tasks_assigned_to_fkey(id, name)`,
      { count: "exact" }
    )
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: false })
    .limit(100)

  if (role === "rep") query = query.eq("assigned_to", user.id)
  if (brandId) query = query.eq("brand_id", brandId)
  if (statusFilter && statusFilter !== "all") query = query.eq("status", statusFilter as TaskStatus)
  if (priorityFilter) query = query.eq("priority", priorityFilter as TaskPriority)

  const { data: raw, count } = await query

  type TaskItem = {
    id: string; title: string; description: string | null; due_at: string | null
    priority: TaskPriority; status: TaskStatus; created_at: string
    lead: { id: string; first_name: string; last_name: string | null } | null
    rep: { id: string; name: string } | null
  }
  const tasks = (raw ?? []) as unknown as TaskItem[]

  // Contadores por status y priority (scoped a brand/rep igual que la query principal)
  let countsBase = sb.from("tasks").select("status, priority")
  if (role === "rep") countsBase = countsBase.eq("assigned_to", user.id)
  if (brandId) countsBase = countsBase.eq("brand_id", brandId)
  const { data: countsRaw } = await countsBase
  const allCounts = (countsRaw ?? []) as Array<{ status: TaskStatus; priority: TaskPriority }>

  const counts = {
    status: {
      open: allCounts.filter((r) => r.status === "open").length,
      done: allCounts.filter((r) => r.status === "done").length,
      all: allCounts.length,
    },
    priority: {
      urgent: allCounts.filter((r) => r.priority === "urgent").length,
      high:   allCounts.filter((r) => r.priority === "high").length,
      normal: allCounts.filter((r) => r.priority === "normal").length,
      low:    allCounts.filter((r) => r.priority === "low").length,
    },
  }

  let reps: { id: string; name: string }[] = []
  if (role !== "rep") {
    const { data } = await sb.from("users").select("id, name").eq("active", true).order("name")
    reps = (data ?? []) as typeof reps
  }

  const statusTabs = [
    { value: "open", label: t("open"), count: counts.status.open },
    { value: "done", label: t("done"), count: counts.status.done },
    { value: "all",  label: t("all"),  count: counts.status.all },
  ] as const

  const priorityTabs = [
    { value: null,     label: t("all"),    count: counts.status.all },
    { value: "urgent", label: t("urgent"), count: counts.priority.urgent },
    { value: "high",   label: t("high"),   count: counts.priority.high },
    { value: "normal", label: t("normal"), count: counts.priority.normal },
  ] as const

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{t("title")}</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{count ?? tasks.length} total</span>
          <NewTaskButton brandId={brandId} reps={reps} currentUserId={user.id} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mr-1">
            {t("status")}
          </span>
          {statusTabs.map((tab) => {
            const isActive = statusFilter === tab.value
            return (
              <Link
                key={tab.value}
                href={`/tasks?status=${tab.value}${priorityFilter ? `&priority=${priorityFilter}` : ""}`}
                className={`px-3 py-1 rounded text-xs transition-colors inline-flex items-center gap-1.5 ${
                  isActive ? "bg-gray-200 text-gray-900" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tab.label}
                <span className={`text-[10px] tabular-nums ${isActive ? "text-gray-500" : "text-gray-300"}`}>
                  {tab.count}
                </span>
              </Link>
            )
          })}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mr-1">
            {t("priority")}
          </span>
          {priorityTabs.map((tab) => {
            const isActive = priorityFilter === tab.value
            return (
              <Link
                key={tab.label}
                href={tab.value
                  ? `/tasks?status=${statusFilter}&priority=${tab.value}`
                  : `/tasks?status=${statusFilter}`
                }
                className={`px-3 py-1 rounded text-xs transition-colors inline-flex items-center gap-1.5 ${
                  isActive ? "bg-gray-200 text-gray-900" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tab.label}
                <span className={`text-[10px] tabular-nums ${isActive ? "text-gray-500" : "text-gray-300"}`}>
                  {tab.count}
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {tasks.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">{t("noTasksFilter")}</p>
        ) : (
          tasks.map((task) => {
            const pCfg = PRIORITY_CONFIG[task.priority]
            const due = fmtDue(task.due_at)
            const isDone = task.status === "done"

            return (
              <div key={task.id} className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${isDone ? "opacity-50" : ""}`}>
                <div className="pt-0.5">
                  <TaskStatusToggle id={task.id} status={task.status} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm text-gray-800 font-medium leading-snug ${isDone ? "line-through text-gray-400" : ""}`}>
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{task.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal ${pCfg.cls}`}>
                      {pCfg.label}
                    </Badge>
                    {task.lead && (
                      <Link href={`/leads/${task.lead.id}`} className="text-xs text-gray-400 hover:text-gray-500 transition-colors">
                        {task.lead.first_name} {task.lead.last_name ?? ""}
                      </Link>
                    )}
                    {role !== "rep" && task.rep && (
                      <span className="text-xs text-gray-300">{task.rep.name}</span>
                    )}
                  </div>
                </div>
                {due && (
                  <span className={`text-xs tabular-nums shrink-0 pt-0.5 ${
                    due.overdue ? "text-red-400" : due.soon ? "text-amber-400" : "text-gray-400"
                  }`}>
                    {due.label}
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}
