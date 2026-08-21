-- 로스트아크 주간 레이드 체크 트래커 — Supabase 스키마
-- Supabase 프로젝트의 SQL Editor에서 이 파일 전체를 한 번 실행하세요.

-- ─────────────────────────────────────────────
-- 0. allowed_emails: 초대한 친구만 가입할 수 있도록 하는 허용목록.
--    RLS를 켜두고 정책은 하나도 안 만들어서, API로는 아무도 조회/수정 못 하고
--    Supabase SQL Editor에서 직접 관리자만 다룰 수 있다.
-- ─────────────────────────────────────────────
create table if not exists public.allowed_emails (
  email text primary key
);
alter table public.allowed_emails enable row level security;

-- ─────────────────────────────────────────────
-- 1. profiles: auth.users를 확장하는 사용자 프로필
-- ─────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  created_at timestamptz not null default now()
);

-- 신규 가입 시 허용목록에 있는 이메일인지 먼저 확인하고, 통과하면 프로필을 자동 생성한다
-- (닉네임은 이메일 앞부분을 기본값으로).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.allowed_emails where lower(email) = lower(new.email)
  ) then
    raise exception '초대되지 않은 이메일이라 가입할 수 없어요: %', new.email;
  end if;

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
  combat_power numeric,
  class_engraving text, -- 최고 전투력을 기록했을 당시의 직업 각인 (서포터/딜러 구분 표시용)
  is_gold_earner boolean not null default true, -- 골드 획득 캐릭터 6개 제한 표시용
  expedition_label text, -- 원정대(계정) 구분용 이름. 같은 값끼리 같은 계정으로 묶임
  is_main_character boolean not null default false, -- 그 원정대의 대표 캐릭터인지
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
-- 3-1. character_raids: 캐릭터가 "이 레이드를 주간 숙제로 한다"고 고른 목록
--    별도의 레이드 관리 화면 없이, 대시보드의 '숙제 편집' 버튼에서 캐릭터별로 직접 고른다.
-- ─────────────────────────────────────────────
create table if not exists public.character_raids (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  raid_id uuid not null references public.raids (id) on delete cascade,
  is_gold_earning boolean not null default true, -- 캐릭터당 최대 3개까지 직접 골라서 켤 수 있음
  created_at timestamptz not null default now(),
  unique (character_id, raid_id)
);

create index if not exists character_raids_character_idx on public.character_raids (character_id);

-- ─────────────────────────────────────────────
-- 3-2. raid_clear_templates: 화면공유 자동 감지용 "레이드 클리어 화면" 기준 이미지
--    사용자가 화면공유 중 실제 클리어 화면을 캡처해서 저장한 것. 이후 라이브 화면과 비교하는 데 쓴다.
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('raid-clear-templates', 'raid-clear-templates', false)
on conflict (id) do nothing;

create table if not exists public.raid_clear_templates (
  id uuid primary key default gen_random_uuid(),
  -- 'clear_banner'(관문마다 뜨는 "던전 클리어" 배너)와 'gate_checkmark'(관문 체크 아이콘)는
  -- 특정 레이드에 종속되지 않아 raid_id가 비어있을 수 있음. 'result_screen'(결과화면의 레이드명/난이도)만 필수.
  raid_id uuid references public.raids (id) on delete cascade,
  template_type text not null default 'result_screen'
    check (template_type in ('clear_banner', 'result_screen', 'gate_checkmark')),
  crop jsonb, -- 캡처한 원본 프레임 대비 상대 위치 {xPct,yPct,wPct,hPct} (0~1)
  storage_path text not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists raid_clear_templates_raid_idx on public.raid_clear_templates (raid_id);

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

-- 실시간 DELETE 이벤트에 삭제된 행의 전체 컬럼이 실려오게 함 (기본값은 PK만 전달되어
-- 다른 친구 화면에서 체크 해제가 실시간으로 반영되지 않는 문제가 생김)
alter table public.weekly_checks replica identity full;
alter table public.character_raids replica identity full;

-- ─────────────────────────────────────────────
-- 5. RLS: 신뢰된 소규모 친구 그룹 전제 — 로그인한 사람은 전부 조회 가능,
--    본인 소유 데이터만 쓰기 가능. 레이드 목록은 다 같이 관리하는 공용 데이터라 전원 쓰기 허용.
-- ─────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.characters enable row level security;
alter table public.raids enable row level security;
alter table public.character_raids enable row level security;
alter table public.raid_clear_templates enable row level security;
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
alter publication supabase_realtime add table public.character_raids;

-- ─────────────────────────────────────────────
-- 7. 시작용 레이드 시드 데이터 (2026년 8월 5일 패치 기준 클리어 골드표를 토대로 작성 — 패치로 바뀌면 이 파일을 고쳐서
--    SQL Editor에서 다시 실행하세요. 앱 안에는 레이드 마스터 목록을 편집하는 화면이 따로 없습니다.)
--    이 표는 관문별 골드가 아니라 "레이드 1회 클리어당 총 골드" 기준이라 gate_count는 전부 1로 둠
-- ─────────────────────────────────────────────
-- sort_order는 출시 순(최신 -> 과거): 벨가르딘 > 성당 > 세르카 > 종막 > 4막
insert into public.raids (name, difficulty, min_item_level, gate_count, gold_per_gate, sort_order) values
  ('벨가르딘', '노말', 1750, 1, '{50000}', 10),
  ('벨가르딘', '하드', 1770, 1, '{62000}', 11),
  ('벨가르딘', '나이트메어', 1780, 1, '{75000}', 12),
  ('성당', '1단계', 1710, 1, '{30000}', 20),
  ('성당', '2단계', 1720, 1, '{40000}', 21),
  ('성당', '3단계', 1750, 1, '{50000}', 22),
  ('세르카', '노말', 1710, 1, '{32000}', 30),
  ('세르카', '하드', 1730, 1, '{44000}', 31),
  ('세르카', '나이트메어', 1740, 1, '{54000}', 32),
  ('종막', '노말', 1710, 1, '{32000}', 40),
  ('종막', '하드', 1730, 1, '{48000}', 41),
  ('4막', '노말', 1710, 1, '{27000}', 50),
  ('4막', '하드', 1720, 1, '{38000}', 51)
on conflict do nothing;
