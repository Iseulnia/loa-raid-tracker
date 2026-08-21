-- 이전 마이그레이션(migration_2026-08-22b_character_raids.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- 골드를 받을 레이드 3개를 자동(골드 높은 순)이 아니라 사용자가 직접 고르도록 바꾸면서 추가되는 컬럼입니다.

alter table public.character_raids add column if not exists is_gold_earning boolean not null default true;
