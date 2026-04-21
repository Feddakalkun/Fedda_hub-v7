import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, RefreshCw, Lock, Unlock, ArrowRight, CheckCircle2 } from 'lucide-react';
import { BACKEND_API } from '../../config/api';
import { comfyService } from '../../services/comfyService';
import { useToast } from '../../components/ui/Toast';
import { usePersistentState } from '../../hooks/usePersistentState';

type StepId = 'setup' | 'prompt' | 'base' | 'select' | 'detail' | 'review';

type DualBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type TraitSet = {
  archetype: string;
  hair: string;
  outfit: string;
  expression: string;
  pose: string;
};

type StageStatus = {
  success: boolean;
  status?: 'pending' | 'running' | 'completed' | 'not_found';
  error?: string;
  images?: Array<{ filename: string; subfolder: string; type: string }>;
  videos?: Array<{ filename: string; subfolder: string; type: string }>;
  audios?: Array<{ filename: string; subfolder: string; type: string }>;
  detected_boxes?: number[][];
  raw_outputs?: Record<string, unknown>;
};

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'setup', label: 'Setup' },
  { id: 'prompt', label: 'Prompt Builder' },
  { id: 'base', label: 'Generate Base' },
  { id: 'select', label: 'Select Person' },
  { id: 'detail', label: 'Continue Detail' },
  { id: 'review', label: 'Review' },
];

const DETECTION_PRESETS = ['right woman', 'left woman', 'person on right', 'person on left'];

const ARCHETYPES = ['fashion model', 'streetwear creator', 'cinematic actress', 'fitness influencer', 'editorial muse'];
const HAIR = ['long blonde hair', 'black bob haircut', 'curly red hair', 'silver ponytail', 'brown wavy hair'];
const OUTFITS = ['minimal white top', 'luxury blazer look', 'sporty crop jacket', 'elegant black dress', 'casual denim outfit'];
const EXPRESSIONS = ['soft smile', 'confident look', 'serious gaze', 'playful expression', 'calm neutral face'];
const POSES = ['standing relaxed', 'hands on hips', 'three-quarter pose', 'walking pose', 'editorial pose'];
const SCENES = ['studio portrait lighting', 'city street at golden hour', 'luxury loft interior', 'fashion runway backstage', 'modern apartment window light'];
const STYLES = ['high detail, photorealistic', 'cinematic grade, sharp focus', 'clean skin texture, natural light', 'editorial photography quality'];

const randomFrom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)] || '';
const randomSeed = () => Math.floor(Math.random() * 9_000_000_000_000) + 1;

