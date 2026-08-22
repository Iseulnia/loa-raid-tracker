-- "메뉴 감지" 탭에서 게임 메뉴 화면 좌측 하단에 항상 고정 위치로 뜨는 캐릭터 이름(+레벨)을 인식해서,
-- 스캔할 때마다 캐릭터를 수동으로 고르지 않아도 자동으로 어떤 캐릭터인지 알아내기 위한 템플릿.
-- 참여현황 패널(raid_label 방식)과 달리 이 이름표는 화면에서 위치가 스크롤 등으로 안 바뀌므로,
-- 결과화면 매칭과 동일한 고정 위치 비교(templateMatch.ts)를 그대로 재사용한다.
alter table public.raid_clear_templates
  drop constraint if exists raid_clear_templates_template_type_check;
alter table public.raid_clear_templates
  add constraint raid_clear_templates_template_type_check
  check (template_type in ('clear_banner', 'result_screen', 'gate_checkmark', 'status_row', 'character_name'));

alter table public.raid_clear_templates
  add column if not exists character_id uuid references public.characters (id) on delete cascade;

create index if not exists raid_clear_templates_character_idx on public.raid_clear_templates (character_id);
