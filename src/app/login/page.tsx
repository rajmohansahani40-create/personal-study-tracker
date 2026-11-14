"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/planner");
    });
  }, [router]);
  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    if (!email.trim() || !email.includes("@")) {
      setMessage("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setMessage("Please enter your password.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setMessage("Supabase configuration missing. Please configure .env.local.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      setMessage("Login failed. Check your email and password, and confirm that your account exists in Supabase Auth.");
      return;
    }
    router.replace("/planner");
  }
  return (
    <main className="login-screen">
      <div className="login-glow login-glow-one" />
      <div className="login-glow login-glow-two" />
      <section className="login-card">
        <div className="login-logo">S</div>
        <p className="login-kicker">PERSONAL STUDY WORKSPACE</p>
        <h1>Welcome <span>Back.</span></h1>
        <p className="login-subtitle">
          Sign in and continue your learning journey.
        </p>
        <form onSubmit={handleLogin}>
          <label htmlFor="email">Email Address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="Enter your email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          {message && (
            <p className="login-message" role="alert">{message}</p>
          )}
          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In  →"}
          </button>
        </form>
        <div className="login-footer">
          <span>SECURE AUTHENTICATION</span>
          <span>POWERED BY SUPABASE</span>
        </div>
      </section>
    </main>
  );
}
