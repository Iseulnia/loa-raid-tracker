-- 이전 마이그레이션(migration_2026-08-26_gem_price_snapshots.sql)까지 실행한 프로젝트에 이어서 적용하세요.
--
-- 대시보드/공격대 탭에서 "이번 주에 이 레이드는 약속이 잡혀 있다"를 표시하기 위한 테이블.
-- 체크(weekly_checks)와는 완전히 별개다 — 약속은 "아직 안 간 상태"라서 클리어 수/남은 골드 계산에는
-- 전혀 반영하지 않고, 화면에서 노란 배경 + 자물쇠로만 구분해서 보여준다.
--
-- week_key를 같이 저장하는 이유도 weekly_checks와 같다: 주간 초기화가 지나면 해당 week_key 행이 그냥
-- 조회되지 않으므로 별도 정리 배치 없이 자동으로 풀린다.

create table if not exists public.weekly_raid_locks (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  raid_id uuid not null references public.raids (id) on delete cascade,
  week_key text not null,
  locked_by uuid not null references public.profiles (id),
  locked_at timestamptz not null default now(),
  unique (character_id, raid_id, week_key)
);

create index if not exists weekly_raid_locks_week_key_idx on public.weekly_raid_locks (week_key);

-- Realtime DELETE 이벤트에서도 character_id/raid_id를 받아야 다른 사람 화면에서 잠금이 풀리므로 full 필요
alter table public.weekly_raid_locks replica identity full;

alter table public.weekly_raid_locks enable row level security;

-- 다시 실행해도 에러가 나지 않도록 먼저 지우고 만든다
drop policy if exists "raid_locks_select_all" on public.weekly_raid_locks;
drop policy if exists "raid_locks_insert_own_character" on public.weekly_raid_locks;
drop policy if exists "raid_locks_delete_own_character" on public.weekly_raid_locks;

create policy "raid_locks_select_all" on public.weekly_raid_locks
  for select using (auth.role() = 'authenticated');
create policy "raid_locks_insert_own_character" on public.weekly_raid_locks
  for insert with check (
    exists (
      select 1 from public.characters c
      where c.id = character_id and c.owner_id = auth.uid()
    )
  );
create policy "raid_locks_delete_own_character" on public.weekly_raid_locks
  for delete using (
    exists (
      select 1 from public.characters c
      where c.id = character_id and c.owner_id = auth.uid()
    )
  );

-- 이미 publication에 들어있으면 add가 에러를 내므로 확인 후 추가
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'weekly_raid_locks'
  ) then
    alter publication supabase_realtime add table public.weekly_raid_locks;
  end if;
end
$$;
