# 로아 숙제 체크 — 작업 히스토리 / 프로젝트 현황

이 문서는 새 세션에서 이어서 작업할 때 맥락을 빨리 잡기 위한 요약입니다. 코드 자체를 읽으면 알 수 있는
내용(정확한 함수 시그니처, 파일 구조 등)은 최소화하고, **왜 이렇게 만들었는지 / 무엇을 결정했는지** 위주로
적습니다. 셋업 절차 자체는 [README.md](../README.md)를 보세요.

## 프로젝트 개요

친구들끼리(최대 10명) 로스트아크 주간 레이드 체크리스트를 같이 확인하는 웹앱. 사용자: leehusung8@gmail.com
(닉네임 이슬니아). 기획 의도: "레이드 클리어 여부"는 스마일게이트 API로 알 수 없어서 자동 감지가 불가능하다는
전제 위에서, 체크는 수동으로 하되 주변 계산(주간 리셋, 골드 계산, 캐릭터 정보 동기화)을 최대한 자동화.

## 기술 스택 & 배포 현황

- Next.js 16 (App Router, TypeScript) + Tailwind CSS v4 + Supabase (Auth/DB/Storage/Realtime)
- **GitHub**: https://github.com/Iseulnia/loa-raid-tracker (main 브랜치)
- **배포**: Vercel, 고정 주소 `https://loa-raid-tracker.vercel.app` (push하면 자동 재배포)
- **로컬 경로**: `D:\클로드 작업\loa-raid-tracker`
- 로컬 개발 환경에 Node.js/Git이 원래 없어서 winget으로 설치함 (Node 24, Git 2.55)
- `.env.local`에 Supabase URL/anon key/로스트아크 API 키 있음 (git에는 안 올라감)

## 지금까지 구현된 기능

**인증**
- 처음엔 매직링크(OTP) → 이메일 확인 번거로움 때문에 이메일+비밀번호로 전환
- `allowed_emails` 테이블 기반 허용목록: 초대 안 된 이메일은 가입(트리거에서 예외 발생) 자체가 막힘 —
  실제 도메인에 배포하면서 "아무나 가입 가능" 문제를 막기 위해 추가
- 친구 초대 시 SQL Editor에서 `insert into public.allowed_emails (email) values ('...')` 먼저 실행 필요
- `/reset-password` 페이지로 비밀번호 재설정 지원 (로그인 화면 "비밀번호를 잊으셨나요?")
- 세션 유지기간(Time-box) 관련 논의는 했지만 **적용 안 하기로 결정** (사용자 요청)

**대시보드(`/`) — 개인 전용**
- 로그인한 사람의 캐릭터만 표시. 상단에 "남은 레이드 / 거래가능 골드 / 귀속 골드" 진행률 바
- "전투력 전체 갱신" / "전투력 전체 초기화" 버튼 (아래 설명)
- 원정대(expedition_label)별로 캐릭터 그룹핑, 그룹마다 대표 캐릭터(★) 표시 가능

**공격대(`/party`) — 공용 탭**
- 모든 친구의 캐릭터/체크 현황을 친구별 박스로 모아서 봄. 내 캐릭터만 체크 가능, 남 캐릭터는 읽기 전용
- Dashboard 컴포넌트를 `mode="mine" | "party"` prop으로 재사용 (완전히 별도 컴포넌트 아님)

**내 캐릭터(`/characters`)**
- 대표 캐릭터명 입력 → 로스트아크 오픈 API로 원정대(siblings) 전체 불러오기, 아이템레벨 상위 6개 기본 체크
- "원정대 이름" 입력 필수 (부계정/부부계정 구분용, expedition_label)
- 대표 캐릭터 지정(is_main_character), 골드 획득 캐릭터 여부 토글, 삭제

**숙제(레이드) 관리**
- 별도 "레이드 관리" 화면 없음 — 마스터 레이드 목록은 `schema.sql` 시드 데이터로만 관리, 패치 나오면
  직접 SQL 고쳐서 재실행 (앱 내 편집 UI 없음, 의도적으로 그렇게 함)
- 캐릭터별 숙제 선택은 대시보드의 "숙제 편집" 팝업(HomeworkEditor)에서: 레이드 이름별로 난이도 하나만 선택,
  "골드 최대화 자동 선택"(거래가능 기준/총골드 기준 중 선택) 버튼 있음
