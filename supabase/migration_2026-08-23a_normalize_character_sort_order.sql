-- 캐릭터 순서 변경 팝업에서 원정대 순서까지 바꿀 수 있게 하려면, 원정대 그룹 순서도 sort_order 기준으로
-- 매겨야 한다. 그런데 기존 sort_order는 최초 임포트 시점(선택한 순서)에 임의로 매겨진 값이라, 그대로
-- 기준으로 쓰면 "본계가 아래로 내려간다" — 그래서 지금 이 순간의 기본 노출 순서(원정대는 그 안 최고
-- 아이템레벨 내림차순, 캐릭터는 아이템레벨 내림차순)를 기준으로 sort_order를 한 번 다시 매겨서, 아직 아무도
-- 순서를 직접 바꾸지 않은 상태에서는 화면이 예전과 똑같이 보이게 만든다. 이후로는 사용자가 드래그/화살표로
-- 바꾼 순서가 그대로 유지된다.
with ranked as (
  select
    c.id,
    row_number() over (
      partition by c.owner_id
      order by
        (
          select max(c2.item_level)
          from public.characters c2
          where c2.owner_id = c.owner_id
            and coalesce(c2.expedition_label, '') = coalesce(c.expedition_label, '')
        ) desc nulls last,
        c.item_level desc nulls last,
        c.id
    ) as new_sort_order
  from public.characters c
)
update public.characters c
set sort_order = ranked.new_sort_order - 1
from ranked
where ranked.id = c.id;
