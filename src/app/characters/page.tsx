import { createClient } from "@/lib/supabase/server";
import CharacterManager from "@/components/CharacterManager";

export default async function CharactersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: characters } = await supabase
    .from("characters")
    .select(
      "id, owner_id, name, server, class, item_level, combat_power, is_gold_earner, expedition_label, is_main_character, sort_order"
    )
    .eq("owner_id", user.id)
    .order("sort_order");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <h1 className="mb-1 text-xl font-bold">내 캐릭터</h1>
      <p className="mb-6 text-sm text-neutral-500">
        대표 캐릭터명을 입력하면 같은 원정대의 캐릭터를 한 번에 불러올 수 있어요. (아이템레벨은 로스트아크
        오픈 API 기준으로 불러온 시점의 값이라, 성장한 뒤에는 다시 불러와서 갱신해주세요.) 부계정·부부계정처럼
        원정대가 여러 개면 원정대 이름을 다르게 붙여서 구분해주세요.
      </p>
      <CharacterManager initialCharacters={characters ?? []} />
    </main>
  );
}
