import { db } from './firebaseConfig';
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy, writeBatch } from 'firebase/firestore';
import { AIModel, ModelType } from '../types';

const COLLECTION = 'ai_models';
const LOCAL_KEY = 'vibe_ai_models';
const ADMIN_UIDS_KEY = 'vibe_admin_uids';

const DEFAULT_MODELS: AIModel[] = [
  { id: 'img-nano-banana-pro', name: 'Nano Banana Pro', type: 'image', provider: 'NanoBanana', description: '최고의 퀄리티와 일관성 유지가 가능한 나노바나나 프로', modelId: 'gemini-3-pro-image-preview', isActive: true, sortOrder: 1, supportsKorean: true },
  { id: 'img-seedream-v45', name: 'Seedream V4.5', type: 'image', provider: 'ByteDance', description: '놀라운 연속성과 높은 퀄리티. 한글은 미지원', modelId: 'seedream-v4.5', isActive: true, sortOrder: 2, supportsKorean: false },
  { id: 'img-nano-banana', name: 'Nano-Banana', type: 'image', provider: 'NanoBanana', description: '나노바나나 일반 버전', modelId: 'gemini-2.5-flash-image', isActive: true, sortOrder: 3, supportsKorean: true },
  { id: 'img-seedream-v4', name: 'Seedream V4', type: 'image', provider: 'ByteDance', description: '가성비 최고의 이미지 생성/편집 AI 모델', modelId: 'seedream-v4', isActive: true, sortOrder: 4, supportsKorean: false },
  { id: 'img-midjourney', name: 'Midjourney', type: 'image', provider: 'Midjourney', description: '다양한 스타일과 고품질 AI 이미지 생성 가능', modelId: 'midjourney', isActive: true, sortOrder: 5, supportsKorean: true },
  { id: 'img-qwen', name: 'Qwen Image', type: 'image', provider: 'Alibaba', description: '알리바바가 만든 높은 퀄리티의 이미지 생성 AI', modelId: 'qwen-image', isActive: true, sortOrder: 6, supportsKorean: true },
  { id: 'img-ideogram-v3', name: 'Ideogram V3', type: 'image', provider: 'Ideogram', description: '텍스트 렌더링에 강하여 로고 생성에 적합', modelId: 'ideogram-v3', isActive: true, sortOrder: 7, supportsKorean: true },
  { id: 'img-z-image-turbo', name: 'Z-Image Turbo', type: 'image', provider: 'Alibaba', description: 'Alibaba 초고속 이미지 생성이 가능', modelId: 'z-image-turbo', isActive: true, sortOrder: 8, supportsKorean: true },
  { id: 'img-gpt-image', name: 'GPT Image 1.5', type: 'image', provider: 'OpenAI', description: 'OpenAI의 최신 이미지 생성 모델. 정밀한 편집과 텍스트 렌더링에 강함', modelId: 'gpt-image-1.5', isActive: true, sortOrder: 9, supportsKorean: true },
  { id: 'img-flux-2', name: 'Flux 2', type: 'image', provider: 'Black Forest Labs', description: '빠른 속도와 극대화된 실사 표현력을 가진 차세대 모델', modelId: 'flux-2', isActive: true, sortOrder: 10, supportsKorean: true },
  { id: 'img-grok-imagine', name: 'Grok Imagine', type: 'image', provider: 'xAI', description: 'xAI 의 빠른 속도의 최신 생성 모델', modelId: 'grok-imagine', isActive: true, sortOrder: 11, supportsKorean: true },

  { id: 'vid-seedance-lite', name: 'Seedance 1.0 Lite', type: 'video', provider: 'ByteDance', description: 'ByteDance의 경량 Seedance 모델', modelId: 'seedance-1.0-lite', isActive: true, sortOrder: 1, supportsKorean: true },
  { id: 'vid-veo-31', name: 'Veo 3.1', type: 'video', provider: 'Google', description: '구글이 만든 사실적인 영상과 오디오 생성 AI', modelId: 'veo-3.1-fast-generate-preview', isActive: true, sortOrder: 2, supportsKorean: true },
  { id: 'vid-sora-2', name: 'Sora 2', type: 'video', provider: 'OpenAI', description: 'OpenAI 의 편리하고 너무 사실적인 영상 생성 모델', modelId: 'sora-2', isActive: true, sortOrder: 3, supportsKorean: true },
  { id: 'vid-kling-30', name: 'Kling 3.0', type: 'video', provider: 'Kuaishou', description: '멀티샷 제어와 오디오 동기화가 되는 차세대 올인원 AI 비디오 생성 모델', modelId: 'kling-3.0', isActive: true, sortOrder: 4, supportsKorean: true },
  { id: 'vid-kling-26', name: 'Kling 2.6', type: 'video', provider: 'Kuaishou', description: 'Kling 2.6 영상 생성 모델 - 네이티브 오디오 지원', modelId: 'kling-2.6', isActive: true, sortOrder: 5, supportsKorean: true },
  { id: 'vid-hailuo-23', name: 'Hailuo 2.3', type: 'video', provider: 'Minimax', description: '빠르고 현실적인 움직임이 가능한 하이루오 최신버전', modelId: 'hailuo-2.3', isActive: true, sortOrder: 6, supportsKorean: true },
  { id: 'vid-seedance-15pro', name: 'Seedance 1.5 Pro', type: 'video', provider: 'ByteDance', description: 'ByteDance의 Seedance 1.5 Pro 모델', modelId: 'seedance-1.5-pro', isActive: true, sortOrder: 7, supportsKorean: true },
  { id: 'vid-kling-25turbo', name: 'Kling 2.5 Turbo', type: 'video', provider: 'Kuaishou', description: 'Kuaishou가 만든 영화급 품질의 AI 영상 생성 모델', modelId: 'kling-2.5-turbo', isActive: true, sortOrder: 8, supportsKorean: true },
  { id: 'vid-hailuo-02', name: 'Hailuo 02', type: 'video', provider: 'Minimax', description: 'Minimax의 정교한 물리 시뮬레이션 영상 생성 모델', modelId: 'hailuo-02', isActive: true, sortOrder: 9, supportsKorean: true },
  { id: 'vid-vidu-q3', name: 'Vidu Q3', type: 'video', provider: 'Vidu', description: '높은 연속성과 컷전환 제작이 가능한 고성능 AI 비디오 모델', modelId: 'vidu-q3', isActive: true, sortOrder: 10, supportsKorean: true },
  { id: 'vid-kling-o1', name: 'Kling O1', type: 'video', provider: 'Kuaishou', description: '생성과 편집까지 한 번에 처리하는 클링의 통합 멀티모달 모델', modelId: 'kling-o1', isActive: true, sortOrder: 11, supportsKorean: true },
  { id: 'vid-seedance-v1', name: 'Seedance V1', type: 'video', provider: 'ByteDance', description: 'ByteDance의 정교한 자세 추적과 모션 생성 AI', modelId: 'seedance-v1', isActive: true, sortOrder: 12, supportsKorean: true },
  { id: 'vid-wan-25', name: 'Wan 2.5', type: 'video', provider: 'Alibaba', description: 'Alibaba가 만든 영상·음성 동기화 AI 생성 모델', modelId: 'wan-2.5', isActive: true, sortOrder: 13, supportsKorean: true },
  { id: 'vid-midjourney', name: 'Midjourney', type: 'video', provider: 'Midjourney', description: '예술적 감각이 뛰어난 이미지 영상 생성 AI', modelId: 'midjourney-video', isActive: true, sortOrder: 14, supportsKorean: true },
];

