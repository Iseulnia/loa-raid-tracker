-- 시세 자동 갱신을 GitHub Actions 대신(또는 병행해서) Supabase 자체 스케줄러(pg_cron)로 돌리기 위한 설정.
-- GitHub Actions의 schedule 트리거가 계속 안 돌아서(2026-08-28 확인, 워크플로 파일명을 바꿔 새로
-- 등록해봐도 첫 실행조차 안 됨) 이미 쓰고 있는 Supabase 인프라 안으로 옮기는 대안.
--
-- ⚠️ 이 파일은 그대로 실행하면 안 됩니다 — 아래 2번 블록의 'REPLACE_WITH_CRON_SECRET' 부분을
-- Vercel에 등록해둔 실제 CRON_SECRET 값으로 직접 바꾼 뒤 Supabase SQL Editor에서 실행하세요.
-- (이 값을 이 파일에 그대로 적어서 커밋하면 깃 저장소에 시크릿이 노출되니 절대 커밋하지 마세요 —
-- Vault에 한 번 저장해두면 그 뒤로는 이 파일을 다시 열 일도, 시크릿을 다시 입력할 일도 없습니다.)

-- 1) 확장 기능 켜기 (Database > Extensions 화면에서 pg_cron / pg_net 토글로도 가능, SQL로도 가능)
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- 2) CRON_SECRET을 평문으로 스케줄에 박아두지 않기 위해 Vault에 한 번만 저장
--    (이미 저장했다면 이 블록은 건너뛰고 3번부터 실행하세요 — 중복 실행하면 에러남)
select vault.create_secret('REPLACE_WITH_CRON_SECRET', 'cron_secret', '로아 숙제 체크 크론 라우트 인증용');

-- 3) 보석 시세 — 매시 7분 (GitHub Actions 쪽과 동일한 오프셋 유지, 정각 혼잡 회피)
select cron.schedule(
  'gem-price-refresh',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://loa-raid-tracker.vercel.app/api/cron/gem-prices',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 4) 더보기 재료 시세 — 3시간마다, 22분 (GitHub Actions 쪽과 동일)
select cron.schedule(
  'market-price-refresh',
  '22 */3 * * *',
  $$
  select net.http_post(
    url := 'https://loa-raid-tracker.vercel.app/api/cron/market-prices',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 5) 확인용 — 등록된 크론 목록
-- select * from cron.job;

-- 6) 확인용 — 최근 실행 로그(성공/실패, 응답 코드 등)
-- select * from cron.job_run_details order by start_time desc limit 10;

-- 나중에 지우고 싶으면:
-- select cron.unschedule('gem-price-refresh');
-- select cron.unschedule('market-price-refresh');
