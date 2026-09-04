# VibeVideo 상용화 아키텍처 감사 — 현재 상태

## 1. 범위와 읽는 법

이 문서는 2026-09-04 저장소의 실제 코드 기준으로 VibeVideo의 UI 진입, 상태 소유권, 생성, 복구, 업로드, 영속성, 내보내기 흐름을 기록한다. 목표 구조를 현재 구현인 것처럼 서술하지 않는다.

- **현재 배포 단위:** Vite + React 단일 브라우저 애플리케이션 (`package.json`, `vite.config.ts`)
- **외부 런타임:** Firebase Auth/Firestore/Storage, Google Gemini/Veo, 브라우저 IndexedDB/localStorage, ffmpeg.wasm
- **핵심 특징:** UI, 애플리케이션 흐름, 장기 작업 조정, provider 호출, 로컬 복구가 브라우저 안에서 함께 실행된다.
- **감사 제외:** 코드·데이터 모델·저장 형식 변경, 백엔드/결제/provider adapter 구현

## 2. 애플리케이션 진입과 모드

### 2.1 최상위 라우팅

`App.tsx`가 별도 라우터 없이 `currentView`를 소유하며 landing, projects, create, profile, admin/API key 화면을 조건부 렌더링한다.

1. Firebase 인증 상태를 구독한다.
2. 로그인 성공 시 프로젝트 화면으로 이동한다.
3. 로그인 사용자가 생기면 `uploadQueue.resumeAll()`을 먼저 실행한다.
4. 클라우드 동기화 사용 시 `jobManager.autoResumePendingOperations(uid)` 후 나머지 중단 프로젝트를 로드한다.
5. `ProjectWizard`는 `editingProjectId`와 `wizardSessionKey` 조합으로 remount된다.

근거: `App.tsx`의 `App`, 인증 `useEffect`, `handleStartSample`, `handleStartExpress`, `handleRemixYoutube`.

### 2.2 프로젝트 생성

`components/NewProjectModal.tsx`는 세 가지 시작 방식을 제공한다.

- 독립 프로젝트: 최소 `Project` 레코드를 생성하고 저장한다.
- 기존 프로젝트 복제: 장면·결과물은 제외하고 설정을 복사한다. 원본에 ContextPack이 없으면 팩을 만들고 원본과 복제본을 연결한다.
- ContextPack에서 시작: 팩의 캐릭터·스타일·모델 설정을 새 프로젝트에 적용한다.

이 화면은 Quick/Pro를 고르지 않는다. 모드 선택은 `ProjectWizard` 내부 책임이다.

### 2.3 Sample, Express, Quick, Pro

`components/ProjectWizard.tsx`의 `WizardModeRouter`가 모드를 결정한다.

- **Sample:** `services/sampleProject.ts`의 번들 데이터를 사용하고 Pro Step 6에서 시작한다. 로그인이 없어도 가능하며 수정 시 새 소유 프로젝트로 복제한다.
- **Express:** Quick Mode를 강제하고 `WizardContext` 기본값을 16초, 2씬, presentation, critic off로 설정한다.
- **새 프로젝트:** 프로젝트별 저장 모드가 없으면 전역 최근 모드를 사용한다.
- **기존 프로젝트:** 복구 완료 후 `Project.saved_mode` → 프로젝트별 localStorage → Pro 순으로 결정한다.
- 진행된 프로젝트가 Quick으로 복원되면 데이터 손상을 피하기 위해 Pro로 전환한다.

Quick의 실제 파이프라인은 `components/wizard/runQuickPipeline.ts`, Pro의 7단계 화면 분기는 `components/wizard/WizardShell.tsx`에 있다.

## 3. 상태 소유권

### 3.1 브라우저 메모리의 주 소유자

`components/wizard/WizardContext.tsx`가 하나의 큰 React Context로 다음을 소유한다.

