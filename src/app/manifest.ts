import type { MetadataRoute } from "next"

// Manifest de la app instalable (Android "Instalar app" / iPhone "Agregar a
// inicio"). Iconos generados con scripts/generate-pwa-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HORIZON CRM",
    short_name: "HORIZON",
    description: "Si Se Pierde / Sunny Slim Wellness Center — CRM",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F6F1E7",
    theme_color: "#0C3B30",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
