-- 로스트아크 "레이드 참여 현황" 패널(스크롤 목록, 레이드명 옆에 참여 가능/참여 완료 표시)을 스캔해서
-- 자동 체크하는 기능용. 이 패널은 결과화면과 달리 스크롤에 따라 각 행의 화면 위치가 바뀌기 때문에,
-- 레이드명 텍스트 위치를 슬라이딩 윈도우로 찾고 그 옆 배지 위치는 상대 오프셋으로 계산한다.
-- raid_id는 난이도별로 갈리는데(성당 1/2/3단계 등) 이 패널은 난이도 구분 없이 레이드 하나만 표시하므로,
-- 이 템플릿 타입은 raid_id 대신 난이도 무관 레이드 이름(raid_label)으로 매칭한다.
alter table public.raid_clear_templates
  drop constraint if exists raid_clear_templates_template_type_check;
alter table public.raid_clear_templates
  add constraint raid_clear_templates_template_type_check
  check (template_type in ('clear_banner', 'result_screen', 'gate_checkmark', 'status_row'));

alter table public.raid_clear_templates
  add column if not exists raid_label text, -- status_row 전용: 난이도 무관 레이드 이름 (예: "벨가르딘")
  add column if not exists badge_crop jsonb; -- status_row 전용: "참여 완료" 배지의 상대 위치 {xPct,yPct,wPct,hPct}
