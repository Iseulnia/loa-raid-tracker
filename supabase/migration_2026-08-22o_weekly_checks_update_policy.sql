-- weekly_checks에 UPDATE 정책이 아예 없었음 — setRaidCheck이 upsert를 쓰는데, 이미 존재하는 행에
-- 대해서는 upsert가 내부적으로 UPDATE(ON CONFLICT DO UPDATE)를 시도한다. RLS는 켜져 있는데
-- UPDATE 정책이 하나도 없으면 기본적으로 전부 거부되므로, "이미 한 번 체크된 (캐릭터,레이드)를
-- 다시 체크하려는" 모든 시도가 "new row violates row-level security policy (USING expression)"로
-- 실패하고 있었다 (참여현황 스캔에서 반복 재현된 React #441의 실제 원인).
create policy "checks_update_own_character" on public.weekly_checks
  for update using (
    exists (
      select 1 from public.characters c
      where c.id = character_id and c.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.characters c
      where c.id = character_id and c.owner_id = auth.uid()
    )
  );