function extractBoxesFromUnknown(value: unknown): DualBox[] {
  const boxes: DualBox[] = [];
  const seen = new Set<string>();

  const add = (x1: number, y1: number, x2: number, y2: number) => {
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return;
    if (x2 <= x1 || y2 <= y1) return;
    const key = `${x1.toFixed(2)}:${y1.toFixed(2)}:${x2.toFixed(2)}:${y2.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    boxes.push({ x1, y1, x2, y2 });
  };

  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      if (v.length >= 4) {
        const a = Number(v[0]);
        const b = Number(v[1]);
        const c = Number(v[2]);
        const d = Number(v[3]);
        if ([a, b, c, d].every(Number.isFinite)) add(a, b, c, d);
      }
      v.forEach(walk);
      return;
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if (['x1', 'y1', 'x2', 'y2'].every((k) => typeof obj[k] !== 'undefined')) {
        add(Number(obj.x1), Number(obj.y1), Number(obj.x2), Number(obj.y2));
      }
      if (['left', 'top', 'right', 'bottom'].every((k) => typeof obj[k] !== 'undefined')) {
        add(Number(obj.left), Number(obj.top), Number(obj.right), Number(obj.bottom));
      }
      Object.values(obj).forEach(walk);
    }
  };

  walk(value);
  return boxes;
}

async function pollPrompt(promptId: string, timeoutMs = 300000): Promise<StageStatus> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE_STATUS}/${promptId}`);
    const data = (await res.json()) as StageStatus;

    if (!data.success) {
      throw new Error(data.error || 'Status request failed');
    }
    if (data.status === 'completed') return data;
    if (data.status === 'not_found') {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error('Timed out while waiting for generation status');
}

export const ZImageDualLoraPage = () => {
  const { toast } = useToast();

  const [currentStep, setCurrentStep] = usePersistentState<StepId>('zimage_dual_step', 'setup');
  const [unetName, setUnetName] = usePersistentState('zimage_dual_unet', 'z_image_turbo_bf16.safetensors');
  const [clipName, setClipName] = usePersistentState('zimage_dual_clip', 'qwen_3_4b.safetensors');
  const [vaeName, setVaeName] = usePersistentState('zimage_dual_vae', 'z-image-vae.safetensors');

  const [loraMainName, setLoraMainName] = usePersistentState('zimage_dual_lora_main_name', '');
  const [loraMainStrength, setLoraMainStrength] = usePersistentState('zimage_dual_lora_main_strength', 1);
  const [loraDetailName, setLoraDetailName] = usePersistentState('zimage_dual_lora_detail_name', '');
  const [loraDetailStrength, setLoraDetailStrength] = usePersistentState('zimage_dual_lora_detail_strength', 1);

  const [scene, setScene] = usePersistentState('zimage_dual_scene', SCENES[0]);
  const [style, setStyle] = usePersistentState('zimage_dual_style', STYLES[0]);

  const [traitA, setTraitA] = usePersistentState<TraitSet>('zimage_dual_trait_a', {
    archetype: ARCHETYPES[0], hair: HAIR[0], outfit: OUTFITS[0], expression: EXPRESSIONS[0], pose: POSES[0],
  });
  const [traitB, setTraitB] = usePersistentState<TraitSet>('zimage_dual_trait_b', {
    archetype: ARCHETYPES[1], hair: HAIR[1], outfit: OUTFITS[1], expression: EXPRESSIONS[1], pose: POSES[1],
  });

  const [mainPrompt, setMainPrompt] = usePersistentState('zimage_dual_main_prompt', '');
  const [detailPrompt, setDetailPrompt] = usePersistentState('zimage_dual_detail_prompt', '');
  const [negativePrompt, setNegativePrompt] = usePersistentState('zimage_dual_negative_prompt', 'blurry, low quality, bad anatomy, deformed');
  const [detectionPhrase, setDetectionPhrase] = usePersistentState('zimage_dual_detection_phrase', 'right woman');

  const [lockedSeed, setLockedSeed] = usePersistentState<number>('zimage_dual_locked_seed', randomSeed());
  const [seedLocked, setSeedLocked] = usePersistentState<boolean>('zimage_dual_seed_locked', false);

  const [baseImageUrl, setBaseImageUrl] = usePersistentState<string | null>('zimage_dual_base_image', null);
  const [finalImageUrl, setFinalImageUrl] = usePersistentState<string | null>('zimage_dual_final_image', null);
  const [beforeImageUrl, setBeforeImageUrl] = usePersistentState<string | null>('zimage_dual_before_image', null);

  const [detectedBoxes, setDetectedBoxes] = usePersistentState<DualBox[]>('zimage_dual_boxes', []);
  const [selectedBoxIndex, setSelectedBoxIndex] = usePersistentState<number>('zimage_dual_selected_box', -1);

  const [runningBase, setRunningBase] = useState(false);
  const [runningDetail, setRunningDetail] = useState(false);
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 1, h: 1 });

  useEffect(() => {
    comfyService.getLoras().then((all) => {
      const filtered = all.filter((l) => {
        const n = l.replace(/\\/g, '/').toLowerCase();
        return n.startsWith('zimage_turbo/') || n.startsWith('zimage-turbo/');
      });
      setAvailableLoras(filtered);
    }).catch(() => {
      setAvailableLoras([]);
    });
  }, []);

  const canRunBase = useMemo(() => {
    return !!loraMainName && !!loraDetailName && loraMainStrength > 0 && loraDetailStrength > 0;
  }, [loraMainName, loraDetailName, loraMainStrength, loraDetailStrength]);

  const composePrompts = () => {
    const pA = `left person: ${traitA.archetype}, ${traitA.hair}, ${traitA.outfit}, ${traitA.expression}, ${traitA.pose}`;
    const pB = `right person: ${traitB.archetype}, ${traitB.hair}, ${traitB.outfit}, ${traitB.expression}, ${traitB.pose}`;
    const base = `two people side by side, ${pA}, ${pB}, ${scene}, ${style}, ultra realistic, detailed skin, coherent faces`;
    const detail = `high detail face and skin refinement on selected person, preserve identity, ${traitB.archetype}, ${traitB.hair}, ${traitB.expression}, natural texture, no plastic skin`;
    setMainPrompt(base);
    setDetailPrompt(detail);
    return { base, detail };
  };

  const randomizeTraits = () => {
    setTraitA({
      archetype: randomFrom(ARCHETYPES),
      hair: randomFrom(HAIR),
      outfit: randomFrom(OUTFITS),
      expression: randomFrom(EXPRESSIONS),
      pose: randomFrom(POSES),
    });
    setTraitB({
      archetype: randomFrom(ARCHETYPES),
      hair: randomFrom(HAIR),
      outfit: randomFrom(OUTFITS),
      expression: randomFrom(EXPRESSIONS),
      pose: randomFrom(POSES),
    });
    setScene(randomFrom(SCENES));
    setStyle(randomFrom(STYLES));
  };

  const runBaseStage = async () => {
    if (!canRunBase) {
      toast('Select both LoRAs and valid strengths first.', 'error');
      return;
    }

    if (!mainPrompt.trim() || !detailPrompt.trim()) {
      composePrompts();
    }

    const seed = seedLocked ? lockedSeed : randomSeed();
    setLockedSeed(seed);
    setSeedLocked(true);
    setSelectedBoxIndex(-1);
    setDetectedBoxes([]);

    setRunningBase(true);
    try {
      const payload = {
        workflow_id: 'z-image-dual-base',
        params: {
          main_prompt: mainPrompt.trim() || composePrompts().base,
          detail_prompt: detailPrompt.trim() || composePrompts().detail,
          negative: negativePrompt,
          detection_phrase: detectionPhrase,
          seed,
          selected_box_index: 0,
          lora_main_name: loraMainName,
          lora_main_strength: Number(loraMainStrength),
          lora_detail_name: loraDetailName,
          lora_detail_strength: Number(loraDetailStrength),
          unet_name: unetName,
          clip_name: clipName,
          vae_name: vaeName,
          client_id: (comfyService as any).clientId,
        },
      };

      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Failed to start base stage');

      const done = await pollPrompt(data.prompt_id);
      const imgs = done.images || [];
      if (!imgs.length) throw new Error('No base image returned from stage 1');

      const mainBefore = imgs.find((img) => String(img.filename).toLowerCase().includes('main_before_detail')) || imgs[imgs.length - 1];
      const url = comfyService.getImageUrl(mainBefore);
      setBaseImageUrl(url);
      setBeforeImageUrl(url);

      const directBoxes = (done.detected_boxes || []).map((b) => ({ x1: Number(b[0]), y1: Number(b[1]), x2: Number(b[2]), y2: Number(b[3]) }));
      const rawBoxes = extractBoxesFromUnknown(done.raw_outputs || {});
      const allBoxes = [...directBoxes, ...rawBoxes].filter((b) => [b.x1, b.y1, b.x2, b.y2].every(Number.isFinite));
      setDetectedBoxes(allBoxes);

      setCurrentStep('select');
      if (allBoxes.length === 0) {
        toast('No boxes found. Try another detection phrase or regenerate base.', 'info');
      } else {
        toast(`Found ${allBoxes.length} candidate box(es). Pick one to continue.`, 'success');
      }
    } catch (err: any) {
      toast(err.message || 'Base stage failed', 'error');
    } finally {
      setRunningBase(false);
    }
  };

  const runDetailStage = async () => {
    if (selectedBoxIndex < 0) {
      toast('Select a person bbox first.', 'error');
      return;
    }
    setRunningDetail(true);
    try {
      const seed = seedLocked ? lockedSeed : randomSeed();
      if (!seedLocked) {
        setLockedSeed(seed);
        setSeedLocked(true);
      }

      const payload = {
        workflow_id: 'z-image-dual-detail',
        params: {
          main_prompt: mainPrompt,
          detail_prompt: detailPrompt,
          negative: negativePrompt,
          detection_phrase: detectionPhrase,
          seed,
          selected_box_index: selectedBoxIndex,
          lora_main_name: loraMainName,
          lora_main_strength: Number(loraMainStrength),
          lora_detail_name: loraDetailName,
          lora_detail_strength: Number(loraDetailStrength),
          unet_name: unetName,
          clip_name: clipName,
          vae_name: vaeName,
          client_id: (comfyService as any).clientId,
        },
      };

      const res = await fetch(`${BACKEND_API.BASE_URL}${BACKEND_API.ENDPOINTS.GENERATE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.detail || 'Failed to start detail stage');

      const done = await pollPrompt(data.prompt_id);
      const imgs = done.images || [];
      if (!imgs.length) throw new Error('No final image returned from stage 2');

      const finalImg = imgs.find((img) => String(img.filename).toLowerCase().includes('final_refined')) || imgs[imgs.length - 1];
      const finalUrl = comfyService.getImageUrl(finalImg);
      setFinalImageUrl(finalUrl);
      setCurrentStep('review');
      toast('Dual LoRA detail pass complete.', 'success');
    } catch (err: any) {
      toast(err.message || 'Detail stage failed', 'error');
    } finally {
      setRunningDetail(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="h-full overflow-y-auto bg-[#07070b] text-white custom-scrollbar">
      <div className="max-w-[1180px] mx-auto px-5 py-5 space-y-5">
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-cyan-200 text-xs uppercase tracking-[0.2em] font-black">
                <Sparkles className="w-3.5 h-3.5" />
                Z-Image Dual LoRA Studio
              </div>
              <p className="text-xs text-white/65 mt-1">2-step flow: generate base + detect, click person, continue detail pass with locked seed.</p>
            </div>
            <button
              onClick={() => setSeedLocked((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1 ${seedLocked ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' : 'border-amber-400/40 bg-amber-500/10 text-amber-200'}`}
            >
              {seedLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              {seedLocked ? `Seed Locked (${lockedSeed})` : 'Unlock Seed'}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-6 gap-2">
            {STEPS.map((step, idx) => (
              <button
                key={step.id}
                onClick={() => setCurrentStep(step.id)}
                className={`text-left px-2.5 py-2 rounded-lg border text-[11px] ${idx === stepIndex ? 'border-cyan-300/50 bg-cyan-500/20 text-cyan-100' : idx < stepIndex ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : 'border-white/10 bg-white/[0.02] text-white/60'}`}
              >
                {step.label}
              </button>
            ))}
          </div>
        </div>

        {(currentStep === 'setup' || currentStep === 'prompt') && (
          <div className="rounded-2xl border border-white/10 bg-[#0c0f17] p-4 space-y-4">
            <h3 className="text-sm font-semibold">1) Setup</h3>
            <div className="grid md:grid-cols-3 gap-3">
              <label className="text-xs text-white/70">UNET
                <input value={unetName} onChange={(e) => setUnetName(e.target.value)} className="mt-1 w-full rounded-lg bg-[#0a0e16] border border-white/10 px-3 py-2 text-xs" />
              </label>
              <label className="text-xs text-white/70">CLIP
                <input value={clipName} onChange={(e) => setClipName(e.target.value)} className="mt-1 w-full rounded-lg bg-[#0a0e16] border border-white/10 px-3 py-2 text-xs" />
              </label>
              <label className="text-xs text-white/70">VAE
                <input value={vaeName} onChange={(e) => setVaeName(e.target.value)} className="mt-1 w-full rounded-lg bg-[#0a0e16] border border-white/10 px-3 py-2 text-xs" />
              </label>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 p-3 bg-black/20">
                <div className="text-xs text-white/70 mb-1">LoRA Slot 1 (Main)</div>
                <select value={loraMainName} onChange={(e) => setLoraMainName(e.target.value)} className="w-full rounded-lg bg-[#0a0e16] border border-white/10 px-3 py-2 text-xs">
                  <option value="">Select main LoRA</option>
                  {availableLoras.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <label className="block text-[11px] text-white/60 mt-2">Strength: {Number(loraMainStrength).toFixed(2)}</label>
                <input type="range" min={0.1} max={2} step={0.01} value={loraMainStrength} onChange={(e) => setLoraMainStrength(Number(e.target.value))} className="w-full" />
              </div>

              <div className="rounded-xl border border-white/10 p-3 bg-black/20">
                <div className="text-xs text-white/70 mb-1">LoRA Slot 2 (Detail/Inpaint)</div>
                <select value={loraDetailName} onChange={(e) => setLoraDetailName(e.target.value)} className="w-full rounded-lg bg-[#0a0e16] border border-white/10 px-3 py-2 text-xs">
                  <option value="">Select detail LoRA</option>
                  {availableLoras.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <label className="block text-[11px] text-white/60 mt-2">Strength: {Number(loraDetailStrength).toFixed(2)}</label>
                <input type="range" min={0.1} max={2} step={0.01} value={loraDetailStrength} onChange={(e) => setLoraDetailStrength(Number(e.target.value))} className="w-full" />
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={() => setCurrentStep('prompt')} className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold inline-flex items-center gap-1">
                Next: Prompt Builder <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {(currentStep === 'prompt' || currentStep === 'base') && (
          <div className="rounded-2xl border border-white/10 bg-[#0c0f17] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">2) Prompt Builder</h3>
              <button onClick={() => { randomizeTraits(); }} className="px-2.5 py-1.5 rounded-lg border border-white/15 bg-white/5 text-xs inline-flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Randomize Pair
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              {[{ title: 'Person A (Left)', value: traitA, setValue: setTraitA }, { title: 'Person B (Right)', value: traitB, setValue: setTraitB }].map((card) => (
                <div key={card.title} className="rounded-xl border border-white/10 p-3 bg-black/20 grid grid-cols-2 gap-2">
                  <div className="col-span-2 text-xs font-semibold text-white/85">{card.title}</div>
                  <input value={card.value.archetype} onChange={(e) => card.setValue({ ...card.value, archetype: e.target.value })} placeholder="archetype" className="rounded-lg bg-[#0a0e16] border border-white/10 px-2 py-1.5 text-xs" />
                  <input value={card.value.hair} onChange={(e) => card.setValue({ ...card.value, hair: e.target.value })} placeholder="hair" className="rounded-lg bg-[#0a0e16] border border-white/10 px-2 py-1.5 text-xs" />
                  <input value={card.value.outfit} onChange={(e) => card.setValue({ ...card.value, outfit: e.target.value })} placeholder="outfit" className="rounded-lg bg-[#0a0e16] border border-white/10 px-2 py-1.5 text-xs" />
                  <input value={card.value.expression} onChange={(e) => card.setValue({ ...card.value, expression: e.target.value })} placeholder="expression" className="rounded-lg bg-[#0a0e16] border border-white/10 px-2 py-1.5 text-xs" />
                  <input value={card.value.pose} onChange={(e) => card.setValue({ ...card.value, pose: e.target.value })} placeholder="pose" className="rounded-lg bg-[#0a0e16] border border-white/10 px-2 py-1.5 text-xs col-span-2" />
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <input value={scene} onChange={(e) => setScene(e.target.value)} placeholder="Scene" className="rounded-lg bg-[#0a0e16] border border-white/10 px-3 py-2 text-xs" />
              <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Style" className="rounded-lg bg-[#0a0e16] border border-white/10 px-3 py-2 text-xs" />
            </div>

            <div className="flex gap-2 flex-wrap">
              <button onClick={() => composePrompts()} className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs">Auto Build Prompts</button>
              {DETECTION_PRESETS.map((preset) => (
                <button key={preset} onClick={() => setDetectionPhrase(preset)} className={`px-2 py-1 rounded border text-[11px] ${detectionPhrase === preset ? 'border-cyan-300/60 text-cyan-100 bg-cyan-500/20' : 'border-white/15 text-white/70 bg-white/5'}`}>
                  {preset}
                </button>
              ))}
            </div>

            <label className="block text-xs text-white/70">Main Prompt
              <textarea value={mainPrompt} onChange={(e) => setMainPrompt(e.target.value)} rows={3} className="mt-1 w-full rounded-lg bg-[#0a0e16] border border-white/10 px-3 py-2 text-xs" />
            </label>
            <label className="block text-xs text-white/70">Detail Prompt
              <textarea value={detailPrompt} onChange={(e) => setDetailPrompt(e.target.value)} rows={3} className="mt-1 w-full rounded-lg bg-[#0a0e16] border border-white/10 px-3 py-2 text-xs" />
            </label>
            <label className="block text-xs text-white/70">Negative Prompt (optional)
              <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} rows={2} className="mt-1 w-full rounded-lg bg-[#0a0e16] border border-white/10 px-3 py-2 text-xs" />
            </label>

            <div className="flex justify-end">
              <button
                onClick={runBaseStage}
                disabled={!canRunBase || runningBase}
                className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold"
              >
                {runningBase ? 'Generating Base...' : 'Generate Base + Detect'}
              </button>
            </div>
          </div>
        )}

        {(currentStep === 'select' || currentStep === 'detail' || currentStep === 'review') && (
          <div className="rounded-2xl border border-white/10 bg-[#0c0f17] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">3) Select Person</h3>
              <div className="text-xs text-white/60">Detection phrase: <span className="text-cyan-200">{detectionPhrase}</span></div>
            </div>

            {baseImageUrl ? (
              <div className="rounded-xl border border-white/10 p-3 bg-black/30">
                <div className="relative inline-block max-w-full">
                  <img
                    ref={imageRef}
                    src={baseImageUrl}
                    alt="Base"
                    className="max-h-[520px] rounded-lg border border-white/10"
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setNaturalSize({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
                    }}
                  />
                  {detectedBoxes.map((box, idx) => {
                    const left = `${(box.x1 / naturalSize.w) * 100}%`;
                    const top = `${(box.y1 / naturalSize.h) * 100}%`;
                    const width = `${((box.x2 - box.x1) / naturalSize.w) * 100}%`;
                    const height = `${((box.y2 - box.y1) / naturalSize.h) * 100}%`;
                    const active = idx === selectedBoxIndex;
                    return (
                      <button
                        key={`${idx}-${box.x1}-${box.y1}`}
                        onClick={() => setSelectedBoxIndex(idx)}
                        className={`absolute border-2 rounded-sm ${active ? 'border-emerald-400 bg-emerald-400/15' : 'border-cyan-300 bg-cyan-300/10 hover:bg-cyan-200/20'}`}
                        style={{ left, top, width, height }}
                        title={`BBox ${idx + 1}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-2 text-xs text-white/70">Detected boxes: {detectedBoxes.length} {selectedBoxIndex >= 0 ? `| Selected: #${selectedBoxIndex + 1}` : ''}</div>
              </div>
            ) : (
              <div className="text-xs text-white/50">Generate base stage first.</div>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={runBaseStage} disabled={runningBase} className="px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 text-xs disabled:opacity-50">
                {runningBase ? 'Running...' : 'Regenerate Base'}
              </button>
              {DETECTION_PRESETS.map((preset) => (
                <button key={preset} onClick={() => setDetectionPhrase(preset)} className="px-2 py-1 rounded border border-white/15 bg-white/5 text-[11px] text-white/75">
                  {preset}
                </button>
              ))}
              <button
                onClick={runDetailStage}
                disabled={selectedBoxIndex < 0 || runningDetail}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold"
              >
                {runningDetail ? 'Continuing...' : 'Continue Detail Pass'}
              </button>
            </div>
          </div>
        )}

        {currentStep === 'review' && (
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-emerald-200 text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              4) Review & Export
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 p-2 bg-black/30">
                <div className="text-xs text-white/60 mb-1">Before Detail</div>
                {beforeImageUrl ? <img src={beforeImageUrl} alt="Before" className="rounded-lg border border-white/10" /> : <div className="text-xs text-white/40">No image</div>}
              </div>
              <div className="rounded-xl border border-white/10 p-2 bg-black/30">
                <div className="text-xs text-white/60 mb-1">Final Refined</div>
                {finalImageUrl ? <img src={finalImageUrl} alt="Final" className="rounded-lg border border-white/10" /> : <div className="text-xs text-white/40">No image</div>}
              </div>
            </div>
            <div className="flex gap-2">
              {finalImageUrl && (
                <>
                  <a href={finalImageUrl} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 text-xs">Open Full</a>
                  <a href={finalImageUrl} download className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold">Download</a>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
