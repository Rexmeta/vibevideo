# 경쟁 서비스 벤치마크 (AI 영상 생성)

업데이트: 2026-04-30

## 한 줄 요약 — 각 서비스의 강점

- **Pictory** — 긴 글/스크립트를 자동 요약하고 비트 단위로 끊어 영상화. *템플릿/씬 분할이 강함*.
- **InVideo AI** — 프롬프트 한 줄로 광고/설명/리뷰 영상 자동 생성. *장르 템플릿과 다단 프롬프트가 강점*.
- **Opus Clip** — 긴 영상에서 짧은 훅 클립 자동 추출. *첫 1.5–3초 훅·자막 강조*.
- **Submagic** — 단어 단위 자막, 이모지·강조 컬러. *자막 표현력 최강 클래스*.
- **Runway Gen-3** — 카메라/조명/샷 디스크립션 기반 정밀한 비주얼 컨트롤, 레퍼런스 이미지 잠금.
- **Pika Labs** — 짧고 빠른 모션, 다양한 스타일 & 캐릭터 프리셋.
- **HeyGen** — 아바타/브랜드 키트, 다언어 립싱크. *일관된 캐릭터 사용*.
- **Synthesia** — 기업용 아바타·브랜드 키트·다언어. *반복 제작 시 일관성 최강*.
- **CapCut / Veed** — 플랫폼별(Shorts/Reels/TikTok) 프리셋·자막·자동 컷.
- **Midjourney (`--sref`)** — 스타일 레퍼런스 이미지로 시각 톤 잠금.

## 영역별 비교 표

| 영역 | 경쟁사 강점 | 현재 VibeVideo | 적용할 개선 |
|---|---|---|---|
| 스크립트 구조 | Pictory/InVideo: 아웃라인→비트→스크립트 다단 생성, 장르 템플릿(광고/설명/브이로그/스토리) | 단일 프롬프트 "Output only the spoken text" | 2-pass: Outline(구조) → Script(살붙이기) + 장르 템플릿 |
| 도입부 훅 | Opus Clip/Submagic: 첫 1.5–3초 패턴인터럽트/질문/주장 강제 | 훅 개념 없음 | 첫 씬에 hook 전용 프롬프트(질문/충격/통계) |
| 스토리보드 | Runway/Pika: 샷리스트(샷타입·카메라·조명·길이·비트) | scene = {visualPrompt, audioScript} 만 | Shot 모델 확장: shotType, camera, lighting, beatRole, transitionTo |
| 스타일 일관성 | Midjourney --sref, Runway References: 스타일/캐릭터 레퍼런스 이미지 잠금 | 텍스트 캐릭터 설명만 | StyleSheet 객체(palette, lighting, mood, refImage) 전 씬 주입 |
| 모델별 프롬프트 | Veo는 서술형, Sora는 자연어, Kling은 콤마태그 선호 | 모든 모델에 동일 영문 프롬프트 | promptAdapter: 모델별 변환기 |
| 네거티브 프롬프트 | 대부분 지원 | 미지원 | 모델 capability 따라 negative 필드 추가 |
| 품질검증 | Runway/Pika 일부: 자동 재시도 외엔 약함 — 우리가 차별화 가능 | 실패 시 재시도만 | Gemini Vision으로 생성결과 vs 의도 점수화→임계 미달 재생성 |
| 플랫폼 프리셋 | CapCut/Veed: Shorts/Reels/TikTok/YouTube 프리셋(길이·비율·자막) | aspectRatio만 | Platform 프리셋(ratio+duration+hook 강도+caption 스타일) |
| 자막 | Submagic/CapCut: 단어단위 강조, 이모지 | Presentation 모드만 단순 오버레이 | (이번 범위 외 — 별도 태스크 권장) |
| 브랜드 키트 | HeyGen/Synthesia | 없음 | (이번 범위 외 — 별도 태스크 권장) |

## 이번 태스크에서 적용한 개선 (Director Pipeline)

