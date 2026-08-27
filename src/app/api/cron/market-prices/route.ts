import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { refreshMarketItemPrices } from "@/lib/marketPricesRefresh";
import { LostArkApiError } from "@/lib/lostark";

// 외부 스케줄러(GitHub Actions 등)가 로그인 세션 없이 호출하는 경로라, 아무나 못 부르게 시크릿으로 막는다.
// 로그인한 사용자 화면에서 누르는 "현재가 갱신"(/api/lostark/market POST)과는 별개의 경로.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "서버에 CRON_SECRET 환경 변수가 설정되어 있지 않아요." }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "인증되지 않은 요청이에요." }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleClient();
    const { items } = await refreshMarketItemPrices(supabase, null);
    return NextResponse.json({ updated: items.length });
  } catch (err) {
    console.error("[cron/market-prices] refresh failed:", err);
    if (err instanceof LostArkApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "알 수 없는 오류가 발생했어요." }, { status: 500 });
  }
}
