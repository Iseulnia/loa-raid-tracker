"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data }) => {
      setReady(!!data.session);
      setChecked(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    setStatus("done");
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1200);
  }

  if (!checked) return null;

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          링크가 만료됐거나 유효하지 않아요. 로그인 화면에서 &lsquo;비밀번호를 잊으셨나요?&rsquo;로 다시
          요청해주세요.
        </p>
      </main>
    );
  }

  if (status === "done") {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6 text-center">
        <p className="text-sm text-emerald-600 dark:text-emerald-400">비밀번호가 변경됐어요. 이동할게요...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-center text-xl font-bold text-neutral-900 dark:text-neutral-100">새 비밀번호 설정</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          required
          minLength={6}
          placeholder="새 비밀번호 (6자 이상)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {status === "loading" ? "저장 중..." : "비밀번호 저장"}
        </button>
        {status === "error" && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
      </form>
    </main>
  );
}