export const NANO_BANANA_ALIAS_TO_API_ID: Record<string, string> = {
  'nano-banana-pro': 'gemini-3-pro-image-preview',
  'nano-banana': 'gemini-2.5-flash-image',
};

export type GoogleModelIdWarning =
  | { level: 'warn'; message: string; suggestedId?: string }
  | { level: 'info'; message: string }
  | null;

export function checkGoogleModelIdInput(provider: string, modelId: string): GoogleModelIdWarning {
  const p = (provider || '').trim().toLowerCase();
  if (p !== 'nanobanana' && p !== 'google') return null;
  const id = (modelId || '').trim();
  if (!id) return null;
  const aliasTarget = NANO_BANANA_ALIAS_TO_API_ID[id];
  if (aliasTarget) {
    return {
      level: 'warn',
      message: `이 값은 마케팅 별칭입니다. 실제 Google API ID(${aliasTarget})로 자동 변환됩니다.`,
      suggestedId: aliasTarget,
    };
  }
  if (!id.toLowerCase().startsWith('gemini-')) {
    return {
      level: 'info',
      message: 'Google API 모델 ID 가 아닐 수 있습니다. (예: gemini-2.5-flash-image)',
    };
  }
  return null;
}

function migrateNanoBananaModels(models: AIModel[]): { models: AIModel[]; changed: AIModel[] } {
  const changed: AIModel[] = [];
  const migrated = models.map(m => {
    if (m.provider === 'NanoBanana' && m.modelId && NANO_BANANA_ALIAS_TO_API_ID[m.modelId]) {
      const fixed: AIModel = { ...m, modelId: NANO_BANANA_ALIAS_TO_API_ID[m.modelId] };
      console.log(`[ModelService] Migrating NanoBanana model "${m.name}" modelId: ${m.modelId} → ${fixed.modelId}`);
      changed.push(fixed);
      return fixed;
    }
    return m;
  });
  return { models: migrated, changed };
}

