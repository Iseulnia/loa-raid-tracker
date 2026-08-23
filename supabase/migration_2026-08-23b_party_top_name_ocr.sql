-- "자동 감지"(/auto-detect) 탭에서도 "메뉴 감지"처럼 캐릭터를 직접 고르지 않고 OCR로 자동 인식할 수 있게
-- 새 기준 영역 타입 추가. 레이드 중에는 항상 화면 우측 파티원 목록 맨 위에 내 캐릭터가 표시되므로, 그
-- 위치 하나만 등록해두면 스캔 중 캐릭터를 바꿔도 자동으로 따라간다. 기존 'character_name'은 캐릭터
-- 선택 메뉴 화면 기준으로 등록하는 타입이라 레이드 중 화면(다른 레이아웃)에는 그대로 못 써서 따로 만듦.
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
    'result_screen_ocr', 'participation_panel_ocr', 'party_top_name_ocr'
  ));

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.raid_clear_templates'::regclass and contype = 'c';
