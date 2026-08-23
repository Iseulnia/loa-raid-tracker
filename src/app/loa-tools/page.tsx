import { createClient } from "@/lib/supabase/server";
import AuctionBidCalculator from "@/components/AuctionBidCalculator";

export default async function LoaToolsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">로아 도구</h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        레이드 경매 입찰가 계산기예요. 인원수와 현재 경매장 판매가를 넣으면 선점가·손익분기점·직접 사용
        적정가를 계산해줘요. 경매는 이전 입찰가보다 최소 10% 이상 높여야 하는 규칙이 있어서, &ldquo;선점가&rdquo;는
        그 규칙상 다음 입찰이 곧바로 손익분기점에 닿게 만드는 가격이에요 — 이 가격으로 선점해두면 남이 더
        올리기 부담스러워져요.
      </p>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">경매 입찰 계산기</h2>
        <AuctionBidCalculator />
      </section>
    </main>
  );
}
