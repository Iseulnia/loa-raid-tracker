-- 이전 마이그레이션(migration_2026-08-23c_clear_button_ocr.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- 더보기 효율 계산기의 거래소 시세를 브라우저(localStorage)가 아니라 DB에 캐시합니다.
-- 한 명이 "현재가 갱신"을 누르면 그 결과를 모두가 그대로 보게 되어(다 같이 쓰는 친구들 그룹이라
-- 각자 API를 따로 호출할 필요가 없음) 로스트아크 API 호출 횟수도 줄어듭니다.

create table if not exists public.market_item_prices (
  item_id bigint primary key,
  item_name text not null,
  current_min_price numeric not null,
  bundle_count int not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.market_item_prices enable row level security;

create policy "market_item_prices_select_all" on public.market_item_prices
  for select using (auth.role() = 'authenticated');
create policy "market_item_prices_write_all" on public.market_item_prices
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
