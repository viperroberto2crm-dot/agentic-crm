"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Circle } from "lucide-react"
import { updateTaskStatus } from "../actions"
import type { Database } from "@/types/database"

type TaskStatus = Database["public"]["Enums"]["task_status"]

export function TaskStatusToggle({ id, status }: { id: string; status: TaskStatus }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function toggle() {
    const next: TaskStatus = status === "open" ? "done" : "open"
    startTransition(async () => {
      await updateTaskStatus(id, next)
      router.refresh()
    })
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className="flex items-center justify-center w-5 h-5 rounded-full border transition-colors cursor-pointer disabled:opacity-50"
      style={{
        borderColor: status === "done" ? "var(--brand)" : "rgb(63 63 70)",
        background: status === "done" ? "var(--brand)" : "transparent",
      }}
    >
      {status === "done" ? (
        <Check className="w-3 h-3 text-white" />
      ) : (
        <Circle className="w-2.5 h-2.5 text-zinc-700" />
      )}
    </button>
  )
}
