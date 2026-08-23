import CheckAutomationTabs from "@/components/CheckAutomationTabs";

export default function CheckAutomationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">체크 자동화</h1>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        화면공유로 클리어를 자동으로 체크하는 두 가지 방식이에요. 계속 켜두고 실시간으로 인식하는
        &ldquo;자동 감지&rdquo;와, 확인할 때만 켜서 참여현황 패널을 스캔하는 &ldquo;메뉴 감지&rdquo;
        중 상황에 맞게 골라 쓰면 돼요.
      </p>
      <CheckAutomationTabs />
      {children}
    </div>
  );
}