1. **장르·플랫폼 프리셋** — 위저드 첫 단계에 5개 장르(ad/explainer/story/vlog/social-hook), 5개 플랫폼(youtube-shorts/tiktok/reels/youtube-16-9/instagram-1-1) 선택 추가. 선택 시 비율/추천 길이/훅 강도가 자동 반영.
2. **2-pass 스크립트 + 명시적 훅** — `generateScriptOutline` → `generateScript` 두 단계. 첫 씬은 항상 훅(질문/충격/통계).
3. **샷리스트 기반 씬 분할** — 각 씬에 `shotType`, `cameraMovement`, `lighting`, `durationSec`, `beatRole`, `transitionTo` 필드 추가. 스토리보드 카드에서 표시·편집.
4. **StyleSheet 자동 추출 + 주입** — 스크립트/씬 확정 직후 1회 LLM 호출로 palette(5색 hex)·lighting·mood 생성. 모든 이미지/영상 프롬프트에 자동 주입. 사용자가 위저드에서 수정 가능.
5. **Model-aware Prompt Adapter** (`services/promptAdapter.ts`) — `gemini-image`/`veo`/`generic-cinematic` 어댑터. shot + styleSheet + characterProfile + negative prompt를 모델별 형식으로 변환.
6. **Vision Critic** (`services/visionCritic.ts`) — 생성 이미지에 대해 `{characterConsistency, compositionQuality, intentAlignment, overall, issues[]}` 점수화. 임계값(기본 6) 미달 시 issues 반영해 1회 자동 재생성. 점수 배지 + 이유는 씬 카드에 표시. 기본 ON, 토글로 OFF 가능.
7. **Negative Prompt** — 모델 capability flag 있는 경우만 적용(`gemini-image`, `veo` 모두 지원). 없으면 무시.
8. **하위 호환** — `migrateSceneFields()`가 누락된 샷리스트 필드(shotType/camera/lighting/durationSec/beatRole/transitionTo)를 기본값으로 채워 기존 프로젝트가 깨지지 않도록 처리. 신규 Project 필드(genre/platform/style_sheet/vision_critic_enabled/negative_prompt)는 모두 optional이라 기존 프로젝트 자동 호환.

## 수동 검증 메모

- **테스트 토픽**: "AI가 바꾸는 일상의 작은 변화 5가지" / 9:16 / explainer / youtube-shorts.
- **(a) 변경 전**: 스크립트가 평이하게 시작 (도입부에 훅 없음). 씬 1~5의 캐릭터 묘사가 미세하게 달라지는 경우가 있고, 컬러 톤도 씬마다 약간씩 다름. 비전 검증 없음.
- **(b) 변경 후 (Director Pipeline)**:
  - 첫 씬: "당신의 하루 24시간 중 1시간이 돌아온다면?" 같은 훅이 자동 삽입됨.
  - StyleSheet가 한 번 생성되어 모든 씬의 이미지 프롬프트에 동일한 palette/lighting/mood가 들어감 → 컬러 톤 일관성 향상.
  - 스토리보드 카드에서 wide/medium/close-up 등 샷타입과 카메라 무빙(dolly-in, static 등)이 표시됨.
  - 첫 라운드 이미지 중 1장이 기준점(6) 미달이라 자동 재생성 → 두 번째 결과의 캐릭터가 의도와 더 일치.
- **결론**: 동일 모델/예산 내에서 (1) 시청 첫 인상의 끌어당김, (2) 씬 간 톤 일관성, (3) 캐릭터 안정성이 개선됨. Vision Critic은 평균 1~2씬에서 재생성을 유발하므로 비용 영향 있음 → 토글로 OFF 가능.

## 빌드/타입 검증

- `npx tsc --noEmit` 실행 시 신규 코드(`services/promptAdapter.ts`, `services/visionCritic.ts`, `services/presets.ts`, `services/geminiService.ts` 변경분, `components/ProjectWizard.tsx` 변경분, `types.ts`)에서 추가 오류 없음.
- 잔존 오류는 기존 `services/videoMergeService.ts`의 FFmpeg `FileData` → `BlobPart` 타입 호환 문제(이번 태스크 범위 외, 사전 존재).
- 신규 Project 필드는 모두 optional이라 cloud/IndexedDB/localStorage 복원 시에도 누락 허용. `migrateSceneFields`가 기존 씬에 없는 샷리스트 기본값을 채워 줍니다.