- **골드 획득 레이드는 캐릭터당 최대 3개** — 예전엔 자동(골드 높은 순)이었다가, **사용자가 직접 고르는 방식으로
  변경**함 (숙제 편집에서 레이드 고를 때마다 "골드 받기" 토글)
- 레벨 미달 레이드는 숙제 편집에서 아예 선택 불가

**골드 계산 규칙 (`src/lib/raidDisplay.ts`)**
- 귀속/거래가능 분할: **성당(전체 단계) 100% 귀속**, **4막·종막·세르카는 노말만 절반 귀속+절반 거래가능**,
  그 외(벨가르딘 등)는 전부 거래가능. 이건 사용자가 실제 게임 기준으로 알려준 값이라 정확함
- 대시보드 상단 요약은 "획득한 골드 / 총 획득 가능 골드 (%)" 형식, 체크해도 총량은 안 변함
- 캐릭터 카드 하단 "받을 수 있는 골드"는 반대로 **체크할수록 줄어드는** 잔여량 표시 (의도적으로 다른 방식)

**레이드 표시 순서**: 출시 순(최신이 위) — 벨가르딘 > 성당 > 세르카 > 종막 > 4막 (`raids.sort_order`)

**난이도 색상**: 노말/1단계 = 하늘색(`#93c5fd`), 하드/2단계 = 주황(`#fb923c`), 나이트메어/3단계 = 보라
(`text-violet-600`) — 사용자가 준 색상 스와이프 기준

**전투력 관리 (카오스던전 세팅 vs 레이드 세팅 문제)**
- 로스트아크는 카던 세팅/레이드 세팅이 따로 있어서 API 스냅샷 시점에 카던 세팅이면 전투력이 낮게 잡힘
- 그래서 DB엔 **역대 최고 전투력만** 저장 (`refreshAllCombatPower`: 새 값이 기존보다 높을 때만 갱신)
- "전투력 전체 초기화"(`resetAllCombatPower`)는 최댓값 비교 없이 강제로 현재 API 값 덮어씀 (스펙 다운 대응용)
- 이 버튼들은 캐릭터별이 아니라 **대시보드 상단에 전체 일괄 버튼 2개**로만 존재 (처음엔 캐릭터별로
  만들었다가 사용자 요청으로 대시보드 전체 버튼으로 이동)

**클래스 아이콘**
- 대시보드 카드에서 캐릭터 이름 기준 **11시 방향(왼쪽, 이름 줄 높이에 맞춤)**에 원형 이미지 표시
- 출처: 공식 아트워크 갤러리(`lostark.game.onstove.com/Artwork`, JS 렌더링이라 직접 크롤링 안 되고
  페이지네이션 돌면서 하나씩 확인함)에서 클래스명과 일치하는 최신 게시물
- `src/lib/classIcons.ts`에 27개 클래스 매핑 (기존 24종 + 가디언나이트 + 발키리 + 신규 차원술사)
- 발키리·인파이터·배틀마스터는 원본에서 얼굴 위치가 안 좋아서 **직접 크롭해서 `public/class-icons/`에 로컬
  저장** (핫링크 아님). 나머지는 공식 CDN 핫링크
- **차원술사는 미완성** — 최신 아트워크가 영상이라 예고편 썸네일을 임시로 씀. 진짜 일러스트 URL을 받으면
  `classIcons.ts`의 `차원술사` 항목 교체 필요

**자동 감지(`/auto-detect`, 베타)**
- 화면공유(getDisplayMedia) + 라이브 프레임을 저장된 "레이드 결과화면" 기준 이미지와 픽셀 유사도 비교
  (`src/lib/templateMatch.ts`, 무거운 CV 라이브러리 없이 순수 Canvas로 구현)
- 판정 기준: "던전 클리어" 배너는 관문마다 뜨는 거라 보조 신호일 뿐이고, **"결과화면" 템플릿 하나가 그
  자체로 완전 클리어 확인**(레이드명+난이도+체크마크가 한 화면에 다 나오므로 관문 수 상관없이 정확함)
- 템플릿 3종류 저장 가능(clear_banner/result_screen/gate_checkmark)이지만 **실제 매칭 로직은 result_screen만
  사용**, 나머지는 참고용
