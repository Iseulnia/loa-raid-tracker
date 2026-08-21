"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
        data: nickname ? { nickname } : undefined,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">로아 숙제 체크</h1>
        <p className="mt-1 text-sm text-neutral-500">친구들끼리 쓰는 주간 레이드 체크리스트</p>
      </div>

      {status === "sent" ? (
        <p className="rounded-lg bg-emerald-50 p-4 text-center text-sm text-emerald-700">
          {email} 로 로그인 링크를 보냈어요. 메일함을 확인해주세요.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-neutral-300 px-4 py-2 outline-none focus:border-neutral-500"
          />
          <input
            type="text"
            placeholder="닉네임 (처음 로그인할 때만)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="rounded-lg border border-neutral-300 px-4 py-2 outline-none focus:border-neutral-500"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {status === "sending" ? "전송 중..." : "로그인 링크 받기"}
          </button>
          {status === "error" && <p className="text-sm text-red-600">{errorMessage}</p>}
        </form>
      )}
    </main>
  );
}
