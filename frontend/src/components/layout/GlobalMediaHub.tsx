import { useEffect, useMemo, useState } from 'react';
import { Clapperboard, Images, RefreshCw, X } from 'lucide-react';

type MediaKind = 'image' | 'video';

interface MediaItem {
  url: string;
  source: string;
  kind: MediaKind;
}

const MAX_ITEMS = 80;

const parseStringArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === 'string' && v.trim().length > 0);
  } catch {
    return [];
  }
};

const sourceIsVideo = (source: string, url: string): boolean => {
  const s = source.toLowerCase();
  const u = url.toLowerCase();
  return (
    s.includes('video') ||
    s.includes('vid') ||
    s.includes('wan') ||
    s.includes('ltx') ||
    u.includes('.mp4') ||
    u.includes('.webm') ||
    u.includes('.mov')
  );
};

const loadAllMedia = (): MediaItem[] => {
  const keys = Object.keys(localStorage).filter(
    (key) => key.startsWith('gallery_') || key.endsWith('_history'),
  );
  const seen = new Set<string>();
  const merged: MediaItem[] = [];

  keys.forEach((key) => {
    const source = key
      .replace(/^gallery_/, '')
      .replace(/_history$/, '');
    const urls = parseStringArray(localStorage.getItem(key));
    urls.forEach((url) => {
      if (seen.has(url)) return;
      seen.add(url);
      merged.push({
        url,
        source,
        kind: sourceIsVideo(source, url) ? 'video' : 'image',
      });
    });
  });

  return merged.slice(0, MAX_ITEMS);
};

interface GlobalMediaHubProps {
  onNavigate: (tab: string) => void;
}

export const GlobalMediaHub = ({ onNavigate }: GlobalMediaHubProps) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [filter, setFilter] = useState<MediaKind | 'all'>('all');

  const refresh = () => setItems(loadAllMedia());

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 3000);
    const onFocus = () => refresh();
    const onStorage = () => refresh();
    const onGallery = () => refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    window.addEventListener('fedda:gallery-updated', onGallery as EventListener);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('fedda:gallery-updated', onGallery as EventListener);
    };
  }, []);

  const filteredItems = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  );

  const imageCount = useMemo(() => items.filter((i) => i.kind === 'image').length, [items]);
  const videoCount = useMemo(() => items.filter((i) => i.kind === 'video').length, [items]);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`h-8 inline-flex items-center gap-1.5 px-3 text-xs font-medium transition-colors ${
          open
            ? 'fedda-btn-soft-cyan'
            : 'fedda-btn-ghost'
        }`}
      >
        <Images className="w-3.5 h-3.5" />
        Media Hub
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button className="flex-1 bg-black/55 backdrop-blur-[1px]" onClick={() => setOpen(false)} aria-label="Close media hub" />
          <aside className="w-full max-w-[520px] h-full border-l border-white/10 bg-[#0a0a10] flex flex-col shadow-2xl">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Global Media Hub</h3>
                <p className="text-[11px] text-slate-400">Recent outputs across workflows</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={refresh}
                  className="p-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
                  title="Refresh"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
                  title="Close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {(['all', 'image', 'video'] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] ${
                      filter === value
                        ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200'
                        : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {value === 'all' ? 'All' : value === 'image' ? 'Images' : 'Videos'}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-500">
                {imageCount} img • {videoCount} vid
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
              {filteredItems.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-slate-500 text-sm">
                  No media found yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredItems.map((item, idx) => (
                    <div key={`${item.url}-${idx}`} className="rounded-xl border border-white/10 bg-black/30 overflow-hidden">
                      <div className="aspect-video bg-black">
                        {item.kind === 'video' ? (
                          <video src={item.url} className="h-full w-full object-cover" muted playsInline />
                        ) : (
                          <img src={item.url} alt={`media-${idx}`} className="h-full w-full object-cover" loading="lazy" />
                        )}
                      </div>
                      <div className="p-2 space-y-2">
                        <div className="text-[10px] text-slate-500 truncate">{item.source}</div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
                            className="flex-1 px-2 py-1 rounded-lg border border-white/10 text-[11px] text-slate-200 hover:bg-white/5"
                          >
                            Open
                          </button>
                          <button
                            onClick={() => {
                              onNavigate(item.kind === 'video' ? 'videos' : 'gallery');
                              setOpen(false);
                            }}
                            className="px-2 py-1 rounded-lg border border-cyan-400/30 text-[11px] text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/20 inline-flex items-center gap-1"
                          >
                            {item.kind === 'video' ? <Clapperboard className="w-3 h-3" /> : <Images className="w-3 h-3" />}
                            Go
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
};
