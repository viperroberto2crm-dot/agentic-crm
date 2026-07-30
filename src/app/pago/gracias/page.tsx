// Página pública de retorno tras el checkout de Stripe (success_url / cancel_url).
// No requiere sesión: vive fuera del grupo (app). El pago real lo confirma el
// webhook; esta página solo le da al paciente un acuse amable.

export const metadata = { title: "Pago" }

export default async function PagoGraciasPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelado?: string }>
}) {
  const { cancelado } = await searchParams
  const canceled = cancelado === "1"

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#F4F7F6",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#15211E",
      }}
    >
      <div
        style={{
          maxWidth: 440,
          width: "100%",
          background: "#fff",
          border: "1px solid #E0E7E4",
          borderRadius: 14,
          padding: "36px 32px",
          textAlign: "center",
          boxShadow: "0 1px 3px rgba(0,0,0,.04)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            margin: "0 auto 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            background: canceled ? "#FBF0DC" : "#E2F2EA",
            color: canceled ? "#8C5A06" : "#1C7A59",
          }}
        >
          {canceled ? "…" : "✓"}
        </div>

        {canceled ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>
              Pago no completado
            </h1>
            <p style={{ color: "#4B5B56", fontSize: 15, margin: 0, lineHeight: 1.6 }}>
              El cobro se canceló y no se hizo ningún cargo. Si fue un error,
              pídele a tu clínica que te reenvíe el link.
              <br />
              <span style={{ color: "#7B8B85", fontSize: 13.5 }}>
                Payment not completed — no charge was made.
              </span>
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>
              ¡Gracias por tu pago!
            </h1>
            <p style={{ color: "#4B5B56", fontSize: 15, margin: 0, lineHeight: 1.6 }}>
              Tu pago se recibió correctamente y quedó registrado con tu clínica.
              Ya puedes cerrar esta ventana.
              <br />
              <span style={{ color: "#7B8B85", fontSize: 13.5 }}>
                Your payment was received — you can close this window.
              </span>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
