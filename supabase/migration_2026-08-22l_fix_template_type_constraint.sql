-- 이전 마이그레이션(j, k)에서 "raid_clear_templates_template_type_check"라는 이름으로 체크 제약을
-- drop 후 재생성했는데, 실제 테이블의 제약 이름이 그거였는지 확신할 수 없었다 (Supabase가 다르게
-- 이름 붙였을 가능성). 이름을 가정하지 않고, template_type을 언급하는 체크 제약을 전부 찾아서 지운 뒤
-- 새로 하나만 만든다 — 예전 제약이 남아있었다면 status_row/character_name insert가 계속 막혔을 것.
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
  check (template_type in ('clear_banner', 'result_screen', 'gate_checkmark', 'status_row', 'character_name'));

-- 혹시 이전 마이그레이션이 부분적으로만 적용됐을 경우를 대비해 컬럼도 다시 한번 보장한다 (있으면 무시됨).
alter table public.raid_clear_templates
  add column if not exists raid_label text,
  add column if not exists badge_crop jsonb,
  add column if not exists character_id uuid references public.characters (id) on delete cascade;

create index if not exists raid_clear_templates_character_idx on public.raid_clear_templates (character_id);

-- 확인용: 지금 이 테이블에 실제로 걸려있는 체크 제약 내용을 보여준다.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.raid_clear_templates'::regclass and contype = 'c';
