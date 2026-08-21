-- 캐릭터 카드에 직업 각인을 표시하고, 그 각인이 서포터인지 딜러인지에 따라
-- 전투력 글꼴 색상을 다르게 보여주기 위한 컬럼.
-- 저장된 combat_power가 "최고 전투력" 기록 방식이므로, class_engraving도 그 순간의 값을 함께 저장해서
-- "최고 전투력을 기록했을 때의 각인" 기준으로 분류되도록 한다 (전투력 갱신/초기화 로직에서 함께 갱신).
alter table public.characters
  add column if not exists class_engraving text;
