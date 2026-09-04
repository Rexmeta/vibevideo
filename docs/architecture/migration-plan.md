# VibeVideo 상용화 마이그레이션 계획

## 1. 우선순위 정의

- **P0:** 상용 운영 전 해결해야 하는 보안·데이터 손실·중복 과금 위험
- **P1:** provider/orchestration 확장의 선행 경계
- **P2:** AI Director/Studio UX/대용량 운영 개선
- **P3:** 최적화와 고급 상용 기능

이 계획은 Architecture → Domain → Provider → Orchestrator → AI Director → Studio UX → Backend → Billing 순서를 따르되, 각 티켓은 독립 배포·검증·rollback이 가능해야 한다. 기존 등록 과제와 겹치는 제품 기능은 새 티켓으로 제안하지 않고 의존성으로만 표시한다.

## 2. 상용화 위험 분류

| 우선순위 | 문제 | 근거 | 영향 |
|---|---|---|---|
| P0 | 유료 Google key가 bundle/localStorage/browser SDK에 존재 | `vite.config.ts`, `apiKeyService.ts`, `geminiService.ts`, `ApiKeyRequiredModal.tsx` | key 탈취, quota/비용 통제 불가 |
| P0 | browser singleton이 장기 job과 polling을 소유 | `App.tsx`, `jobManager.ts` | 탭 종료 gap, 중복 생성/과금 |
| P0 | multi-source 복구가 revision 대신 진행 점수/index 병합 | `useRestore.ts` | 다중 기기 최신 편집 손실 |
| P0 | 전체 저장 blob이 이후 map patch보다 항상 우선 | `useSync.ts`, `storageService.ts`, `jobManager.ts`, `uploadQueue.ts` | 정상 reload에서 최신 scene/media/status 유실 |
| P0 | scene 표현의 map/blob/80개 제한이 분산 | `useSync.ts`, `storageService.ts` | 장편 silent truncation/불일치 |
| P0 | generation 완료와 Storage durability가 분리되나 UX/계약이 약함 | `jobManager.ts`, `uploadQueue.ts`, `VideoMeta` | 다른 기기에서 media 소실 |
| P1 | `geminiService`가 여러 capability와 retry/polling을 결합 | `geminiService.ts` | provider 확장과 테스트 어려움 |
| P1 | `WizardContext`가 domain/application/UI를 모두 소유 | `WizardContext.tsx` | 변경 반경과 stale ref 위험 |
| P1 | 공통 오류/idempotency/trace 계약 부재 | 전 서비스 console/error 처리 | 지원·재시도·SLO 불가 |
| P1 | 비용은 추정 metadata뿐 | `pricing.ts`, `OperationRecord`, `VideoMeta` | billing reconciliation 불가 |
| P2 | FFmpeg export가 브라우저 메모리/CDN/CORS에 종속 | `useExportActions.ts`, `videoMergeService.ts`, `ffmpegLimits.ts` | 장편 export 실패 |
| P2 | UI chapter와 실제 export chunk 경계가 다를 수 있음 | `chapterService.ts`, `useExportActions.ts` | 예측 불가능한 산출물 |
| P2 | watermark 실패가 non-fatal | `videoMergeService.ts` | 브랜드/계약 산출물 누락 |
| P3 | browser console 중심 observability | 전 서비스 | 추세·원인 분석 부족 |

## 3. 실행 티켓

### A1. 현재 동작 characterization suite

- **우선순위:** P0
- **목적:** seam 도입 전에 current behavior를 executable contract로 고정
- **범위:** Sample, Express, Quick, Pro actions, sync/restore fixtures, video resume, upload retry, export fixture
- **의존성:** 없음
- **완료 조건:** 아래 회귀 매트릭스의 핵심 happy/failure path가 자동화되고 provider/Firestore/FFmpeg는 deterministic fake로 실행
- **회귀 위험:** 낮음; 테스트가 현재 결함까지 영구 계약으로 만들지 않도록 “관찰값”과 “원하는 정책”을 구분

### A2. Generation command/result와 normalized error 계약

