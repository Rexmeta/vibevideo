import React, { useEffect, useMemo, useState } from 'react';
import { Icons } from './Icons';
import { ContextPack, Project } from '../types';
import {
  findLinkedProjects,
  getPack,
  listPacks,
  markLinkedProjectsDirty,
  savePack,
} from '../services/contextPackService';
import { useWizard } from './wizard/WizardContext';
import { updateProjectFields } from '../services/storageService';

interface Props {
  onClose: () => void;
}

export const SaveContextPackModal: React.FC<Props> = ({ onClose }) => {
  const w = useWizard();
  const userId = w.userId || '';

  const [packs, setPacks] = useState<ContextPack[]>([]);
  const [mode, setMode] = useState<'new' | 'overwrite'>(
    w.linkedContextPackId ? 'overwrite' : 'new'
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetPackId, setTargetPackId] = useState<string>(
    w.linkedContextPackId || ''
  );
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<{
    pack: ContextPack;
    projects: Project[];
  } | null>(null);

  useEffect(() => {
    if (!userId) return;
    listPacks(userId)
      .then(list => {
        setPacks(list);
        const linked = w.linkedContextPackId
          ? list.find(p => p.id === w.linkedContextPackId)
          : undefined;
        if (linked) {
          setName(linked.name);
          setDescription(linked.description || '');
          setTargetPackId(linked.id);
        }
      })
      .catch(e => console.warn('[SaveContextPackModal] listPacks failed:', e));
  }, [userId, w.linkedContextPackId]);

  const currentFields = useMemo(
    () => ({
      character_profile: w.characterProfile || undefined,
      character_reference_image: w.characterReferenceImage,
      character_references: w.characterReferences?.length
        ? w.characterReferences
        : undefined,
      style_sheet: w.styleSheet,
      video_style: w.videoStyle,
      aspect_ratio: w.aspectRatio,
      selected_image_model: w.selectedImageModel || undefined,
      selected_video_model: w.selectedVideoModel || undefined,
      use_veo_audio: w.useVeoAudio,
      caption_style: w.captionStyle,
      video_mode: w.videoMode,
      negative_prompt: w.negativePrompt || undefined,
      vision_critic_enabled: w.visionCriticEnabled,
      quality_threshold: w.qualityThreshold,
      genre: w.genre,
      platform: w.platform,
    }),
    [
      w.characterProfile,
      w.characterReferenceImage,
      w.characterReferences,
      w.styleSheet,
      w.videoStyle,
      w.aspectRatio,
      w.selectedImageModel,
      w.selectedVideoModel,
      w.useVeoAudio,
      w.captionStyle,
      w.videoMode,
      w.negativePrompt,
      w.visionCriticEnabled,
      w.qualityThreshold,
      w.genre,
      w.platform,
    ]
  );

  const handleSave = async () => {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!name.trim()) {
      alert('팩 이름을 입력하세요.');
      return;
    }
    if (mode === 'overwrite' && targetPackId) {
      try {
        const existing = await getPack(userId, targetPackId);
        if (!existing) {
          alert('대상 팩을 찾을 수 없습니다. 새 팩으로 저장합니다.');
          await performSave(null);
          return;
        }
        const linked = await findLinkedProjects(userId, existing.id);
        if (linked.length >= 2) {
          setImpact({ pack: existing, projects: linked });
          return;
        }
        await performSave(existing);
      } catch (e: any) {
        alert(`팩 저장 실패: ${e?.message || e}`);
      }
      return;
    }
    await performSave(null);
  };

  const performSave = async (existing: ContextPack | null) => {
    const trimmed = name.trim();
    setBusy(true);
    try {
      const base: ContextPack = existing
        ? {
            ...existing,
            name: trimmed,
            description: description || undefined,
            ...currentFields,
            updated_at: new Date().toISOString(),
          }
        : freshPack(userId, trimmed, description, currentFields);

      const saved = await savePack(base);

      // Link the current project to the saved pack so subsequent edits
      // recognise it as the source-of-truth pack. Narrow update only —
      // does NOT touch project metadata (aspect_ratio, scene_count, etc.).
      if (w.projectId) {
        try {
          await updateProjectFields(w.projectId, {
            linked_context_pack_id: saved.id,
            context_pack_version: saved.version,
            context_pack_dirty: false,
          });
          w.setLinkedContextPackId?.(saved.id);
          w.setContextPackVersion?.(saved.version);
          w.setContextPackDirty?.(false);
        } catch (e) {
          console.warn('[SaveContextPackModal] link project failed:', e);
        }
      }

      // Fan out dirty flag to OTHER linked projects (skip current).
      try {
        await markLinkedProjectsDirty(userId, saved.id, saved.version);
      } catch (e) {
        console.warn('[SaveContextPackModal] markDirty failed:', e);
      }

      alert(`'${saved.name}' 팩이 저장되었습니다.`);
      onClose();
    } catch (e: any) {
      alert(`팩 저장 실패: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] max-w-lg w-full p-7 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          disabled={busy}
          className="absolute top-5 right-5 p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
        >
          <Icons.X size={18} />
        </button>

        <h2 className="text-2xl font-black tracking-tight mb-1">
          컨텍스트 팩 저장
        </h2>
        <p className="text-xs text-gray-500 font-medium mb-6">
          현재 캐릭터, 스타일, 모델 설정을 재사용 가능한 팩으로 저장합니다.
        </p>

        {packs.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-5 p-1 bg-gray-100 rounded-2xl">
            <button
              onClick={() => setMode('new')}
              className={`py-2 rounded-xl text-xs font-black transition ${mode === 'new' ? 'bg-white shadow' : 'text-gray-500'}`}
            >
              새 팩 생성
            </button>
            <button
              onClick={() => setMode('overwrite')}
              className={`py-2 rounded-xl text-xs font-black transition ${mode === 'overwrite' ? 'bg-white shadow' : 'text-gray-500'}`}
            >
              기존 팩 덮어쓰기
            </button>
          </div>
        )}

        {mode === 'overwrite' && packs.length > 0 && (
          <div className="mb-4">
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-2">
              덮어쓸 팩
            </label>
            <select
              value={targetPackId}
              onChange={e => {
                setTargetPackId(e.target.value);
                const p = packs.find(x => x.id === e.target.value);
                if (p) {
                  setName(p.name);
                  setDescription(p.description || '');
                }
              }}
              className="w-full p-3 rounded-xl border-2 border-gray-100 text-sm font-bold"
            >
              <option value="">선택...</option>
              {packs.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.linked_project_count
                    ? ` (${p.linked_project_count}개 사용 중)`
                    : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4">
          <label className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-2">
            팩 이름 *
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="예: 시트콤 캐릭터팩 v1"
            className="w-full p-3 rounded-xl border-2 border-gray-100 text-sm font-bold focus:border-brand-cyan outline-none"
          />
        </div>

        <div className="mb-5">
          <label className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-2">
            설명 (선택)
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="이 팩을 어디에 쓰는지 메모"
            className="w-full p-3 rounded-xl border-2 border-gray-100 text-sm font-medium focus:border-brand-cyan outline-none resize-none"
          />
        </div>

        <div className="mb-6 p-4 rounded-2xl bg-gray-50 text-xs text-gray-600 font-medium space-y-1">
          <p className="font-black text-[10px] uppercase tracking-wider text-gray-400 mb-2">
            저장될 항목
          </p>
          {currentFields.character_profile && <p>· 캐릭터 프로필</p>}
          {currentFields.character_references &&
            currentFields.character_references.length > 0 && (
              <p>
                · 캐릭터 레퍼런스 {currentFields.character_references.length}개
              </p>
            )}
          {currentFields.style_sheet && <p>· 스타일 시트</p>}
          {currentFields.video_style && (
            <p>· 비디오 스타일: {currentFields.video_style}</p>
          )}
          {currentFields.aspect_ratio && (
            <p>· 화면비: {currentFields.aspect_ratio}</p>
          )}
          {currentFields.selected_image_model && <p>· 이미지 모델</p>}
          {currentFields.selected_video_model && <p>· 비디오 모델</p>}
          {currentFields.video_mode && (
            <p>
              · 비디오 모드:{' '}
              {currentFields.video_mode === 'presentation' ? '프레젠테이션' : 'AI 영상'}
            </p>
          )}
          {currentFields.caption_style && <p>· 캡션 스타일</p>}
          {currentFields.negative_prompt && <p>· 네거티브 프롬프트</p>}
        </div>

        <button
          onClick={handleSave}
          disabled={busy || !name.trim()}
          className="w-full bg-brand-dark text-white py-4 rounded-2xl font-black hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? (
            <>
              <Icons.Loader2 size={16} className="animate-spin" /> 저장 중...
            </>
          ) : (
            <>
              <Icons.Layers size={16} /> 팩 저장
            </>
          )}
        </button>
      </div>

      {impact && (
        <div className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
                <Icons.AlertTriangle size={18} className="text-amber-700" />
              </div>
              <h3 className="text-lg font-black tracking-tight">
                영향 받는 프로젝트 {impact.projects.length}개
              </h3>
            </div>
            <p className="text-xs text-gray-600 mb-4 leading-relaxed">
              <span className="font-black">'{impact.pack.name}'</span> 팩이
              아래 프로젝트들에 연결되어 있습니다. 저장하면 각 프로젝트에
              <span className="font-black"> "팩 변경 있음" </span>표시가
              추가되며, 사용자가 각 프로젝트를 열어
              <span className="font-black"> "팩 변경 적용" </span>버튼을
              누르면 변경사항이 반영됩니다. 자동으로 덮어쓰지 않습니다.
            </p>
            <div className="max-h-56 overflow-y-auto border border-gray-100 rounded-2xl divide-y divide-gray-100 mb-4">
              {impact.projects.map(p => (
                <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{p.title || '제목 없음'}</p>
                    <p className="text-[10px] text-gray-400 font-medium">
                      {p.aspect_ratio}
                      {p.id === w.projectId ? ' · 현재 프로젝트' : ''}
                    </p>
                  </div>
                  {p.id === w.projectId && (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-brand-cyan/20 text-brand-dark">
                      지금
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setImpact(null)}
                disabled={busy}
                className="flex-1 py-3 rounded-2xl border-2 border-gray-100 font-black text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  const pack = impact.pack;
                  setImpact(null);
                  await performSave(pack);
                }}
                disabled={busy}
                className="flex-1 py-3 rounded-2xl bg-brand-dark text-white font-black text-sm hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? (
                  <>
                    <Icons.Loader2 size={14} className="animate-spin" /> 저장 중...
                  </>
                ) : (
                  '저장하고 진행'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

type PackInheritableFields = Partial<
  Omit<
    ContextPack,
    'id' | 'user_id' | 'name' | 'description' | 'created_at' | 'updated_at' | 'version'
  >
>;

function freshPack(
  userId: string,
  name: string,
  description: string,
  fields: PackInheritableFields
): ContextPack {
  const now = new Date().toISOString();
  return {
    id: `pack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: userId,
    name,
    description: description || undefined,
    created_at: now,
    updated_at: now,
    version: 0,
    ...fields,
  };
}
