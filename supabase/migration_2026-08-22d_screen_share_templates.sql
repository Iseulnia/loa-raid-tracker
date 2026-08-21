-- 이전 마이그레이션(migration_2026-08-22c_gold_earning_choice.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- 화면공유로 레이드 클리어를 자동 감지하는 기능의 첫 단계: 기준 이미지를 저장할 Storage 버킷 + 테이블.

insert into storage.buckets (id, name, public)
values ('raid-clear-templates', 'raid-clear-templates', false)
on conflict (id) do nothing;

create table if not exists public.raid_clear_templates (
  id uuid primary key default gen_random_uuid(),
  raid_id uuid not null references public.raids (id) on delete cascade,
  storage_path text not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists raid_clear_templates_raid_idx on public.raid_clear_templates (raid_id);

alter table public.raid_clear_templates enable row level security;

create policy "raid_clear_templates_select_all" on public.raid_clear_templates
  for select using (auth.role() = 'authenticated');
create policy "raid_clear_templates_insert_own" on public.raid_clear_templates
  for insert with check (auth.uid() = created_by);
create policy "raid_clear_templates_delete_own" on public.raid_clear_templates
  for delete using (auth.uid() = created_by);

create policy "raid_clear_template_files_select" on storage.objects
  for select using (bucket_id = 'raid-clear-templates' and auth.role() = 'authenticated');
create policy "raid_clear_template_files_insert" on storage.objects
  for insert with check (bucket_id = 'raid-clear-templates' and auth.role() = 'authenticated');
create policy "raid_clear_template_files_delete" on storage.objects
  for delete using (bucket_id = 'raid-clear-templates' and auth.role() = 'authenticated');
