import { TEMPLATE_TYPE_LABEL } from "@/components/ScreenCapture";
import type { TemplateType } from "@/app/actions";

type ExampleTemplate = {
  id: string;
  template_type: string;
  url: string | null;
};

/** 친구가 "등록 예시로 공개"해둔 기준 이미지를 보여주는 읽기 전용 갤러리 — 영역을 어떻게 잡아야 하는지
 *  헷갈려하는 사람들이 실제로 저장된 예시를 보고 참고할 수 있게 한다. 삭제/수정 버튼은 없음(본인 것만
 *  본인이 "기준 영역 등록" 목록에서 관리 가능). */
export default function ExampleTemplates({ templates }: { templates: ExampleTemplate[] }) {
  if (templates.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-dashed border-neutral-300 bg-neutral-50/60 p-4 dark:border-neutral-700 dark:bg-neutral-900/40">
      <h3 className="mb-1 text-sm font-semibold text-neutral-700 dark:text-neutral-300">등록 예시</h3>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        친구들이 공개해둔 실제 등록 예시예요. 영역을 어디까지 잘라야 할지 헷갈리면 참고하세요.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {templates.map((t) => {
          const typeLabel = TEMPLATE_TYPE_LABEL[t.template_type as TemplateType] ?? t.template_type;
          return (
            <div key={t.id} className="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              {t.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.url} alt={typeLabel} className="aspect-video w-full bg-neutral-100 object-contain dark:bg-neutral-800" />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center bg-neutral-100 text-xs text-neutral-400 dark:bg-neutral-800 dark:text-neutral-400">
                  미리보기 없음
                </div>
              )}
              <div className="px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300">{typeLabel}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
