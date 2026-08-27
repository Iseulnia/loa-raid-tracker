-- 이전 마이그레이션(migration_2026-08-25b_character_raids_update_policy.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- 로아 도구 > 보석 가격 탭용. 겁화/작열의 보석은 "거래소"가 아니라 "경매장" 아이템이라 로스트아크 공식
-- API가 현재 매물만 알려주고 과거 시세 통계를 안 준다. 그래서 "현재가 갱신"을 누를 때마다 그 시점 최저가를
-- 이 테이블에 한 행씩 쌓아서, 우리가 직접 하루 평균/전일 대비/7일 추이를 만들 수 있는 데이터를 모은다.

create table if not exists public.gem_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  gem_key text not null, -- 예: 'gyeokhwa_8', 'jagyeol_10' (레벨+종류)
  price numeric not null,
  recorded_by uuid references public.profiles (id),
  recorded_at timestamptz not null default now()
);

create index if not exists gem_price_snapshots_gem_key_idx on public.gem_price_snapshots (gem_key, recorded_at desc);

alter table public.gem_price_snapshots enable row level security;

create policy "gem_price_snapshots_select_all" on public.gem_price_snapshots
  for select using (auth.role() = 'authenticated');
create policy "gem_price_snapshots_insert_all" on public.gem_price_snapshots
  for insert with check (auth.role() = 'authenticated');
