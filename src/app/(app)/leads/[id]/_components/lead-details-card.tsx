import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MapPin, Phone, User, FileText } from "lucide-react"

type Props = {
  address: {
    line1: string | null
    line2: string | null
    city: string | null
    state: string | null
    zip: string | null
  }
  phoneAlt: string | null
  repName: string | null
  notes: string | null
  labels: {
    title: string
    address: string
    phoneAlt: string
    rep: string
    notes: string
    none: string
  }
}

function addressLines(a: Props["address"]): string[] {
  const street = [a.line1, a.line2].map((s) => s?.trim()).filter(Boolean).join(", ")
  const cityLine = [a.city?.trim(), [a.state?.trim(), a.zip?.trim()].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ")
  return [street, cityLine].filter(Boolean)
}

export function LeadDetailsCard({ address, phoneAlt, repName, notes, labels }: Props) {
  const addr = addressLines(address)

  return (
    <Card className="bg-white border border-[#EAE3D5] shadow-[0_1px_2px_rgba(46,63,58,0.04),0_6px_18px_-8px_rgba(46,63,58,0.12)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
          {labels.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3.5">
        <Row icon={<MapPin className="w-3.5 h-3.5" />} label={labels.address}>
          {addr.length > 0 ? (
            <div className="space-y-0.5">
              {addr.map((line, i) => (
                <p key={i} className="text-sm text-foreground leading-snug">{line}</p>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">{labels.none}</span>
          )}
        </Row>

        <Row icon={<Phone className="w-3.5 h-3.5" />} label={labels.phoneAlt}>
          {phoneAlt ? (
            <a href={`tel:${phoneAlt}`} className="text-sm text-foreground tabular-nums hover:underline">
              {phoneAlt}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">{labels.none}</span>
          )}
        </Row>

        <Row icon={<User className="w-3.5 h-3.5" />} label={labels.rep}>
          <span className={repName ? "text-sm text-foreground" : "text-sm text-muted-foreground"}>
            {repName ?? labels.none}
          </span>
        </Row>

        <Row icon={<FileText className="w-3.5 h-3.5" />} label={labels.notes}>
          {notes?.trim() ? (
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{notes}</p>
          ) : (
            <span className="text-sm text-muted-foreground">{labels.none}</span>
          )}
        </Row>
      </CardContent>
    </Card>
  )
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-2.5">
      <span className="text-[#93A39D] mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
        {children}
      </div>
    </div>
  )
}