- **우선순위:** P0
- **목적:** UI 문자열과 provider 객체 사이에 안정된 application 계약 생성
- **범위:** typed command ID, progress event, result, retryability, normalized error; 기존 hooks에 adapter로 연결
- **의존성:** A1
- **완료 조건:** 기존 UI 출력이 유지되고 Google SDK error가 context/step component 밖으로 누출되지 않음
- **회귀 위험:** 오류 문구와 retry button 조건 변화

### D1. Project domain snapshot과 persistence DTO mapper

- **우선순위:** P0
- **목적:** `types.ts`의 UI/domain/provider/persistence 혼합을 점진 분리
- **범위:** in-memory snapshot, legacy `Project` DTO 양방향 mapper, schema validation; 저장 형식 변경 없음
- **의존성:** A1
- **완료 조건:** 기존 fixtures round-trip 후 의미 있는 필드와 placeholder media가 보존됨
- **회귀 위험:** optional/null/deleteField, legacy scene migration, Sample clone

### D2. Scene ID 기반 merge 및 revision conflict 탐지

- **우선순위:** P0
- **목적:** 진행 점수/index 병합의 데이터 손실 방지
- **범위:** repository save revision precondition, scene ID merge 가능한 필드 정의, conflict 결과 UI contract. 기존 `saveProjectWithConflictCheck`는 production 미사용이며 transaction 실패 시 unchecked save로 fallback하므로, 요구 계약을 만족하면 강화해 통합하고 아니면 대체
- **의존성:** D1, D3
- **완료 조건:** 두 기기 reorder/edit fixture에서 silent overwrite가 없고 사용자가 conflict를 식별 가능
- **회귀 위험:** offline save와 backfill; 기존 version 없는 문서

### D3. Scene source-of-truth와 저장 한계 일원화

- **우선순위:** P0
- **목적:** 전체 blob 저장 뒤 map 부분 patch가 reload에서 무시되는 P0 결함과 80씬 truncation을 함께 제거
- **범위:** 하나의 authoritative scene representation 또는 version-linked blob/map 정책, read precedence, blob 갱신/무효화의 원자성, max scene validation, legacy dual-read. `useSync`, `jobManager`, `uploadQueue` patch를 모두 포함
- **의존성:** D1
- **완료 조건:** 1/80/81+ scene fixture에서 저장 성공 또는 명시적 차단이며 silent truncation 없음. 또한 “full blob save → 사용자 scene 부분 편집 → reload”, “full blob save → video operation patch → reload”, “full blob save → upload 완료 patch → reload”에서 최신 값이 복원됨
- **회귀 위험:** Firestore 문서 크기, Storage blob race, legacy reader, local-only mode, operation resume

### P1. Provider capability ports와 Gemini adapters

- **우선순위:** P1
- **목적:** text/image/audio/video/critic 계약 뒤에 현재 Google 구현 배치
- **범위:** 현재 prompt, retry, output normalization을 behavior-preserving adapter로 이동; SDK 제거 아님
- **의존성:** A2, D1
- **완료 조건:** Wizard/Quick이 concrete `geminiService`를 import하지 않고 golden fixtures가 동일
- **회귀 위험:** model ID/provider key 선택, image reference, Veo seed/audio

### P2. Provider capability registry 일원화

- **우선순위:** P1
- **목적:** catalog의 provider/model과 실제 실행 가능 기능을 일치
- **범위:** aspect ratio, image seed, multi-reference, native audio, async operation, 가격 힌트
- **의존성:** P1
- **완료 조건:** UI validation과 adapter dispatch가 같은 registry를 사용하고 unsupported 조합은 호출 전에 차단
- **회귀 위험:** 기존 모델 default와 저장된 model ID

### O1. Browser JobOrchestrator facade

- **우선순위:** P1
- **목적:** hooks/Quick에서 singleton과 provider polling을 숨기고 서버 전환 seam 확보
- **범위:** 기존 `jobManager`/`uploadQueue`를 facade implementation으로 감쌈
- **의존성:** A2, P1
- **완료 조건:** batch/single/resume가 같은 command lifecycle을 사용하고 현재 startup 순서 유지
- **회귀 위험:** duplicate listeners, stale React refs, processing badge