function getLocalModels(): AIModel[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function setLocalModels(models: AIModel[]) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(models)); } catch {}
}

async function persistMigratedModels(changed: AIModel[]): Promise<void> {
  if (!db || changed.length === 0) return;
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    for (const m of changed) {
      batch.set(doc(db, COLLECTION, m.id), { ...m, updated_at: now }, { merge: true });
    }
    await batch.commit();
    console.log(`[ModelService] Persisted NanoBanana migration for ${changed.length} model(s) to Firestore`);
  } catch (e) {
    console.warn('[ModelService] Failed to persist NanoBanana migration to Firestore (in-memory still corrected):', e);
  }
}

export async function getModels(): Promise<AIModel[]> {
  if (db) {
    try {
      const q = query(collection(db, COLLECTION), orderBy('sortOrder', 'asc'));
      const snap = await getDocs(q);
      if (snap.empty) {
        await seedDefaultModels();
        const snap2 = await getDocs(q);
        const raw = snap2.docs.map(d => ({ ...d.data(), id: d.id } as AIModel));
        const { models, changed } = migrateNanoBananaModels(raw);
        if (changed.length > 0) await persistMigratedModels(changed);
        setLocalModels(models);
        return models;
      }
      const raw = snap.docs.map(d => ({ ...d.data(), id: d.id } as AIModel));
      const { models, changed } = migrateNanoBananaModels(raw);
      if (changed.length > 0) await persistMigratedModels(changed);
      setLocalModels(models);
      return models;
    } catch (e) {
      console.warn('[ModelService] Firestore fetch failed, using local:', e);
    }
  }

  const local = getLocalModels();
  if (local.length > 0) {
    const { models, changed } = migrateNanoBananaModels(local);
    if (changed.length > 0) setLocalModels(models);
    return models;
  }
  setLocalModels(DEFAULT_MODELS);
  return DEFAULT_MODELS;
}

export function getModelsByType(models: AIModel[], type: ModelType): AIModel[] {
  return models.filter(m => m.type === type && m.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function saveModel(model: AIModel): Promise<void> {
  model.updated_at = new Date().toISOString();
  if (!model.created_at) model.created_at = model.updated_at;

  if (db) {
    try {
      await setDoc(doc(db, COLLECTION, model.id), model);
    } catch (e) {
      console.error('[ModelService] Save to Firestore failed:', e);
    }
  }

  const local = getLocalModels();
  const idx = local.findIndex(m => m.id === model.id);
  if (idx >= 0) local[idx] = model;
  else local.push(model);
  setLocalModels(local);
}

export async function deleteModel(modelId: string): Promise<void> {
  if (db) {
    try {
      await deleteDoc(doc(db, COLLECTION, modelId));
    } catch (e) {
      console.error('[ModelService] Delete from Firestore failed:', e);
    }
  }
  const local = getLocalModels().filter(m => m.id !== modelId);
  setLocalModels(local);
}

export async function seedDefaultModels(): Promise<void> {
  if (!db) {
    setLocalModels(DEFAULT_MODELS);
    return;
  }
  try {
    const batch = writeBatch(db);
    for (const m of DEFAULT_MODELS) {
      const now = new Date().toISOString();
      batch.set(doc(db, COLLECTION, m.id), { ...m, created_at: now, updated_at: now });
    }
    await batch.commit();
    setLocalModels(DEFAULT_MODELS);
    console.log('[ModelService] Default models seeded successfully');
  } catch (e) {
    console.error('[ModelService] Seed failed:', e);
    setLocalModels(DEFAULT_MODELS);
  }
}

export function isAdminUser(uid: string): boolean {
  try {
    const raw = localStorage.getItem(ADMIN_UIDS_KEY);
    const admins: string[] = raw ? JSON.parse(raw) : [];
    if (admins.length === 0) {
      const firstLoginKey = 'vibe_first_admin_set';
      if (!localStorage.getItem(firstLoginKey)) {
        localStorage.setItem(firstLoginKey, 'true');
        setAdminUids([uid]);
        return true;
      }
      return false;
    }
    return admins.includes(uid);
  } catch { return false; }
}

export function getAdminUids(): string[] {
  try {
    const raw = localStorage.getItem(ADMIN_UIDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function setAdminUids(uids: string[]) {
  try { localStorage.setItem(ADMIN_UIDS_KEY, JSON.stringify(uids)); } catch {}
}
