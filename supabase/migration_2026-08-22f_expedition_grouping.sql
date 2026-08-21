-- 이전 마이그레이션(migration_2026-08-22e_template_crop_types.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- 부계정/부부계정처럼 여러 원정대(계정)를 쓰는 사람을 위해, 캐릭터를 원정대별로 구분하고
-- 원정대마다 대표 캐릭터를 지정할 수 있게 하는 컬럼을 추가합니다.

alter table public.characters add column if not exists expedition_label text;
alter table public.characters add column if not exists is_main_character boolean not null default false;
