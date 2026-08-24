-- 이전 마이그레이션(migration_2026-08-24_market_item_prices.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- 자기 등록 영역을 "예시"로 지정해서 다른 친구들에게 보여줄 수 있게 합니다(영역을 어떻게 잡아야 하는지
-- 헷갈려하는 사람들을 위해). 예시로 지정된 항목은 등록자 상관없이 전원에게 별도 갤러리로 보임.

alter table public.raid_clear_templates add column if not exists is_example boolean not null default false;

-- 예전엔 이 테이블에 update 정책이 없었음(등록/삭제만 가능) — is_example 토글을 위해 추가.
-- 본인이 등록한 것만 본인이 수정할 수 있음(삭제 정책과 동일한 기준).
drop policy if exists "raid_clear_templates_update_own" on public.raid_clear_templates;
create policy "raid_clear_templates_update_own" on public.raid_clear_templates
  for update using (auth.uid() = created_by) with check (auth.uid() = created_by);