- 기준 이미지 14장(레이드×난이도 조합)을 사용자가 준 스크린샷으로 채워넣음 — 서비스 롤 키를 한 번 받아서
  PowerShell로 Storage 업로드 + DB 등록 스크립트 실행함 (키는 저장 안 하고 그 세션에서만 사용)
- 매칭 유사도 기준치 82%, 패널 위치 추정치(좌측 상단 2~24%/6~36%)는 실측 아니라서 실사용하며 튜닝 필요할 수
  있음 (아직 실사용 피드백 못 받음)
- 초기화(reset) 버튼은 캐릭터별로 있고, 자동 체크된 항목은 "취소" 가능

**다크모드**
- 우측 상단 🌙/☀️ 토글, `localStorage`에 저장, OS 설정은 최초 1회만 참고
- Tailwind v4 `@custom-variant dark (&:where(.dark, .dark *));` 방식 (class 기반, prefers-color-scheme 아님)
  — 예전에 OS 다크모드 자동 적용 때문에 "글자 하나도 안 보임" 버그가 났던 적이 있어서 의도적으로 수동 토글만
- 흐린 회색 보조텍스트가 다크모드에서 너무 안 보여서 한 단계씩 밝게 조정함(neutral-500→400, 600→500)

## DB 마이그레이션 순서 (`supabase/` 폴더)

`schema.sql`이 최신 전체 스키마(신규 설치용)이고, 아래는 기존 프로젝트에 순서대로 적용한 증분
마이그레이션입니다. **전부 이미 실행 완료된 상태**입니다 (이 프로젝트의 Supabase에는):

1. `migration_2026-08-22_combat_power_and_raids.sql` — combat_power 컬럼, 실제 클리어골드표 반영
2. `migration_2026-08-22b_character_raids.sql` — character_raids 테이블(캐릭터별 숙제 선택) 최초 생성
3. `migration_2026-08-22c_gold_earning_choice.sql` — is_gold_earning 컬럼 추가
4. `migration_2026-08-22d_screen_share_templates.sql` — raid_clear_templates 테이블 + Storage 버킷 최초 생성
5. `migration_2026-08-22e_template_crop_types.sql` — 템플릿에 template_type/crop 컬럼 추가
6. `migration_2026-08-22f_expedition_grouping.sql` — expedition_label, is_main_character 컬럼
7. `migration_2026-08-22g_raid_sort_order.sql` — 레이드 sort_order를 출시순으로 재정렬
8. `migration_2026-08-22h_email_allowlist.sql` — allowed_emails 허용목록 + 가입 트리거 수정

새 마이그레이션을 추가할 땐 이 파일 이름 규칙(`migration_YYYY-MM-DD[a-z]_설명.sql`)을 따르고, `schema.sql`도
같이 최신화해서 새로 설치하는 사람도 한 번에 맞는 스키마를 받도록 유지하세요.

## 알려진 이슈 / TODO

- 차원술사 클래스 아이콘: 임시 썸네일 → 정식 일러스트로 교체 필요
- 자동 감지 매칭 위치/기준치(82%)는 추정값, 실사용 피드백으로 튜닝 필요
- 레이드 마스터 목록(이름/난이도/골드)은 패치마다 `schema.sql` 직접 수정 + SQL Editor 재실행 필요 (자동화 안 됨)
- 세션 만료 시간(Time-box) 설정은 논의만 하고 적용 안 함, 필요하면 Supabase Authentication → Sessions에서 설정

## 새 세션에서 작업 재개할 때 체크리스트

1. 이 파일과 [README.md](../README.md)를 먼저 읽기
2. `git log --oneline -20` 으로 최근 커밋 확인 (커밋 메시지가 곧 변경 이력)
3. 로컬에서 코드 수정 시: PowerShell 새 명령마다 PATH 재설정 필요
   (`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + ...`)
   — 셸 상태가 명령 간 유지되지 않아서 매번 필요함
4. 수정 후 `npm run build` + `npm run lint` 통과 확인 → git commit → GitHub push (Vercel 자동 재배포)
   — GitHub push용 Personal Access Token은 매번 사용자에게 새로 요청 (저장 안 함)
5. DB 스키마를 바꿨다면 `supabase/migration_YYYY-MM-DD_설명.sql` 새로 만들고, 사용자에게 Supabase SQL
   Editor에서 실행해달라고 안내 (직접 실행할 방법 없음, service_role 키를 매번 새로 받지 않는 이상)
