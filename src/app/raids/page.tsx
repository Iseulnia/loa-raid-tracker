import { createClient } from "@/lib/supabase/server";
import RaidManager from "@/components/RaidManager";

export default async function RaidsPage() {
  const supabase = await createClient();
  const { data: raids } = await supabase
    .from("raids")
    .select("id, name, difficulty, min_item_level, gate_count, gold_per_gate, sort_order, is_active")
    .order("sort_order");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <h1 className="mb-1 text-xl font-bold">레이드 관리</h1>
      <p className="mb-6 text-sm text-neutral-500">
        패치로 레이드가 바뀌면 여기서 직접 추가/수정하세요. 모두가 같이 보는 공용 목록이에요.
      </p>
      <RaidManager initialRaids={raids ?? []} />
    </main>
  );
}
