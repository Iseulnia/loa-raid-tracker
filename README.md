# 로아 숙제 체크

친구들끼리 (최대 10명 정도) 로스트아크 주간 레이드 체크리스트를 같이 확인하는 웹앱.

## 중요: 이 앱이 자동화하는 것 / 하지 않는 것

- **자동화 안 됨**: "이번 주에 이 레이드를 실제로 클리어했는지"는 스마일게이트가 API로 제공하지 않아서
  자동 감지가 불가능합니다. 체크는 직접 눌러야 합니다.
- **자동화 됨**:
  - 캐릭터 목록/아이템레벨/전투력을 로스트아크 오픈 API로 자동 불러오기
  - 매주 수요일 06:00(KST) 기준 주간 리셋 — 별도 배치 없이 날짜 계산만으로 처리 ([src/lib/week.ts](src/lib/week.ts))
  - 체크하거나 숙제를 편집하면 다른 친구 화면에도 실시간 반영 (Supabase Realtime)
  - 캐릭터별로 고른 숙제 기준 "받을 수 있는 골드" 자동 계산 (체크할 때마다 차감)

## 처음 설정하는 방법

### 1. Supabase 프로젝트 만들기

1. https://supabase.com 에서 무료 프로젝트 생성
2. 프로젝트의 **SQL Editor**에서 [supabase/schema.sql](supabase/schema.sql) 전체 내용을 실행
   - 프로필/캐릭터/레이드/캐릭터별 숙제 선택/주간체크 테이블, RLS 정책, 실시간 활성화, 시드 레이드 데이터가 한 번에 생성됩니다
3. **Project Settings → API**에서 `Project URL` 과 `anon public` 키를 복사
4. **Authentication → URL Configuration**에서 Redirect URL에 배포할 도메인(예: `https://your-app.vercel.app/auth/confirm`)과
   로컬 개발용 `http://localhost:3000/auth/confirm` 을 추가
   - 기본은 이메일 매직링크 로그인이라 별도 소셜 로그인 설정 없이 바로 씁니다.
5. **초대할 친구 이메일 등록 (중요)** — `schema.sql`에 포함된 `allowed_emails` 테이블에 등록된 이메일만
   가입이 됩니다. 도메인에 배포하면 URL만 아는 누구나 매직 링크로 가입을 시도할 수 있기 때문에, 실제로 초대할
   친구가 아니면 아예 가입 자체가 막히도록 만든 안전장치예요. 친구를 초대할 때마다 SQL Editor에서:
   ```sql
   insert into public.allowed_emails (email) values ('친구이메일@example.com');
   ```
   를 먼저 실행해두고 나서 그 사람에게 URL을 공유하세요.

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

## 시세 자동 수집 설정 (선택)

로아 도구의 보석 가격 / 더보기 효율 탭은 각자 "현재가 갱신" 버튼을 눌러야 시세가 기록되는데, 아무도
안 눌러도 자동으로 기록되게 하려면 GitHub Actions 스케줄러
([.github/workflows/gem-price-cron.yml](.github/workflows/gem-price-cron.yml) — 보석, 1시간마다,
[.github/workflows/market-price-cron.yml](.github/workflows/market-price-cron.yml) — 더보기 재료,
3시간마다)를 씁니다(Vercel Hobby 요금제의 Cron은 하루 1번으로 제한돼 있어서 대신 씀). 설정 안 해도 앱
자체는 정상 동작하고, 그냥 자동 기록만 안 될 뿐입니다.

1. Supabase **Project Settings → API Keys**(또는 **Data API → Settings**)에서 `service_role`(최신
   Supabase는 `secret`으로 표시될 수 있음) 키를 복사(⚠️ RLS를 전부 무시하는 강력한 키라 외부에 노출되면
   안 됨 — 아래 두 곳에만 등록)해서 Vercel 프로젝트 환경 변수에 `SUPABASE_SERVICE_ROLE_KEY`로 등록
2. 임의의 긴 문자열을 하나 만들어서(PowerShell에선 `openssl`이 기본으로 없으니
   `-join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Minimum 0 -Maximum 256) })` 같은 걸로
   대신 생성 가능) Vercel 환경 변수에 `CRON_SECRET`으로 등록
3. GitHub 저장소 **Settings → Secrets and variables → Actions → Repository secrets**에서 시크릿 2개
   등록(두 워크플로가 공유해서 씀):
   - `APP_URL`: 배포된 앱 주소(끝에 `/` 없이, 예: `https://your-app.vercel.app`)
   - `CRON_SECRET`: 2번에서 만든 값과 **동일하게**
4. 저장소에 푸시하면 두 워크플로가 각자 주기대로 자동 실행됩니다. **Actions** 탭에서 워크플로 이름을
   눌러 `Run workflow`로 바로 한 번씩 테스트해볼 수 있어요.

## 레이드 마스터 목록 관리

레이드 이름/난이도/필요 아이템레벨/골드는 `supabase/schema.sql` 안에 시드 데이터로 들어있고, 앱 안에 이걸
편집하는 화면은 따로 없습니다. 로스트아크 패치로 레이드가 바뀌면 `supabase/schema.sql`의 시드 데이터를 직접
고친 뒤, 그 변경분만 SQL Editor에서 다시 실행해주세요 (기존 데이터가 있는 프로젝트라면 `delete from public.raids;`
로 지우고 새 `insert`만 실행하면 됩니다 — `supabase/migration_2026-08-22_combat_power_and_raids.sql` 참고).

각 캐릭터가 실제로 도는 레이드(난이도)는 대시보드의 **"숙제 편집"** 버튼으로 캐릭터별로 직접 고릅니다.
같은 레이드는 난이도 하나만 고를 수 있고, 고른 레이드들의 골드 합계가 카드 아래 "받을 수 있는 골드"로
표시되며 체크할 때마다 그만큼 줄어듭니다.

## 프로젝트 구조

- `supabase/schema.sql` — DB 스키마 전체 (테이블, RLS, 실시간, 레이드 마스터 시드 데이터)
- `src/lib/week.ts` — 수요일 06:00 KST 기준 주차 계산
- `src/lib/lostark.ts` — 로스트아크 오픈 API 클라이언트 (서버 전용)
- `src/app/actions.ts` — 체크/캐릭터/캐릭터별 숙제 선택 관련 서버 액션
- `src/components/Dashboard.tsx` — 친구별 캐릭터 카드 + 실시간 구독
- `src/components/HomeworkEditor.tsx` — 캐릭터별 숙제(레이드) 선택 모달
- `src/components/CharacterManager.tsx` — 원정대 불러오기 / 캐릭터 관리
