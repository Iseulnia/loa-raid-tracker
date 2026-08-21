# 로아 숙제 체크

친구들끼리 (최대 10명 정도) 로스트아크 주간 레이드 체크리스트를 같이 확인하는 웹앱.

## 중요: 이 앱이 자동화하는 것 / 하지 않는 것

- **자동화 안 됨**: "이번 주에 이 레이드를 실제로 클리어했는지"는 스마일게이트가 API로 제공하지 않아서
  자동 감지가 불가능합니다. 체크는 직접 눌러야 합니다.
- **자동화 됨**:
  - 캐릭터 목록/아이템레벨을 로스트아크 오픈 API로 자동 불러오기
  - 매주 수요일 06:00(KST) 기준 주간 리셋 — 별도 배치 없이 날짜 계산만으로 처리 ([src/lib/week.ts](src/lib/week.ts))
  - 체크하면 다른 친구 화면에도 실시간 반영 (Supabase Realtime)
  - 체크한 레이드 기준 예상 골드 합산

## 처음 설정하는 방법

### 1. Supabase 프로젝트 만들기

1. https://supabase.com 에서 무료 프로젝트 생성
2. 프로젝트의 **SQL Editor**에서 [supabase/schema.sql](supabase/schema.sql) 전체 내용을 실행
   - 프로필/캐릭터/레이드/주간체크 테이블, RLS 정책, 실시간 활성화, 시드 레이드 데이터가 한 번에 생성됩니다
3. **Project Settings → API**에서 `Project URL` 과 `anon public` 키를 복사
4. **Authentication → URL Configuration**에서 Redirect URL에 배포할 도메인(예: `https://your-app.vercel.app/auth/confirm`)과
   로컬 개발용 `http://localhost:3000/auth/confirm` 을 추가
   - 기본은 이메일 매직링크 로그인이라 별도 소셜 로그인 설정 없이 바로 씁니다.

### 2. 로스트아크 오픈 API 키 발급

https://developer-lostark.game.onstove.com/ 에서 스토브 계정으로 로그인 후 API 키 발급 (누구 한 명 명의로 발급해서
모두가 함께 쓰는 서버 키로 사용합니다 — 개인마다 키를 등록하지 않아도 됩니다).

### 3. 환경 변수 설정

[.env.local.example](.env.local.example) 을 `.env.local` 로 복사하고 위에서 발급받은 값들을 채워넣으세요.

### 4. 로컬 실행

```bash
npm install
npm run dev
```

http://localhost:3000 접속 → 이메일로 로그인 → `/characters`에서 대표 캐릭터명으로 원정대 불러오기 → 대시보드에서 체크.

### 5. 배포

Vercel에 이 저장소를 연결하고 위 3개 환경 변수(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`LOSTARK_API_KEY`)를 Vercel 프로젝트 설정에도 동일하게 등록하면 끝입니다. 친구들에게 배포된 URL만 공유하면
각자 이메일로 로그인해서 쓸 수 있어요.

## 레이드 목록 관리

`supabase/schema.sql` 맨 아래에 2026년 8월 기준으로 대략적인 시드 데이터를 넣어뒀지만, 로스트아크는 패치가 잦아서
정확하지 않을 수 있습니다. 배포 후 `/raids` 페이지에서 실제 현재 레이드/난이도/관문별 골드에 맞게 직접
추가·삭제해서 맞춰주세요. (레이드 목록은 친구 그룹 전체가 같이 관리하는 공용 데이터라 아무나 수정 가능합니다.)

## 프로젝트 구조

- `supabase/schema.sql` — DB 스키마 전체 (테이블, RLS, 실시간, 시드 데이터)
- `src/lib/week.ts` — 수요일 06:00 KST 기준 주차 계산
- `src/lib/lostark.ts` — 로스트아크 오픈 API 클라이언트 (서버 전용)
- `src/app/actions.ts` — 체크/캐릭터/레이드 관련 서버 액션
- `src/components/Dashboard.tsx` — 전체 현황 매트릭스 + 실시간 구독
- `src/components/CharacterManager.tsx` — 원정대 불러오기 / 캐릭터 관리
- `src/components/RaidManager.tsx` — 레이드 목록 관리
