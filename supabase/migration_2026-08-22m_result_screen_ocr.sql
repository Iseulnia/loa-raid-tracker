-- 자동 감지 탭의 "레이드 결과화면" 인식을 레이드×난이도별 이미지 템플릿 비교 방식에서 OCR로 전환.
-- 벨가르딘 나이트메어와 종막 하드처럼 배경/체크마크가 비슷한 화면끼리 픽셀 비교로는 계속 헷갈렸는데,
-- 결과화면의 레이드명+난이도 텍스트를 직접 읽어서 매칭하면 훨씬 정확함. 캐릭터 이름 인식과 동일한 방식.
-- 위치가 항상 고정이라(스크롤 없음) 영역을 한 번만 등록하면 모든 레이드에 재사용된다.
-- 이름을 가정하지 않고, template_type을 언급하는 체크 제약을 전부 찾아서 지운 뒤 새로 하나만 만든다
-- (migration l에서 이름 불일치로 겪었던 문제 재발 방지).
do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.raid_clear_templates'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%template_type%'
  loop
    execute format('alter table public.raid_clear_templates drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.raid_clear_templates
  add constraint raid_clear_templates_template_type_check
  check (template_type in ('clear_banner', 'result_screen', 'gate_checkmark', 'status_row', 'character_name', 'result_screen_ocr'));

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.raid_clear_templates'::regclass and contype = 'c';
