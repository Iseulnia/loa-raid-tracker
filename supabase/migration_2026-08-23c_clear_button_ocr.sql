-- 결과화면 인식 영역(레이드명+난이도+체크마크+나가기 버튼)을 한 크롭에 다 넣어서 OCR로 읽었더니,
-- 체크마크 아이콘/버튼 테두리 같은 그래픽 요소가 섞여서 "나가기" 부분이 자꾸 엉뚱한 글자로 깨지는
-- 문제가 있었다("또칼^" 같은 잡음). 그래서 "나가기" 버튼 텍스트만 따로 좁게 등록할 수 있는 새 기준
-- 영역 타입을 추가한다 — 등록해두면 이걸 우선 쓰고, 없으면 예전처럼 결과화면 영역 안에서 찾는다(하위 호환).
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
  check (template_type in (
    'clear_banner', 'result_screen', 'gate_checkmark', 'status_row', 'character_name',
    'result_screen_ocr', 'participation_panel_ocr', 'party_top_name_ocr', 'clear_button_ocr'
  ));

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.raid_clear_templates'::regclass and contype = 'c';
