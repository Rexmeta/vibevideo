<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1EOFShGDw8MdFVxTeRyoFc6mgGoemT-ul

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## 마지막 단계 복원 — 수동 검증 시나리오

기존 프로젝트 카드를 클릭했을 때 마지막으로 작업하던 단계로 돌아가는지 확인하기 위한 체크리스트입니다.

### 시나리오 A — 정상(Cloud OK)
1. Quick / Wizard 모드로 새 프로젝트를 만들고 Step 4(오디오)까지 진행한 뒤 탭을 닫습니다.
2. 다시 열어 프로젝트 목록에서 해당 카드를 클릭합니다.
3. **기대:** Step 4 화면이 그대로 열리고 씬과 오디오가 보입니다. `[Restore]` 콘솔 로그에 `step=4 maxStep>=4`가 찍혀야 합니다.

### 시나리오 B — Firestore 비활성화 상태 (이번 버그의 원인)
1. `.env.local`의 `FIREBASE_PROJECT_ID`를 일부러 잘못된 값으로 바꿔 dev 서버를 재시작합니다 (또는 GCP 콘솔에서 Firestore API를 끕니다).
2. 새 프로젝트를 만들고 Step 5(스토리보드)까지 진행합니다 — 상단에 "로컬 전용 모드" 배지가 보여야 하고, 프로젝트 목록 상단 배너에 "이 기기에만 저장되고 있습니다" 문구가 추가로 노출되어야 합니다.
3. 탭을 닫고 다시 엽니다.
4. **기대:** 카드를 클릭하면 빈 Step 1이 아니라 **Step 5 화면**이 다시 열리고 IDB에 저장된 미디어(이미지/오디오)가 슬롯에 채워집니다. `[Restore] Healed local snapshot: step=5 ...` 로그가 한 번 출력되어야 합니다.

### 시나리오 C — 백필(Backfill)
1. 시나리오 B를 한 차례 진행해 로컬에만 풍부한 스냅샷이 있는 상태를 만듭니다.
2. `FIREBASE_PROJECT_ID`를 정상 값으로 되돌리고(또는 Firestore API를 다시 켜고) 새로 고침합니다.
3. 프로젝트 목록 화면이 클라우드 응답을 받으면 `[Backfill] Cloud updated from local snapshot: <id>` 로그가 출력되어야 합니다.
4. **기대:** 다른 기기에서 같은 계정으로 접속해도 마지막 단계와 씬 메타가 보입니다(미디어 자체는 IDB에만 있어 자동 업로드 대상이 아님 — 해당 기기에서 다시 열면 IDB에서 복원됩니다).

### 시나리오 D — 빠른 탭 닫기
1. Step 3에서 Step 4로 이동한 직후(0.5초 이내) 탭을 닫습니다.
2. 다시 엽니다.
3. **기대:** 1.5초 디바운스 클라우드 쓰기는 실패했어도 즉시 기록된 localStorage/IDB 백업 덕분에 Step 4가 복원됩니다.
