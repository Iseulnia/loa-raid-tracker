-- 이전 마이그레이션(migration_2026-08-22f_expedition_grouping.sql)까지 실행한 프로젝트에 이어서 적용하세요.
-- 레이드 노출 순서를 출시 순(최신 -> 과거)으로 바꿉니다: 벨가르딘 > 성당 > 세르카 > 종막 > 4막

update public.raids set sort_order = 10 where name = '벨가르딘' and difficulty = '노말';
update public.raids set sort_order = 11 where name = '벨가르딘' and difficulty = '하드';
update public.raids set sort_order = 12 where name = '벨가르딘' and difficulty = '나이트메어';
update public.raids set sort_order = 20 where name = '성당' and difficulty = '1단계';
update public.raids set sort_order = 21 where name = '성당' and difficulty = '2단계';
update public.raids set sort_order = 22 where name = '성당' and difficulty = '3단계';
update public.raids set sort_order = 30 where name = '세르카' and difficulty = '노말';
update public.raids set sort_order = 31 where name = '세르카' and difficulty = '하드';
update public.raids set sort_order = 32 where name = '세르카' and difficulty = '나이트메어';
update public.raids set sort_order = 40 where name = '종막' and difficulty = '노말';
update public.raids set sort_order = 41 where name = '종막' and difficulty = '하드';
update public.raids set sort_order = 50 where name = '4막' and difficulty = '노말';
update public.raids set sort_order = 51 where name = '4막' and difficulty = '하드';
