-- 이전 마이그레이션(migration_2026-08-22_combat_power_and_raids.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- '레이드 관리' 화면을 없애고, 캐릭터별로 자기가 도는 레이드를 직접 고르는 방식으로 바꾸면서 추가되는 테이블입니다.

create table if not exists public.character_raids (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  raid_id uuid not null references public.raids (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (character_id, raid_id)
);

create index if not exists character_raids_character_idx on public.character_raids (character_id);

alter table public.character_raids enable row level security;

create policy "character_raids_select_all" on public.character_raids
  for select using (auth.role() = 'authenticated');
create policy "character_raids_insert_own" on public.character_raids
  for insert with check (
    exists (
      select 1 from public.characters c
      where c.id = character_id and c.owner_id = auth.uid()
    )
  );
create policy "character_raids_delete_own" on public.character_raids
  for delete using (
    exists (
      select 1 from public.characters c
      where c.id = character_id and c.owner_id = auth.uid()
    )
  );

alter publication supabase_realtime add table public.character_raids;

-- 실시간 DELETE 이벤트에 전체 컬럼이 실려오게 함 (기본값은 PK만 전달되어
-- 다른 친구 화면에서 체크 해제/숙제 삭제가 실시간으로 반영되지 않는 문제가 있었음)
alter table public.character_raids replica identity full;
alter table public.weekly_checks replica identity full;
