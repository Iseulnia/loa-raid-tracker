-- 이전 마이그레이션(migration_2026-08-25_template_examples.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- setCharacterRaids가 delete+insert 대신 upsert를 쓰도록 바뀌면서(안 바뀐 레이드까지 delete+insert가
-- 다시 일어나 실시간 동기화에 경쟁 조건이 생기던 문제 수정), 이미 존재하는 행에 대한 upsert는 내부적으로
-- UPDATE를 시도하므로 character_raids에 update 정책이 필요합니다(예전엔 select/insert/delete만 있었음).

drop policy if exists "character_raids_update_own" on public.character_raids;
create policy "character_raids_update_own" on public.character_raids
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
