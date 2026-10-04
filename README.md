# 컴활2급 메이트 — 풀스택 학습 웹앱

비전공자를 위한 컴활 2급 필기 학습 프로그램. Node.js(Express) + SQLite 백엔드와
순수 HTML/CSS/JS 프런트엔드로 구성된 **완전한 풀스택 앱**입니다. 로그인/회원가입,
실제 문제 채점(서버 검증), 오답노트, 취약 파트 분석, 그리고 **여러 사용자의 데이터를
실시간으로 집계하는 관리자 대시보드**까지 전부 동작합니다.

## 구성
```
csmate/
├── server.js        # Express API 서버
├── db.js            # SQLite 스키마 (users, attempts, wrong_notes)
├── questions.js      # 단원/문제 데이터 (서버가 정답을 검증, 클라이언트엔 숨김)
├── public/
│   ├── index.html   # 로그인 / 회원가입 화면
│   └── app.html      # 대시보드 · 개념학습 · 문제풀이 · 오답노트 · 관리자
├── package.json
├── .env.example
└── .gitignore
```

## 핵심 특징
- **회원가입/로그인**: 이메일+비밀번호(bcrypt 해시), JWT 토큰 인증
- **첫 번째 가입자가 자동으로 관리자(admin)**가 됩니다. (운영 중 변경하려면 DB에서
  `users.is_admin` 값을 직접 수정하세요.)
- **서버가 정답을 검증**합니다. 클라이언트는 정답을 받지 않고 문제/보기만 받아,
  채점 결과(정답 여부 + 해설)만 돌려받습니다 — 부정행위(개발자도구로 정답 조회) 방지.
- **오답노트**: 틀리면 자동 저장, 다시 맞히면 자동 제거. `wrong_notes` 테이블로 영구 저장.
- **대시보드**: 목표 점수 대비 예상 점수(최근 30문제 기준), 과목별 진도율, 단원별
  취약 파트 분석 — 전부 SQL 집계로 실시간 계산.
- **관리자 대시보드**: 전체 가입자 수, DAU(최근 24시간 활동 사용자), 전체 평균 정답률,
  단원별 전체 정답률, 공통 취약 문항 TOP5, 주간 정답률 추이 — **모두 실제 DB의 전체
  사용자 데이터를 집계**합니다 (예시 데이터 아님).
- 디자인은 요청하신 anthropic.com 톤의 색상·타이포(Roboto+Noto Sans KR)·간격(8px
  배수)·모션(scale, 247ms)·라운드(14px) 시스템을 그대로 적용했습니다. 다크모드,
  `prefers-reduced-motion`, 한글 줄바꿈(`word-break: keep-all`) 대응 포함.

## 로컬에서 실행하기
```bash
cd csmate
npm install
cp .env.example .env   # 필요하면 JWT_SECRET 등을 수정
npm start                # http://localhost:3000
```
브라우저에서 `http://localhost:3000` 접속 → 회원가입 → 바로 사용 가능합니다.

## 배포 방법 (택 1)

### 1) Render.com (무료 플랜 가능, 가장 간단)
1. 이 폴더를 GitHub 저장소로 올립니다 (`node_modules`는 `.gitignore`로 제외됨).
2. Render 대시보드 → New → Web Service → 저장소 연결.
3. Build Command: `npm install` / Start Command: `npm start`.
4. Environment에 `JWT_SECRET`을 랜덤한 긴 문자열로 설정 (`PORT`는 Render가 자동 주입).
5. **주의**: Render 무료 플랜은 재배포/슬립 시 디스크가 초기화될 수 있습니다.
   SQLite 파일을 영구 보존하려면 Render의 "Persistent Disk"를 추가하고
   `DB_PATH`를 그 디스크 경로로 지정하세요 (예: `/data/data.sqlite`).

### 2) Railway.app
1. GitHub 저장소 연결 → 자동으로 Node.js 프로젝트 감지.
2. Variables에 `JWT_SECRET` 추가.
3. Railway Volume을 추가하고 `DB_PATH`를 볼륨 경로로 지정하면 데이터가 재배포 후에도 유지됩니다.

### 3) 직접 VPS(카페24, AWS EC2 등)
```bash
git clone <저장소>
cd csmate
npm install --production
# pm2 등으로 상시 실행
npm install -g pm2
pm2 start server.js --name csmate
pm2 save
```
Nginx로 80/443 → 3000 포트 리버스 프록시 설정 후 도메인 연결, Let's Encrypt로 HTTPS 적용을 권장합니다.

## 환경변수
| 변수 | 설명 | 기본값 |
|---|---|---|
| `PORT` | 서버 포트 | 3000 |
| `JWT_SECRET` | JWT 서명 비밀키 — **배포 전 반드시 랜덤 값으로 변경** | (예시 값, 변경 필수) |
| `DB_PATH` | SQLite 파일 경로 | `./data.sqlite` |

## 데이터 백업
SQLite 파일(`data.sqlite`) 하나만 복사하면 전체 데이터(회원, 풀이기록, 오답노트)가 백업됩니다.

## 문제/단원 데이터 수정
`questions.js`의 `UNITS`, `QUESTIONS` 배열에 항목을 추가/수정하면 바로 반영됩니다
(서버 재시작 필요). 실제 기출문제로 교체해 분량을 늘릴 수 있습니다.

## 알려진 한계
- 이메일 인증, 비밀번호 재설정 메일 발송 기능은 포함되어 있지 않습니다 (필요 시 추가 개발 필요).
- 관리자 지정은 "첫 가입자 자동 admin" 방식의 단순 구현입니다. 다수 관리자가 필요하면
  `users.is_admin`을 DB에서 직접 1로 변경하세요.
- 랜딩 페이지(`landing.html`, 별도 파일)는 이 앱과 분리된 마케팅 소개 페이지입니다.
  필요하면 `public/landing.html`로 옮기고 "시작하기" 버튼을 `index.html`로 연결하세요.
