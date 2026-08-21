import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchRoster, fetchCombatPower, fetchClassEngraving, LostArkApiError } from "@/lib/lostark";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  }

  const name = request.nextUrl.searchParams.get("name")?.trim();
  if (!name) {
    return NextResponse.json({ error: "캐릭터명을 입력해주세요." }, { status: 400 });
  }

  try {
    const roster = await fetchRoster(name);
    // 캐릭터별 전투력/직업 각인은 별도 API 호출이 필요해서 병렬로 채워넣는다 (실패해도 나머지는 계속 진행).
    const enriched = await Promise.all(
      roster.map(async (r) => {
        const [CombatPower, ClassEngraving] = await Promise.all([
          fetchCombatPower(r.CharacterName),
          fetchClassEngraving(r.CharacterName),
        ]);
        return { ...r, CombatPower, ClassEngraving };
      })
    );
    return NextResponse.json({ roster: enriched });
  } catch (err) {
    console.error("[lostark/roster] fetch failed:", err);
    if (err instanceof LostArkApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "알 수 없는 오류가 발생했어요." }, { status: 500 });
  }
}
