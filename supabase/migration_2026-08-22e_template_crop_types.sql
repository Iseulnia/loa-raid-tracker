-- 이전 마이그레이션(migration_2026-08-22d_screen_share_templates.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- 기준 이미지를 "전체 화면 한 장"이 아니라, 배너/레이드명/체크마크처럼 역할별로 정확히 잘라 저장하도록 바꾸는 마이그레이션.

alter table public.raid_clear_templates alter column raid_id drop not null;

alter table public.raid_clear_templates
  add column if not exists template_type text not null default 'result_screen';

alter table public.raid_clear_templates
  add column if not exists crop jsonb;

alter table public.raid_clear_templates
  add constraint raid_clear_templates_type_check
  check (template_type in ('clear_banner', 'result_screen', 'gate_checkmark'));