| 영역 | 대표 상태 |
|---|---|
| 식별/진행 | projectId, createdAt, step, maxStep, savedMode |
| 창작 설정 | topic, duration, aspectRatio, style, brief, character, ContextPack |
| 도메인 데이터 | script, scenes, styleSheet, captions, stats |
| provider 선택 | selectedTextModel, selectedImageModel, selectedVideoModel |
| 실행 상태 | loading, processingSet/type, failedScenes, syncing/error |
| 미리보기 | audio refs, selected/active scene, quality expansion |
| 내보내기 | merging, progress, mergedVideoUrl |

비동기 hook이 최신 값을 읽도록 같은 값을 `useRef`로 다시 미러링한다. `useSync`, 생성 action hooks, `jobManager` bridge가 이 ref에 의존한다. 따라서 현재의 실질적 aggregate와 application service 경계는 `WizardContext`이며, 단순 UI context가 아니다.

### 3.2 단계 UI

`components/wizard/WizardShell.tsx`의 canonical 단계는 다음과 같다.

1. Vibe/setup (`Step1Setup`)
2. Script (`Step2Script`)
3. Audio
4. Storyboard/image
5. Motion/video 또는 presentation transition
6. Preview
7. Export

Step 3~5는 `StepsAudioImageVideo`가 공유한다. `maxStep` 이하만 이동 가능하다. Quick Mode도 별도 도메인 파이프라인이 아니라 같은 context action을 순차 호출하고 완료 후 Pro shell로 넘긴다.

## 4. 생성 파이프라인

### 4.1 스토리와 씬

- `services/geminiService.ts`: `generateScriptOutline`, `generateScript`, `segmentScriptIntoScenes`, 스타일시트와 참조 이미지 생성
- `components/wizard/Step2Script.tsx`: 사용자 편집 및 다음 단계 전환
- `components/wizard/runQuickPipeline.ts`: script → segmentation → 선택적 stylesheet를 자동 연결

텍스트 생성은 `GoogleGenAI`를 브라우저에서 직접 생성해 호출한다. 실패 시 일부 흐름은 outline 단계를 생략하는 단일 pass fallback을 사용한다.

### 4.2 오디오

`components/wizard/hooks/useAudioActions.ts`가 단일/배치 오디오 생성을 조정하고 `geminiService.generateSceneAudio`를 호출한다. 성공 데이터는:

1. scene state에 반영
2. IndexedDB media cache에 저장
3. Firebase Storage 업로드 시도
4. project snapshot 동기화

Veo 자체 오디오를 사용하면 Quick 파이프라인의 별도 오디오 단계는 생략될 수 있다.

### 4.3 이미지와 비평

`components/wizard/hooks/useImageActions.ts`가 단일, 배치, refine를 조정한다. 실제 생성은 `services/geminiService.ts`의 `generateSceneImage`이며, 모델/스타일/negative prompt/참조 이미지를 조합한다.

`vision_critic_enabled`이면 `services/visionCritic.ts`가 고정 Gemini critic 모델로 품질 점수를 만든다. 임계값 미달 시 refine prompt를 적용할 수 있다. critic 실패는 `null`로 축소되어 이미지 생성 자체는 계속된다.

### 4.4 AI 비디오

`components/wizard/hooks/useVideoActions.ts`는 UI 요청을 `services/jobManager.ts`에 등록하고 job 이벤트를 scene state로 반영한다.

실제 흐름:

1. 모델 메타와 seed preference를 결정한다.
2. `geminiService.generateSceneVideo`가 Veo 장기 operation을 제출한다.
3. operation name을 `Project.generation_run.operations`에 가능한 한 빨리 기록한다.
4. polling이 완료되면 결과를 내려받는다.
5. Firebase Storage 업로드를 시도한다.
6. 업로드 실패 시 `uploadQueue`가 브라우저에 durable retry entry를 남긴다.
7. scene의 `video_path`, `video_meta`, seed/cast/cost 정보를 동기화한다.