### O2. Idempotency와 durable asset 상태

- **우선순위:** P0
- **목적:** 중복 생성·과금과 “생성됐지만 업로드 안 됨” 상태를 정확히 표현
- **범위:** input fingerprint, idempotency key, generated/uploading/available 상태, submit-persist gap 처리
- **의존성:** O1, D2
- **완료 조건:** reload/중복 클릭 fixture에서 operation 1개, upload 실패 시 다른 기기에서 완료로 보이지 않음
- **회귀 위험:** 기존 interrupted/long-wait/pending-upload badge와 resume

### O3. 공통 retry/cancellation/time budget 정책

- **우선순위:** P1
- **목적:** provider, polling, upload의 무제한·불일치 retry 방지
- **범위:** stage별 retry budget, backoff, Retry-After, cancellation, terminal mapping
- **의존성:** A2, O1
- **완료 조건:** fake clock 테스트에서 각 오류가 정해진 횟수/상태로 종료되고 취소 후 추가 과금 호출 없음
- **회귀 위험:** 긴 Veo operation을 조기 실패 처리

### AI1. Production plan/scene graph read model

- **우선순위:** P2
- **목적:** 향후 AI Director가 UI Scene 배열을 직접 변경하지 않도록 provider-neutral 계획 모델 마련
- **범위:** 기존 scenes에서 파생되는 read model과 validator만 추가
- **의존성:** D1, P2
- **완료 조건:** 기존 project를 무손실로 plan view에 투영하고 아직 저장 형식/UX는 변경하지 않음
- **회귀 위험:** remix/legacy scene optional fields

### S1. Application command 기반 Studio/Quick/Wizard binding

- **우선순위:** P2
- **목적:** 세 UX가 동일 command와 progress view model을 사용
- **범위:** 단계별로 action hook을 얇은 binding으로 교체
- **의존성:** O1, AI1
- **완료 조건:** Sample/Express/Quick/Pro 회귀 suite 통과, 화면별 provider 조건문 감소
- **회귀 위험:** handoff step, retry focus, modal key resume

### B1. Generation gateway와 server-side credential

- **우선순위:** P0
- **목적:** 상용 generation에서 브라우저 유료 key 제거
- **범위:** 인증된 submit/status/cancel API, secret manager, quota hook; browser legacy adapter는 feature flag로 유지
- **의존성:** P1, O1, O2
- **완료 조건:** production server mode bundle/localStorage에 provider key가 없고 owner/auth/quota가 server에서 검증됨
- **회귀 위험:** AI Studio BYOK 흐름, CORS/auth refresh, provider response latency

### B2. Durable worker/lease/polling/upload

- **우선순위:** P0
- **목적:** 탭 수명과 무관한 장기 작업
- **범위:** job repository, lease/heartbeat, Veo polling, object upload, webhook/poll status
- **의존성:** B1, O2, O3
- **완료 조건:** 탭 종료 후 완료, worker 재시작 후 resume, concurrent worker에서도 operation/upload 1회
- **회귀 위험:** 기존 operation records와 upload queue migration

### B3. Structured observability와 support references

- **우선순위:** P1
- **목적:** SLO, 비용, 장애 지원 가능성 확보
- **범위:** correlation ID, structured events, redaction, stage metrics, user-safe support code
- **의존성:** A2, B1
- **완료 조건:** key/prompt/signed URL 없이 command 전 구간 추적 가능
- **회귀 위험:** 로그에 민감 데이터가 포함되는 instrumentation 실수

### E1. BrowserExportAdapter 안정화

- **우선순위:** P2
- **목적:** 현재 FFmpeg behavior를 contract 뒤에 격리하고 실패를 명확히 함
- **범위:** export manifest, deterministic chunk plan, strict capability probe, watermark failure policy
- **의존성:** A1, D1
- **완료 조건:** 1/multi/long-form fixture가 playable MP4 또는 명시적 part fallback을 반환
- **회귀 위험:** codec/timebase, captions, Veo native audio, presentation audio

