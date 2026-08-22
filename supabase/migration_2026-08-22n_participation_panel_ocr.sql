-- "레이드 참여 현황" 패널 인식을 레이드별 이름표+배지 슬라이딩 검색 방식에서 OCR로 전환.
-- 패널 전체 영역을 한 번만 등록해두면, 스캔할 때마다 그 영역을 통째로 OCR로 읽어서 등록된 레이드
-- 이름들이 몇 번째 줄에 있는지/그 줄에 "완료"가 같이 있는지로 판정한다. 레이드별로 이름표+배지를
-- 따로 등록할 필요가 없어짐 (character_name/result_screen_ocr와 동일한 방식).
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
    'result_screen_ocr', 'participation_panel_ocr'
  ));

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.raid_clear_templates'::regclass and contype = 'c';
