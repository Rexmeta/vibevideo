import React, { useEffect, useState } from 'react';
import { Icons } from './Icons';
import { ContextPack, Project, ProjectStatus } from '../types';
import {
  applyPackToProjectFields,
  deletePack,
  generatePackId,
  listPacksWithSource,
  savePack,
  type PackListSource,
} from '../services/contextPackService';
import {
  generateProjectId,
  saveProjectToCloud,
  getAllProjectsFromCloud,
} from '../services/storageService';

interface Props {
  userId: string;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

export const NewProjectModal: React.FC<Props> = ({
  userId,
  onClose,
  onCreated,
}) => {
  const [packs, setPacks] = useState<ContextPack[]>([]);
  const [packSource, setPackSource] = useState<PackListSource>('cloud');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState<'choice' | 'pickPack' | 'pickProject'>(
    'choice'
  );

  useEffect(() => {
    if (!userId) return;
    listPacksWithSource(userId)
      .then(({ packs: list, source }) => {
        setPacks(list);
        setPackSource(source);
      })
      .catch(e => console.warn('[NewProjectModal] listPacks failed:', e))
      .finally(() => setLoading(false));
  }, [userId]);

  // Lazy-load projects only when the user opens the copy step.
  useEffect(() => {
    if (step !== 'pickProject' || projects.length > 0 || loadingProjects) return;
    setLoadingProjects(true);
    getAllProjectsFromCloud(userId)
      .then(list => {
        const sorted = [...list].sort((a, b) => {
          const aT = a.updated_at || a.created_at || '';
          const bT = b.updated_at || b.created_at || '';
          return bT.localeCompare(aT);
        });
        setProjects(sorted);
      })
      .catch(e => console.warn('[NewProjectModal] list projects failed:', e))
      .finally(() => setLoadingProjects(false));
  }, [step, userId, projects.length, loadingProjects]);

  const createIndependent = async () => {
    setCreating(true);
    try {
      const id = generateProjectId();
      const now = new Date().toISOString();
      const proj: Project = {
        id,
        user_id: userId,
        title: '새 비디오 프로젝트',
        aspect_ratio: '16:9',
        style_template: 'Cute Stickman',
        status: ProjectStatus.DRAFT,
        created_at: now,
        updated_at: now,
        saved_step: 1,
        saved_max_step: 1,
      };
      await saveProjectToCloud(proj);
      onCreated(id);
    } catch (e: any) {
      alert(`프로젝트 생성에 실패했습니다: ${e?.message || e}`);
      setCreating(false);
    }
  };

  const createFromProject = async (source: Project) => {
    setCreating(true);
    try {
      const id = generateProjectId();
      const now = new Date().toISOString();

      // If the source project has no pack, auto-create one from its current
      // setup so both projects share a single pack going forward — that is
      // what "다른 프로젝트와 동일하게" promises (shared context, not a one-shot
      // copy). Then back-link the source project to the new pack.
      let linkedPackId = source.linked_context_pack_id;
      let linkedPackVersion: number | undefined;
      if (!linkedPackId) {
        const pack: ContextPack = {
          id: generatePackId(),
          user_id: userId,
          name: `${source.title || '제목 없음'} 컨텍스트`,
          created_at: now,
          updated_at: now,
          version: 0,
          character_profile: source.character_profile,
          character_reference_image: source.character_reference_image,
          character_references: source.character_references,
          style_sheet: source.style_sheet,
          video_style: source.style_template,
          aspect_ratio: source.aspect_ratio,
          selected_image_model: source.selected_image_model,
          selected_video_model: source.selected_video_model,
          use_veo_audio: source.use_veo_audio,
          caption_style: source.caption_style,
          video_mode: source.video_mode,
          negative_prompt: source.negative_prompt,
          vision_critic_enabled: source.vision_critic_enabled,
          quality_threshold: source.quality_threshold,
          genre: source.genre,
          platform: source.platform,
          linked_project_count: 2,
        };
        const saved = await savePack(pack);
        linkedPackId = saved.id;
        linkedPackVersion = saved.version;
        // Back-link the source project so future pack edits land on it too.
        try {
          await saveProjectToCloud({
            ...source,
            linked_context_pack_id: saved.id,
            context_pack_version: saved.version,
            context_pack_dirty: false,
            updated_at: now,
          });
        } catch (e) {
          console.warn('[NewProject] failed to back-link source project:', e);
        }
      } else {
        linkedPackVersion = source.context_pack_version;
      }

      const proj: Project = {
        id,
        user_id: userId,
        title: `${source.title || '제목 없음'} - 복제본`,
        aspect_ratio: source.aspect_ratio || '16:9',
        style_template: source.style_template || 'Cute Stickman',
        status: ProjectStatus.DRAFT,
        created_at: now,
        updated_at: now,
        saved_step: 1,
        saved_max_step: 1,
        character_profile: source.character_profile,
        character_reference_image: source.character_reference_image,
        character_references: source.character_references,
        style_sheet: source.style_sheet,
        negative_prompt: source.negative_prompt,
        selected_image_model: source.selected_image_model,
        selected_video_model: source.selected_video_model,
        use_veo_audio: source.use_veo_audio,
        video_mode: source.video_mode,
        caption_style: source.caption_style,
        vision_critic_enabled: source.vision_critic_enabled,
        quality_threshold: source.quality_threshold,
        genre: source.genre,
        platform: source.platform,
        linked_context_pack_id: linkedPackId,
        context_pack_version: linkedPackVersion,
        context_pack_dirty: false,
      };
      await saveProjectToCloud(proj);
      onCreated(id);
    } catch (e: any) {
      alert(`프로젝트 생성에 실패했습니다: ${e?.message || e}`);
      setCreating(false);
    }
  };

  const createFromPack = async (pack: ContextPack) => {
    setCreating(true);
    try {
      const id = generateProjectId();
      const now = new Date().toISOString();
      const base: Project = {
        id,
        user_id: userId,
        title: `${pack.name} - 새 프로젝트`,
        aspect_ratio: pack.aspect_ratio || '16:9',
        style_template: pack.video_style || 'Cute Stickman',
        status: ProjectStatus.DRAFT,
        created_at: now,
        updated_at: now,
        saved_step: 1,
        saved_max_step: 1,
      };
      const merged: Project = { ...base, ...applyPackToProjectFields(pack, base) };
      await saveProjectToCloud(merged);
      onCreated(id);
    } catch (e: any) {
      alert(`프로젝트 생성에 실패했습니다: ${e?.message || e}`);
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] max-w-2xl w-full p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          disabled={creating}
          className="absolute top-5 right-5 p-2 hover:bg-gray-100 rounded-xl transition-colors disabled:opacity-50"
        >
          <Icons.X size={18} />
        </button>

        {step === 'choice' && (
          <>
            <h2 className="text-3xl font-black tracking-tight mb-2">새 비디오</h2>
            <p className="text-gray-500 font-medium mb-8">
              어떻게 시작하시겠어요?
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <button
                onClick={createIndependent}
                disabled={creating}
                className="text-left p-6 rounded-3xl border-2 border-gray-100 hover:border-brand-cyan hover:bg-brand-cyan/5 transition-all disabled:opacity-50"
              >
                <div className="w-12 h-12 rounded-2xl bg-brand-cyan/20 flex items-center justify-center mb-4">
                  <Icons.Plus size={20} className="text-brand-dark" />
                </div>
                <h3 className="font-black text-lg mb-1">독립 프로젝트</h3>
                <p className="text-xs text-gray-500 font-medium leading-relaxed">
                  빈 상태에서 시작합니다. 캐릭터, 스타일, 모델을 직접 설정합니다.
                </p>
              </button>

              <button
                onClick={() => setStep('pickPack')}
                disabled={creating || loading || packs.length === 0}
                className="text-left p-6 rounded-3xl border-2 border-gray-100 hover:border-brand-dark hover:bg-gray-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="w-12 h-12 rounded-2xl bg-brand-dark flex items-center justify-center mb-4">
                  <Icons.Layers size={20} className="text-brand-cyan" />
                </div>
                <h3 className="font-black text-lg mb-1">컨텍스트 팩에서 시작</h3>
                <p className="text-xs text-gray-500 font-medium leading-relaxed">
                  {loading
                    ? '팩 불러오는 중...'
                    : packs.length === 0
                      ? '저장된 컨텍스트 팩이 없습니다. 위저드에서 만든 후 다시 시도하세요.'
                      : `${packs.length}개의 팩 중 선택 — 캐릭터, 스타일, 모델 설정 자동 상속`}
                </p>
                {!loading && packSource === 'cache' && (
                  <p className="mt-2 text-[10px] font-black uppercase tracking-wider text-amber-600">
                    오프라인 캐시로 표시 중
                  </p>
                )}
              </button>

              <button
                onClick={() => setStep('pickProject')}
                disabled={creating}
                className="text-left p-6 rounded-3xl border-2 border-gray-100 hover:border-brand-cyan hover:bg-gray-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                  <Icons.Film size={20} className="text-brand-dark" />
                </div>
                <h3 className="font-black text-lg mb-1">기존 프로젝트 복제</h3>
                <p className="text-xs text-gray-500 font-medium leading-relaxed">
                  기존 프로젝트의 캐릭터·스타일·모델 설정만 복사합니다. 장면과
                  결과물은 복사하지 않습니다.
                </p>
              </button>
            </div>

            {creating && (
              <div className="mt-6 flex items-center justify-center gap-2 text-sm font-bold text-gray-500">
                <Icons.Loader2 size={16} className="animate-spin" /> 생성 중...
              </div>
            )}
          </>
        )}

        {step === 'pickPack' && (
          <>
            <button
              onClick={() => setStep('choice')}
              className="text-xs font-black text-gray-400 hover:text-black uppercase tracking-wider mb-4 flex items-center gap-1"
            >
              <Icons.ArrowLeft size={12} /> 뒤로
            </button>
            <h2 className="text-3xl font-black tracking-tight mb-2">
              컨텍스트 팩 선택
            </h2>
            <p className="text-gray-500 font-medium mb-6">
              새 프로젝트가 이 팩의 캐릭터·스타일·모델 설정을 상속합니다. 팩이
              나중에 변경되면 위저드에서 일괄 적용할 수 있습니다.
            </p>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {packs.map(p => (
                <div
                  key={p.id}
                  className="w-full p-4 rounded-2xl border border-gray-100 hover:border-brand-dark hover:bg-gray-50 transition-all"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-black text-sm text-brand-dark line-clamp-1">
                        {p.name}
                      </h3>
                      {p.description && (
                        <p className="text-xs text-gray-500 font-medium line-clamp-1 mt-0.5">
                          {p.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 text-[10px] font-black uppercase tracking-wider text-gray-400">
                        {p.aspect_ratio && <span>{p.aspect_ratio}</span>}
                        {p.video_style && <span>· {p.video_style}</span>}
                        {typeof p.linked_project_count === 'number' &&
                          p.linked_project_count > 0 && (
                            <span>· {p.linked_project_count}개 프로젝트 사용 중</span>
                          )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={async () => {
                          const next = window.prompt('새 팩 이름:', p.name);
                          if (!next || next.trim() === p.name) return;
                          try {
                            await savePack({
                              ...p,
                              name: next.trim(),
                              updated_at: new Date().toISOString(),
                            });
                            setPacks(prev =>
                              prev.map(x => (x.id === p.id ? { ...x, name: next.trim() } : x))
                            );
                          } catch (e: any) {
                            alert(`이름 변경 실패: ${e?.message || e}`);
                          }
                        }}
                        disabled={creating}
                        title="이름 변경"
                        className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 disabled:opacity-50"
                      >
                        <Icons.Edit3 size={14} />
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `'${p.name}' 팩을 삭제할까요? 이 팩을 사용 중인 프로젝트는 그대로 유지됩니다.`
                            )
                          )
                            return;
                          try {
                            await deletePack(userId, p.id);
                            setPacks(prev => prev.filter(x => x.id !== p.id));
                          } catch (e: any) {
                            alert(`삭제 실패: ${e?.message || e}`);
                          }
                        }}
                        disabled={creating}
                        title="삭제"
                        className="p-2 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50"
                      >
                        <Icons.Trash2 size={14} />
                      </button>
                      <button
                        onClick={() => createFromPack(p)}
                        disabled={creating}
                        className="ml-1 px-3 py-2 rounded-xl bg-brand-dark text-white text-[11px] font-black hover:brightness-110 disabled:opacity-50 flex items-center gap-1"
                      >
                        선택
                        <Icons.ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {creating && (
              <div className="mt-6 flex items-center justify-center gap-2 text-sm font-bold text-gray-500">
                <Icons.Loader2 size={16} className="animate-spin" /> 생성 중...
              </div>
            )}
          </>
        )}

        {step === 'pickProject' && (
          <>
            <button
              onClick={() => setStep('choice')}
              className="text-xs font-black text-gray-400 hover:text-black uppercase tracking-wider mb-4 flex items-center gap-1"
            >
              <Icons.ArrowLeft size={12} /> 뒤로
            </button>
            <h2 className="text-3xl font-black tracking-tight mb-2">
              복제할 프로젝트 선택
            </h2>
            <p className="text-gray-500 font-medium mb-6">
              선택한 프로젝트의 캐릭터·스타일·모델 설정만 새 프로젝트로
              복사합니다. 장면, 생성된 영상, 버전 정보는 복사되지 않습니다.
            </p>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {loadingProjects && (
                <div className="text-center py-8 text-sm font-bold text-gray-400">
                  <Icons.Loader2 size={18} className="animate-spin inline mr-2" />
                  프로젝트 불러오는 중...
                </div>
              )}
              {!loadingProjects && projects.length === 0 && (
                <div className="text-center py-8 text-sm font-bold text-gray-400">
                  복제할 수 있는 프로젝트가 없습니다.
                </div>
              )}
              {projects.map(p => (
                <button
                  key={p.id}
                  onClick={() => createFromProject(p)}
                  disabled={creating}
                  className="w-full text-left p-4 rounded-2xl border border-gray-100 hover:border-brand-dark hover:bg-gray-50 transition-all disabled:opacity-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-black text-sm text-brand-dark line-clamp-1">
                        {p.title || '제목 없음'}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 text-[10px] font-black uppercase tracking-wider text-gray-400">
                        {p.aspect_ratio && <span>{p.aspect_ratio}</span>}
                        {p.style_template && <span>· {p.style_template}</span>}
                        {p.character_profile && <span>· 캐릭터 ✓</span>}
                        {p.style_sheet && <span>· 스타일시트 ✓</span>}
                      </div>
                    </div>
                    <Icons.ChevronRight
                      size={16}
                      className="text-gray-300 flex-shrink-0"
                    />
                  </div>
                </button>
              ))}
            </div>
            {creating && (
              <div className="mt-6 flex items-center justify-center gap-2 text-sm font-bold text-gray-500">
                <Icons.Loader2 size={16} className="animate-spin" /> 생성 중...
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
