import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Server actions handle their own auth — skip redirect check for them
  const isServerAction = request.headers.get("Next-Action") !== null

  let user = null
  try {
    const result = await supabase.auth.getUser()
    user = result.data.user
  } catch {
    // Edge runtime network failure: fall back to local JWT decode (no network call)
    const sessionResult = await supabase.auth.getSession()
    user = sessionResult.data.session?.user ?? null
  }

  const url = request.nextUrl.clone()
  const isAuthPath = url.pathname === "/login"

  if (!user && !isAuthPath && !isServerAction) {
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (user && isAuthPath) {
    url.pathname = "/dashboard"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