### E2. Server render adapter

- **우선순위:** P2
- **목적:** 저사양/장편 사용자의 브라우저 OOM 제거
- **범위:** 동일 export manifest를 받는 비동기 render job
- **의존성:** E1, B2
- **완료 조건:** browser/server 결과의 duration, order, audio, caption, branding parity 허용범위 정의 및 통과
- **회귀 위험:** 폰트/emoji/render codec 차이, Storage URL 권한

### BL1. Usage ledger와 generation authorization

- **우선순위:** P0
- **목적:** 실제 사용량·비용·quota를 generation 승인과 연결
- **범위:** immutable usage event, reservation/settlement/reversal, provider actual/estimated cost
- **의존성:** B1, B2, B3
- **완료 조건:** idempotency key당 한 번 정산되고 실패/취소가 정책대로 환불되며 UI mock credit가 권한 근거가 아님
- **회귀 위험:** retry 중복 정산, provider 비용 지연

### BL2. Billing entitlement enforcement

- **우선순위:** P1
- **목적:** plan/credit UI와 실제 서버 권한 일치
- **범위:** entitlement read model과 gateway authorization; 결제 provider 선택/checkout 구현은 별도
- **의존성:** BL1
- **완료 조건:** UI 조작으로 quota를 우회할 수 없고 entitlement 장애 시 정책이 명시됨
- **회귀 위험:** 기존 사용자 grandfathering과 offline draft

## 4. 권장 실행 순서

```text
A1
 ├─ A2 ─ P1 ─ P2
 └─ D1 ─ D3 ─ D2 ─ O2
P1 + A2 ─ O1 ─ O3
P2 + D1 ─ AI1 ─ S1
P1 + O1 + O2 ─ B1 ─ B2
A2 + B1 ─ B3
A1 + D1 ─ E1 ─ E2
B1 + B2 + B3 ─ BL1 ─ BL2
```

첫 상용화 gate는 **A1, A2, D1~D3, P1, O1~O3, B1~B3, BL1**이다. AI Director와 Studio 재설계는 이 gate를 지연시키지 않으며, 안정된 경계 위에서 진행한다.

## 5. 회귀 매트릭스

| 영역 | 반드시 보호할 사례 |
|---|---|
| Entry | signed-out Sample, signed-in new/clone/pack/remix |
| Modes | global/per-project/saved mode 우선순위, progressed Quick→Pro |
| Quick | 일반/Express, presentation/AI, 단계별 실패와 재시도 |
| Pro | 7단계 gate, 단일/배치 regenerate |
| Provider | missing/rejected key, 429 Retry-After, transient/terminal, saved model |
| Persistence | cloud on/off, timeout/403/404, version 없는 legacy, 1/80/81+ scenes |
| Restore | cloud/local/IDB 조합, media-only synthesis, reorder/conflict |
| Jobs | submit 직후 reload, polling 중 reload, long-wait, duplicate click, cancel |
| Upload | Storage 실패/retry/give-up, 다른 기기 표시, owner deny |
| Media | data/blob/http/placeholder, IDB quota/eviction |
| Export | AI/presentation, Veo audio on/off, hidden scenes, transitions |
| Branding | intro/outro/logo alpha와 실패 정책 |
| Captions | none/clean/bold/hype, Korean/emoji, timing |
| Long form | 179/180초, 3/4 chunks, 20+ scenes, mobile/4GB/1080p/OOM |
| Security | non-owner Firestore/Storage, admin model write, bundle key scan, log redaction |

## 6. 배포 원칙

1. 각 seam은 feature flag와 old adapter를 유지한 채 배포한다.
2. dual-run은 read-only 비교에 먼저 사용하고 유료 generation을 두 번 실행하지 않는다.
3. 저장 변경은 dual-read/write와 rollback window를 둔다.
4. server mode 장애가 quota/security를 우회하는 browser fallback으로 자동 전환되지 않게 한다.
5. 성공률뿐 아니라 duplicate operation, upload availability, restore conflict, export playability를 release metric으로 삼는다.
