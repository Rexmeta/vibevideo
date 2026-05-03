# Firestore 인덱스 배포 가이드

이 저장소의 `firestore.indexes.json` 은 마이 프로젝트 페이지가 사용하는 컴포지트 인덱스 정의를 담고 있습니다.

## 배포해야 하는 이유
`projects` 컬렉션을 `user_id == <uid>` + `orderBy('updated_at', 'desc')` 로 조회하려면 컴포지트 인덱스가 필요합니다. 인덱스가 없으면 코드가 자동으로 폴백 경로(`limit(100)` 후 클라이언트 정렬)로 빠지며 콘솔에 `fallback (simple) 경로 사용 중` 경고가 찍힙니다.

## 한 번만 실행하면 됩니다

```sh
# Firebase CLI 가 처음이라면
npm install -g firebase-tools
firebase login

# 인덱스만 배포
firebase deploy --only firestore:indexes --project <YOUR_FIREBASE_PROJECT_ID>
```

배포 후 Firebase Console → Firestore → Indexes 에서 `projects: user_id ASC, updated_at DESC` 가 `Enabled` 상태인지 확인하세요. 인덱스 빌드는 데이터 양에 따라 수 분에서 수십 분이 걸릴 수 있습니다.

## 신규 인덱스를 추가할 때
1. `firestore.indexes.json` 의 `indexes` 배열에 새 정의를 추가하고 PR 로 검토받습니다.
2. 머지 후 위 `firebase deploy --only firestore:indexes` 를 다시 실행합니다.

## 폴백 경로
컴포지트 쿼리가 실패하면 `services/storageService.ts` 의 `getProjectsPage` / `syncProjectsFromCloud` 가 `where('user_id', '==', uid)` + `limit(100)` + 클라이언트 정렬로 자동 폴백합니다. 이는 비상용이므로 정상 환경에서는 위의 인덱스를 반드시 배포하세요.
