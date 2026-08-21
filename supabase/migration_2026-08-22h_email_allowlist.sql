-- 이전 마이그레이션(migration_2026-08-22g_raid_sort_order.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- 실제 도메인에 배포하면 누구나 URL만 알면 아무 이메일로나 새로 가입할 수 있는 문제를 막습니다.
-- 이제부터는 아래 allowed_emails 테이블에 등록된 이메일만 가입(=매직 링크 로그인)이 됩니다.

create table if not exists public.allowed_emails (
  email text primary key
);
alter table public.allowed_emails enable row level security;
-- 일부러 정책을 하나도 안 만듭니다 → API로는 아무도 조회/수정 불가, SQL Editor에서만 관리.

-- 이미 가입되어 있는 계정들은 자동으로 허용목록에 포함시켜서, 지금 로그인 중인 사람이 잠기지 않게 함.
insert into public.allowed_emails (email)
select email from auth.users
on conflict do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.allowed_emails where lower(email) = lower(new.email)
  ) then
    raise exception '초대되지 않은 이메일이라 가입할 수 없어요: %', new.email;
  end if;

  insert into public.profiles (id, nickname)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1)));
  return new;
end;
$$;

-- ─────────────────────────────────────────────
-- 앞으로 친구를 새로 초대할 때마다, SQL Editor에서 이렇게 한 줄 실행해서 미리 등록해두세요:
--
--   insert into public.allowed_emails (email) values ('친구이메일@example.com');
--
-- 등록 안 된 이메일로 로그인 링크를 요청하면 가입이 거부됩니다.
-- ─────────────────────────────────────────────