`types.ts`의 `GenerationRun`, `OperationRecord`, `VideoMeta`가 현재 작업 수명주기 계약이다. 장기 작업은 video stage만 명시적으로 복구한다.

### 4.5 Presentation

Presentation mode는 AI 비디오 생성을 생략하고 image, audio, transition/motion 설정을 `videoMergeService`에서 영상 클립으로 합성한다. 같은 Scene 모델을 쓰지만 AI 영상과 오디오 의미가 다르므로 회귀 테스트에서 별도 제품 경로로 취급해야 한다.

## 5. 저장과 복구

### 5.1 저장 매체

| 매체 | 책임 | 구현 |
|---|---|---|
| React state/ref | 현재 편집 세션의 live truth | `WizardContext.tsx` |
| localStorage | 작은 프로젝트 fallback, 설정, 모드, 키, queue metadata | `useSync.ts`, `apiKeyService.ts`, `cloudSyncSettings.ts`, `uploadQueue.ts` |
| IndexedDB | 프로젝트 meta와 큰 media payload | `services/mediaCache.ts` |
| Firestore | 사용자 프로젝트/모델/팩의 cross-device metadata | `services/storageService.ts`, `services/modelService.ts`, `services/contextPackService.ts` |
| Firebase Storage | scene blob, 생성 media, brand/reference asset | `storageService.ts` 및 각 upload caller |

`useSync.ts`는 호출 즉시 로컬 snapshot을 쓰고, debounce 후 cloud write를 수행한다. 첫 cloud write는 전체 저장, 이후에는 top-level 및 `saved_scenes_map.{index}.{field}` 단위 diff를 시도한다. 비-HTTP media는 로컬 form에서 `[local-audio|image|video]` 표식으로 바뀐다.

Firestore 문서 크기를 줄이기 위해 scene JSON blob과 map/summary가 병존하지만 현재는 안전한 mirror 관계가 아니다.

1. scenes가 있는 `saveProjectToCloud` 전체 저장은 Storage에 `scenes.json` blob을 올리고 `saved_scenes_map`을 삭제한다.
2. 이후 `useSync`, `jobManager`, `uploadQueue`의 부분 저장은 `saved_scenes_map`만 다시 만들거나 갱신하며 기존 blob을 함께 갱신하거나 무효화하지 않는다.
3. `getProjectFromCloud`는 blob URL/path가 있으면 blob을 우선하고 map을 읽지 않는다.

따라서 **일반 프로젝트도 “전체 blob 저장 → scene/job/upload 부분 patch → reload” 순서에서 최신 이미지·비디오·업로드 상태·편집을 무시하고 오래된 blob scene을 복원할 수 있다.** 이는 단순 80씬 한계가 아니라 P0 source-of-truth/읽기 우선순위 결함이다. 별도로 map/inline 경로에는 80씬 slice가 있어 장편 저장의 silent truncation 위험도 있다.

### 5.2 복구 선택과 병합

`components/wizard/hooks/useRestore.ts`는 기존 프로젝트에서 cloud, localStorage, IndexedDB meta를 읽는다.

1. 단계, scene 수, media 수, 콘텐츠 여부로 각 snapshot을 점수화한다.
2. 가장 “진행된” snapshot을 기준으로 선택한다.
3. 다른 source의 HTTP media URL과 텍스트 필드를 scene index 기준으로 보충한다.
4. 누락 media는 IndexedDB에서 되붙인다.
5. scene record가 없어도 IDB media index가 있으면 빈 scene slot을 합성한다.
6. 발견한 media에 맞춰 `step/maxStep`을 상향하고 로컬 snapshot을 치유한다.

이는 복원력을 높이지만 revision/time 기반 충돌 해소가 아니다. 서로 다른 기기에서 독립 편집하면 “가장 높은 진행 점수”와 index 병합이 최신 사용자 의도를 보장하지 않는다.

