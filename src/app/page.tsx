import { redirect } from "next/navigation";

export default function Home() {
  // El middleware ya valida auth: si no hay sesión, te manda a /login.
  // Si hay sesión, te trae aquí y desde aquí redirigimos al dashboard.
  redirect("/dashboard");
}
