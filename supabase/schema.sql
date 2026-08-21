-- 로스트아크 주간 레이드 체크 트래커 — Supabase 스키마
-- Supabase 프로젝트의 SQL Editor에서 이 파일 전체를 한 번 실행하세요.

-- ─────────────────────────────────────────────
-- 1. profiles: auth.users를 확장하는 사용자 프로필
-- ─────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  created_at timestamptz not null default now()
);

-- 신규 가입 시 자동으로 프로필 생성 (닉네임은 이메일 앞부분을 기본값으로)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────
-- 2. characters: 각 유저가 등록한 캐릭터
-- ─────────────────────────────────────────────
create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  server text,
  class text,
  item_level numeric,
  is_gold_earner boolean not null default true, -- 골드 획득 캐릭터 6개 제한 표시용
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

-- ─────────────────────────────────────────────
-- 3. raids: 레이드/난이도 목록 (패치마다 바뀌므로 앱 내에서 직접 수정 가능하게 설계)
-- ─────────────────────────────────────────────
create table if not exists public.raids (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  difficulty text not null,               -- 예: 노말 / 하드 / 나이트메어 / 싱글
  min_item_level numeric not null default 0,
  gate_count int not null default 1,
  gold_per_gate numeric[] not null default '{}', -- 관문별 골드 (인덱스 0 = 1관문)
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 4. weekly_checks: 주차별 체크 기록
--    week_key는 코드에서 계산 (수요일 06:00 KST 기준 그 주의 수요일 날짜, 'YYYY-MM-DD')
--    → 새 주가 되면 그냥 해당 week_key row가 없으므로 자동으로 "미체크" 상태가 됨 (별도 리셋 배치 불필요)
-- ─────────────────────────────────────────────
create table if not exists public.weekly_checks (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  raid_id uuid not null references public.raids (id) on delete cascade,
  gate_number int not null,
  week_key text not null,
  checked_by uuid not null references public.profiles (id),
  checked_at timestamptz not null default now(),
  unique (character_id, raid_id, gate_number, week_key)
);

create index if not exists weekly_checks_week_key_idx on public.weekly_checks (week_key);
create index if not exists characters_owner_idx on public.characters (owner_id);

-- ─────────────────────────────────────────────
-- 5. RLS: 신뢰된 소규모 친구 그룹 전제 — 로그인한 사람은 전부 조회 가능,
--    본인 소유 데이터만 쓰기 가능. 레이드 목록은 다 같이 관리하는 공용 데이터라 전원 쓰기 허용.
-- ─────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.characters enable row level security;
alter table public.raids enable row level security;
alter table public.weekly_checks enable row level security;

create policy "profiles_select_all" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "characters_select_all" on public.characters
  for select using (auth.role() = 'authenticated');
create policy "characters_insert_own" on public.characters
  for insert with check (auth.uid() = owner_id);
create policy "characters_update_own" on public.characters
  for update using (auth.uid() = owner_id);
create policy "characters_delete_own" on public.characters
  for delete using (auth.uid() = owner_id);

create policy "raids_select_all" on public.raids
  for select using (auth.role() = 'authenticated');
create policy "raids_write_all" on public.raids
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "checks_select_all" on public.weekly_checks
  for select using (auth.role() = 'authenticated');
create policy "checks_insert_own_character" on public.weekly_checks
  for insert with check (
    exists (
      select 1 from public.characters c
      where c.id = character_id and c.owner_id = auth.uid()
    )
  );
create policy "checks_delete_own_character" on public.weekly_checks
  for delete using (
    exists (
      select 1 from public.characters c
      where c.id = character_id and c.owner_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────
-- 6. 실시간 브로드캐스트 활성화 (체크하면 다른 친구 화면에도 바로 반영)
-- ─────────────────────────────────────────────
alter publication supabase_realtime add table public.weekly_checks;
alter publication supabase_realtime add table public.characters;

-- ─────────────────────────────────────────────
-- 7. 시작용 레이드 시드 데이터 (2026년 8월 기준 — 패치로 바뀌면 /raids 페이지에서 직접 수정하세요)
-- ─────────────────────────────────────────────
insert into public.raids (name, difficulty, min_item_level, gate_count, gold_per_gate, sort_order) values
  ('모르둠', '노말', 1660, 4, '{3000,3000,3600,4200}', 10),
  ('모르둠', '하드', 1680, 4, '{4000,4000,4700,5400}', 11),
  ('아브렐슈드', '노말', 1670, 2, '{6000,7000}', 20),
  ('아브렐슈드', '하드', 1690, 2, '{7500,8500}', 21),
  ('에기르', '노말', 1700, 3, '{3800,4200,5000}', 30),
  ('에기르', '하드', 1720, 3, '{4600,5000,6000}', 31)
on conflict do nothing;
