"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
export default function PlannerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      router.replace("/login");
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/login");
      } else {
        setReady(true);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });
    return () => listener.subscription.unsubscribe();
  }, [router]);
  if (!ready) {
    return <main className="login-screen"><p className="login-subtitle">Checking secure session...</p></main>;
  }
  return <>{children}</>;
}
