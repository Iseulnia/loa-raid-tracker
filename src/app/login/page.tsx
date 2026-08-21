"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const supabase = createClient();

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: nickname ? { nickname } : undefined },
      });
      if (error) {
        setStatus("error");
        setErrorMessage(
          error.message.includes("Database error")
            ? "초대되지 않은 이메일이라 가입할 수 없어요. 방장에게 초대를 요청해주세요."
            : error.message
        );
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setStatus("error");
        setErrorMessage(error.message === "Invalid login credentials" ? "이메일 또는 비밀번호가 맞지 않아요." : error.message);
        return;
      }
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">로아 숙제 체크</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">친구들끼리 쓰는 주간 레이드 체크리스트</p>
      </div>

      <div className="flex rounded-lg border border-neutral-300 p-1 text-sm dark:border-neutral-700">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={[
            "flex-1 rounded-md py-1.5 font-medium",
            mode === "signin"
              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
              : "text-neutral-500 dark:text-neutral-400",
          ].join(" ")}
        >
          로그인
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={[
            "flex-1 rounded-md py-1.5 font-medium",
            mode === "signup"
              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
              : "text-neutral-500 dark:text-neutral-400",
          ].join(" ")}
        >
          처음이에요 (회원가입)
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500"
        />
        {mode === "signup" && (
          <input
            type="text"
            placeholder="닉네임"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500"
          />
        )}
        <input
          type="password"
          required
          minLength={6}
          placeholder="비밀번호 (6자 이상)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {status === "loading" ? "처리 중..." : mode === "signup" ? "회원가입" : "로그인"}
        </button>
        {status === "error" && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
      </form>
    </main>
  );
}
