import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// service_role 키는 RLS를 전부 무시한다 — 로그인 세션이 없는 서버-to-서버 호출(크론 등)에서만 쓰고,
// 절대 클라이언트에 노출하거나 사용자 요청 경로에서 쓰지 않는다. 이 파일은 서버 전용 코드에서만 import할 것.
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 환경 변수가 설정되어 있지 않아요.");
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