`services/storageService.ts`에는 transaction으로 `version`을 비교하는 `saveProjectWithConflictCheck`가 존재하지만 production caller가 없다. 일반 sync는 unchecked full/partial save를 사용한다. 이 helper도 transaction 실패 시 일반 저장으로 fallback하며 conflict를 없다고 반환하므로 그대로 연결하는 것만으로 강한 충돌 방지가 되지는 않는다.

### 5.3 장기 작업과 업로드 복구

- `jobManager`: in-memory jobs, project generation run, Veo operation 재연결, 진행 이벤트를 소유한다.
- `uploadQueue`: 생성은 끝났으나 Storage 업로드가 실패한 blob과 retry schedule을 IndexedDB/local metadata로 유지한다.
- `App.tsx`: 로그인 후 upload replay → operation auto-resume → phantom interrupted job 순으로 실행한다.

브라우저가 닫혀도 operation name이 cloud에 기록됐으면 polling을 다시 붙일 수 있다. 반면 submission과 operation persistence 사이에 종료되거나 IndexedDB가 제거되면 복구가 불가능할 수 있다. queue는 최대 시도 후 재예약을 중단하며 서버 worker가 아니므로 브라우저가 다시 실행되어야 진행된다.

## 6. 내보내기

`components/wizard/hooks/useExportActions.ts`가 hidden scene 제외, intro/outro, captions, logo, 장편 chunking을 조정하고 `services/videoMergeService.ts`가 ffmpeg.wasm을 실행한다.

- 단일 scene: video/audio mux 또는 presentation clip 생성
- 복수 scene: scene별 clip 정규화 → MPEG-TS → concat
- captions: canvas frame overlay 후 encode
- brand: intro/outro 삽입, 최종 logo watermark
- 장편: 안전 chunk를 part MP4로 만든 후 다시 concat; 실패하면 part별 다운로드 fallback
- FFmpeg core: 로컬 load 우선, 실패 시 unpkg CDN fallback

`services/ffmpegLimits.ts`가 길이, scene 수, 해상도, 모바일/메모리 추정치를 사용해 경고/차단한다. 그러나 실제 메모리 보장은 아니며 part blob과 최종 concat/watermark가 동시에 메모리를 차지할 수 있다.

## 7. 현재 운영 특성

- 재시도와 오류 안내는 서비스/hook마다 다르며 공통 error taxonomy나 trace ID가 없다.
- 관측성은 주로 `console.log/warn/error`, project stats, operation metadata다.
- 비용은 scene video metadata의 추정 USD로 기록되지만 실제 provider 청구 원장이나 사용자 quota와 연결되지 않는다.
- Profile의 plan/credit 표시는 실제 결제·권한 enforcement가 아니다.
- Firebase rules는 projects와 `users/{uid}`를 owner로 제한하고, 모델 쓰기는 `/admins/{uid}` 존재로 제한한다. Storage도 `users/{uid}` owner 경로만 허용한다.
- Firebase API key는 공개 client config 성격이지만 Google 생성 API key는 브라우저 bundle/localStorage/host bridge에서 직접 사용되는 별도 고위험 자격증명이다.

## 8. 보존해야 할 현재 동작

후속 변경은 최소한 다음을 회귀 기준으로 삼아야 한다.

1. 로그아웃 Sample 실행, Step 6 진입, 수정 시 소유 프로젝트 복제
2. Express의 2씬/16초/presentation 자동 실행과 Step 7 handoff
3. Quick pipeline의 실패 단계 재시도 및 Pro handoff
4. Pro 7단계와 `maxStep` gate
5. cloud on/off 모두에서 즉시 로컬 snapshot
6. cloud timeout/403/빈 scene에서 local/IDB 복구 및 media 재부착
7. Veo operation reload resume와 upload retry 상태 표시
8. AI video와 presentation 각각의 오디오 처리
9. hidden scene, captions, transition, intro/outro/logo가 포함된 FFmpeg export
10. 장편 part fallback과 결과 MP4 재생 가능성
