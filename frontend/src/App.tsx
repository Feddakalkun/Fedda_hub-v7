import { useState, useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { LandingPage } from './pages/LandingPage';
import { TopSystemStrip } from './components/ui/TopSystemStrip';
import { ToastProvider } from './components/ui/Toast';
import { ComfyExecutionProvider } from './contexts/ComfyExecutionContext';
import { TopQuickLinks } from './components/layout/TopQuickLinks';
import { GlobalMediaHub } from './components/layout/GlobalMediaHub';
import { PAGE_META, VALID_TABS } from './config/navigation';

// ─── Persistence ───────────────────────────────────────────────────────────
const TAB_KEY = 'fedda_active_tab_v2';

function readActiveTab(): string {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    if (raw && VALID_TABS.has(raw)) return raw;
  } catch {}
  return 'chat';
}

import { ImageStudioPage } from './pages/ImageStudioPage';
import { VideoStudioPage } from './pages/VideoStudioPage';
import { LibraryPage } from './pages/LibraryPage';
import { AgentChatPage } from './pages/AgentChatPage';

// ─── App ───────────────────────────────────────────────────────────────────
function FeddaApp() {
  // Show landing only on fresh page load (not when deep-linking via hash)
  const [showLanding, setShowLanding] = useState(true);
  const [activeTab, setActiveTab] = useState<string>(readActiveTab);

  // Persist tab selection across sessions
  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, activeTab); } catch {}
  }, [activeTab]);

  const handleTabChange = (tab: string) => {
    if (!VALID_TABS.has(tab)) return;
    setActiveTab(tab);
  };

  const meta = PAGE_META[activeTab] ?? PAGE_META['chat'];

  // Route determining component
  const renderPage = () => {
    switch (activeTab) {
      case 'chat':
        return <AgentChatPage />;
      case 'image':
      case 'z-image':
      case 'z-image-txt2img':
      case 'flux':
      case 'flux-txt2img':
      case 'qwen':
      case 'qwen-txt2img':
      case 'qwen-image-ref':
      case 'qwen-multi-angle':
      case 'image-other':
      case 'image-influencer':
        return <ImageStudioPage activeTab={activeTab} />;
      case 'video':
      case 'wan22-vid2vid':
      case 'wan22-img2vid':
      case 'wan22-img2vid-6frames':
      case 'ltx':
      case 'ltx-flf':
      case 'ltx-img-audio':
        return <VideoStudioPage activeTab={activeTab} />;
      case 'library':
        return <LibraryPage />;
      default:
        return (
          <PlaceholderPage
            label={meta.label}
            description={meta.description}
            icon={<meta.Icon className="w-8 h-8" />}
          />
        );
    }
  };

  return (
    <div className="flex h-screen theme-bg-app text-white overflow-hidden font-sans selection:bg-white/20">
      {/* Intro landing screen — fixed overlay until ComfyUI is ready */}
      {showLanding && <LandingPage onEnter={() => setShowLanding(false)} />}

      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="flex-1 flex flex-col overflow-hidden theme-bg-main">
        {/* Top header */}
        <header className="h-14 border-b border-white/5 flex items-center px-6 shrink-0 z-10 justify-between backdrop-blur-sm bg-black/20">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex items-center gap-3">
              <meta.Icon className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-white tracking-tight whitespace-nowrap">{meta.label}</h2>
            </div>
            <TopQuickLinks activeTab={activeTab} onTabChange={handleTabChange} />
            <GlobalMediaHub onNavigate={handleTabChange} />
          </div>

          {/* Right side: system monitor */}
          <TopSystemStrip />
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-hidden">
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ComfyExecutionProvider>
      <ToastProvider>
        <FeddaApp />
      </ToastProvider>
    </ComfyExecutionProvider>
  );
}
