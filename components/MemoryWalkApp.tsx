import React, { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Play, Pause, Sparkles, MapPin, CalendarDays, Heart, Star,
  Image as ImageIcon, SlidersHorizontal, ChevronLeft, Maximize2, Minimize2, Orbit, Layers, X
} from "lucide-react";
import ChildTimelinePlugin from '../main';
import { TimelineEntry } from '../settings';
import Galaxy3D, { GalaxyPhoto, GalaxyShape } from './Galaxy3D';
import { CarouselMode } from './CarouselMode';
import { App, Component, MarkdownRenderer } from 'obsidian';

/* ─── Markdown Preview Component ─── */
function MarkdownPreview({ content, sourcePath, app }: { content: string, sourcePath: string, app: App }) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const component = new Component();
    component.load();
    container.empty();
    void MarkdownRenderer.render(app, content, container, sourcePath, component);

    return () => {
      component.unload();
      container.empty();
    };
  }, [app, content, sourcePath]);

  return <div ref={containerRef} className="markdown-rendered text-sm leading-relaxed text-white/80" />;
}

/* ─── Primitive UI ─── */

function Button({ variant, onClick, className = "", children }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm transition-colors rounded-2xl flex items-center justify-center cursor-pointer text-white hover:bg-white/10 hover:text-white ${
        variant === 'ghost' ? 'bg-transparent' : 'bg-white/10'
      } ${className}`}
    >
      {children}
    </button>
  );
}

function GlassPanel({ children, className = "" }: any) {
  return (
    <div
      className={`rounded-3xl border border-white/10 bg-white/[0.065] shadow-2xl shadow-black/30 backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── PhotoTile (Gallery Mode) ─── */

function PhotoTile({ photo, index, selected, onClick }: any) {
  const positions = [
    "left-[9%] top-[18%] rotate-[-7deg]",
    "left-[32%] top-[12%] rotate-[4deg]",
    "left-[60%] top-[17%] rotate-[-3deg]",
    "left-[20%] top-[58%] rotate-[5deg]",
    "left-[53%] top-[57%] rotate-[-5deg]",
  ];

  const gradients = [
    "from-slate-600 via-sky-500 to-indigo-800",
    "from-orange-300 via-rose-400 to-purple-700",
    "from-zinc-800 via-violet-700 to-fuchsia-500",
    "from-emerald-900 via-green-500 to-lime-300",
    "from-cyan-700 via-blue-400 to-amber-200",
  ];

  const posClass = positions[index % positions.length];
  const gradient = gradients[index % gradients.length];

  return (
    <motion.button
      layout
      onClick={() => onClick(photo)}
      initial={{ opacity: 0, y: 40, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: selected ? 1.08 : 1 }}
      transition={{ delay: index * 0.08, type: "spring", stiffness: 90 }}
      whileHover={{ y: -14, scale: 1.06 }}
      className={`absolute ${posClass} group h-36 w-52 overflow-hidden rounded-3xl border text-left shadow-2xl shadow-black/40 transition-all duration-300 cursor-pointer ${
        selected ? "border-white/70" : "border-white/15"
      }`}
    >
      {/* Background: real image or gradient fallback */}
      {photo.imageUrl ? (
        <img src={photo.imageUrl} alt={photo.title} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,.45),transparent_32%),linear-gradient(to_top,rgba(0,0,0,.72),transparent_58%)]" />
      <div className="absolute left-4 top-4 rounded-full bg-black/35 px-3 py-1 text-xs text-white/90 backdrop-blur-md">
        {photo.date?.slice(5) || ''}
      </div>
      {photo.favorite && (
        <Heart className="absolute right-4 top-4 h-4 w-4 fill-white text-white" />
      )}
      <div className="absolute bottom-4 left-4 right-4">
        <div className="text-sm font-semibold text-white truncate">{photo.title}</div>
        <div className="mt-1 flex items-center gap-1 text-xs text-white/75">
          <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{photo.location}</span>
        </div>
      </div>
      <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="absolute bottom-0 left-0 right-0 bg-black/55 p-4 backdrop-blur-md">
          <div className="flex flex-wrap gap-1">
            {(photo.tags || []).map((tag: string) => (
              <span key={tag} className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] text-white/90">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </motion.button>
  );
}

/* ─── StarCluster (Galaxy Mode) ─── */

function StarCluster({ event, active, onClick }: any) {
  const dots = Array.from({ length: Math.min(12, Math.round(event.count / 10)) });

  return (
    <motion.button
      onClick={() => onClick(event)}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: active ? 1.16 : 1 }}
      whileHover={{ scale: 1.2 }}
      drag
      dragMomentum={false}
      className="absolute text-left cursor-grab active:cursor-grabbing"
      style={{ left: `${event.x}%`, top: `${event.y}%`, background: 'none', border: 'none', padding: 0, boxShadow: 'none' }}
    >
      <div className="relative h-28 w-40">
        {/* Colored Glow */}
        <div className={`absolute left-8 top-6 h-12 w-12 rounded-full bg-gradient-to-br ${event.color} blur-[1px] shadow-[0_0_42px_rgba(255,255,255,.35)]`} />
        {/* White Core */}
        <div className="absolute left-11 top-9 h-6 w-6 rounded-full bg-white shadow-[0_0_30px_rgba(255,255,255,.9)]" />
        {/* Orbiting Dots */}
        {dots.map((_, index) => (
          <motion.span
            key={index}
            className="absolute h-1.5 w-1.5 rounded-full bg-white/80"
            style={{
              left: `${12 + ((index * 17) % 92)}px`,
              top: `${10 + ((index * 23) % 68)}px`,
            }}
            animate={{ opacity: [0.35, 1, 0.35], scale: [0.8, 1.25, 0.8] }}
            transition={{ duration: 2.2 + index * 0.15, repeat: Infinity }}
          />
        ))}
        {/* Info Card */}
        <div className="absolute left-0 top-20 min-w-44 rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-white backdrop-blur-xl">
          <div className="text-xs text-white/55">{event.month}</div>
          <div className="text-sm font-semibold">{event.title}</div>
          <div className="mt-1 text-xs text-white/65">{event.count} photos · {event.location}</div>
        </div>
      </div>
    </motion.button>
  );
}

/* ─── Main Component ─── */

export function MemoryWalkApp({ plugin }: { plugin: ChildTimelinePlugin }) {
  const [mode, setMode] = useState<"galaxy" | "gallery" | "carousel">("galaxy");
  const [activeEvent, setActiveEvent] = useState<any>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<any>(null);
  const [activeMonth, setActiveMonth] = useState<string>("all");
  const [playing, setPlaying] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "favorites">("all");
  const [showSidebar, setShowSidebar] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [galaxyZoom, setGalaxyZoom] = useState(1);

  const [events, setEvents] = useState<any[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [allPhotos, setAllPhotos] = useState<GalaxyPhoto[]>([]);
  const [galaxyShape, setGalaxyShape] = useState<GalaxyShape>("spiral");
  const [months, setMonths] = useState<string[]>([]);
  const [stats, setStats] = useState({ total: 0, favorites: 0, travel: 0, family: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void wrapperRef.current?.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen();
    }
  };

  /* ─── Data Parsing ─── */

  useEffect(() => {
    const parseData = () => {
      const rawEntries = plugin.data.entries.filter(e => e.images && e.images.length > 0);

      const extractedMonths = Array.from(new Set(rawEntries.map(e => {
        const d = new Date(e.date || e.createdAt);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }))).sort();

      setMonths(extractedMonths.length > 0 ? extractedMonths : [`${new Date().getFullYear()}-01`]);

      let favCount = 0;
      rawEntries.forEach(e => { if (e.likes > 0) favCount++; });
      const totalPhotos = rawEntries.reduce((s, e) => s + (e.images?.length || 0), 0);
      setStats({ total: totalPhotos, favorites: favCount, travel: 0, family: 0 });

      const colors = [
        "from-amber-200/80 to-orange-400/70",
        "from-sky-200/80 to-blue-500/70",
        "from-violet-200/80 to-fuchsia-500/70",
        "from-rose-200/80 to-cyan-400/70",
        "from-teal-200/80 to-emerald-500/70",
      ];

      const newEvents = extractedMonths.map((monthStr, index) => {
        const monthEntries = rawEntries.filter(e => {
          const d = new Date(e.date || e.createdAt);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === monthStr;
        });
        const photoCount = monthEntries.reduce((sum, e) => sum + (e.images?.length || 0), 0);
        // Spread events across the canvas with more variance for monthly scale
        const xPositions = [18, 38, 61, 78, 85, 25, 45, 65, 80, 15, 35, 55, 75, 90];
        const yPositions = [38, 28, 43, 30, 62, 50, 70, 20, 55, 75, 15, 85, 45, 10];
        return {
          id: `month-${monthStr}`,
          month: monthStr,
          title: `${monthStr} 拾光`,
          location: "Obsidian",
          count: photoCount,
          mood: "记忆",
          entries: monthEntries,
          x: xPositions[index % xPositions.length],
          y: yPositions[index % yPositions.length],
          color: colors[index % colors.length],
        };
      });
      setEvents(newEvents);
      setEvents(newEvents);
      
      // Parse all photos for Galaxy3D
      let globalIndex = 0;
      const parsedAllPhotos = rawEntries.flatMap((e: TimelineEntry) => {
        return (e.images || []).map((imgName: string) => {
          const path = plugin.resolveMediaPath(imgName);
          const file = plugin.app.vault.getAbstractFileByPath(path);
          const url = file ? plugin.app.vault.getResourcePath(file as any) : '';
          
          const d = new Date(e.date || e.createdAt);
          const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          
          return {
            id: `${e.id}-${globalIndex++}`,
            entryId: e.id,
            imageName: imgName,
            title: e.content ? e.content.substring(0, 20) : imgName,
            date: e.date,
            month: monthStr,
            location: e.tags?.join(', ') || 'Obsidian',
            people: [e.childName || e.subjectName || ''],
            tags: e.tags || [],
            favorite: e.likes > 0,
            imageUrl: url,
            note: e.content || '',
            index: globalIndex,
            timestamp: d.getTime()
          };
        });
      });
      // Sort by timestamp
      parsedAllPhotos.sort((a, b) => a.timestamp - b.timestamp);
      setAllPhotos(parsedAllPhotos);
    };

    parseData();
    const handler = () => parseData();
    plugin.app.workspace.on('child-timeline-data-changed', handler);
    return () => plugin.app.workspace.off('child-timeline-data-changed', handler);
  }, [plugin]);

  useEffect(() => {
    if (activeEvent) {
      const activePhotos = activeEvent.entries.flatMap((e: TimelineEntry) => {
        return (e.images || []).map((imgName: string, imgIndex: number) => {
          const path = plugin.resolveMediaPath(imgName);
          const file = plugin.app.vault.getAbstractFileByPath(path);
          const url = file ? plugin.app.vault.getResourcePath(file as any) : '';
          return {
            id: `${e.id}-${imgIndex}`,
            entryId: e.id,
            imageName: imgName,
            title: e.content ? e.content.substring(0, 20) : imgName,
            date: e.date,
            location: e.tags?.join(', ') || '默认相册',
            people: [e.childName || e.subjectName || ''],
            tags: e.tags || [],
            favorite: e.likes > 0,
            imageUrl: url,
            note: e.content || '',
          };
        });
      });
      setPhotos(activePhotos);
      setPhotos(activePhotos);
    }
  }, [activeEvent, plugin]);

  function enterEvent(event: any) {
    setActiveEvent(event);
    setActiveMonth(event.month);
    setMode("gallery");
    setShowSidebar(false);
    setShowTimeline(true);
  }

  const galaxyShapeOptions: { value: GalaxyShape; label: string }[] = [
    { value: "spiral", label: "螺旋星系" },
    { value: "nebula-disk", label: "星云盘面" },
    { value: "avenue", label: "宇宙视角" },
  ];
  const cycleGalaxyShape = () => {
    const currentIndex = galaxyShapeOptions.findIndex((item) => item.value === galaxyShape);
    const next = galaxyShapeOptions[(currentIndex + 1) % galaxyShapeOptions.length];
    setGalaxyShape(next.value);
  };
  const galaxyShapeLabel = galaxyShapeOptions.find((item) => item.value === galaxyShape)?.label || "螺旋星系";

  /* ─── Empty State ─── */

  if (events.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#080A10] text-white/50">
        <div className="text-center">
          <Sparkles className="mx-auto h-12 w-12 opacity-30 mb-4" />
          <p className="text-lg">暂无带照片的拾光记录</p>
          <p className="text-sm mt-2 opacity-60">快去时间线添加吧！</p>
        </div>
      </div>
    );
  }

  const sidebarItems = [
    { label: "全部照片", count: stats.total },
    { label: "收藏精选", count: stats.favorites },
  ];

  // Search & Filter
  const filteredEvents = events.filter(e => {
    if (filterMode === 'favorites') {
      const hasFav = e.entries.some((entry: any) => entry.likes > 0);
      if (!hasFav) return false;
    }
    if (!searchQuery.trim()) return true;
    return e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
           e.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
           String(e.month).includes(searchQuery);
  });

  const filteredPhotos = photos.filter(p => {
    if (filterMode === 'favorites' && !p.favorite) return false;
    if (!searchQuery.trim()) return true;
    return (p.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
           (p.location || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
           (p.note || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
           (p.tags || []).some((t: string) => t.toLowerCase().includes(searchQuery.toLowerCase()));
  });

  const enrichPhotoFromEntry = (photo: any) => {
    const entry = plugin.data.entries.find((item: TimelineEntry) => item.id === photo?.entryId)
      || plugin.data.entries.find((item: TimelineEntry) => (item.images || []).includes(photo?.imageName))
      || plugin.data.entries.find((item: TimelineEntry) => {
        if (!photo?.imageUrl) return false;
        return (item.images || []).some(imageName => {
          const path = plugin.resolveMediaPath(imageName);
          const file = plugin.app.vault.getAbstractFileByPath(path);
          const url = file ? plugin.app.vault.getResourcePath(file as any) : '';
          return url === photo.imageUrl;
        });
      });

    if (!entry) return photo;

    return {
      ...photo,
      entryId: entry.id,
      date: entry.date || photo.date,
      tags: entry.tags || [],
      favorite: (entry.likes || 0) > 0,
      note: entry.content || '',
      title: entry.content ? entry.content.substring(0, 20) : (photo.imageName || photo.title),
    };
  };

  const jumpToTimelineEntry = (photo: any) => {
    const enriched = enrichPhotoFromEntry(photo);
    if (!enriched?.entryId) return;
    setSelectedPhoto(null);
    plugin.app.workspace.trigger('shiguang-jump-to-entry', enriched.entryId);
  };

  /* ─── Render ─── */

  return (
    <div ref={wrapperRef} className="shiguang-memory-walk-wrapper relative h-full w-full overflow-hidden bg-[#020204] text-white">
      {/* ─── Deep Space Background ─── */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(99,102,241,.15),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(34,211,238,.12),transparent_28%),radial-gradient(circle_at_50%_90%,rgba(244,114,182,.1),transparent_36%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.02)_1px,transparent_1px)] bg-[size:54px_54px] opacity-20" />

      <main className="relative h-full w-full">

        {/* ─── Top Left Overlay (Title) ─── */}
        {!isFullscreen && (
          <div className="absolute top-6 left-6 z-50 flex items-center gap-4 bg-black/40 backdrop-blur-2xl border border-white/10 px-5 py-3 rounded-3xl shadow-xl pointer-events-auto">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-[17px] font-bold tracking-wide m-0 text-white">拾光漫游</h1>
              <p className="text-[11px] font-medium text-white/50 m-0 mt-0.5 tracking-wider uppercase">Memory Walk</p>
            </div>
          </div>
        )}

        {/* ─── Top Right Overlay (Controls) ─── */}
        <div className={`absolute top-6 right-8 md:right-24 z-50 flex items-center gap-3 pointer-events-auto transition-opacity duration-500 ${isFullscreen ? 'opacity-30 hover:opacity-100' : ''}`}>
          
          {!isFullscreen && (
            <>
              {/* Search */}
              <div className="hidden w-[280px] items-center gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 backdrop-blur-2xl shadow-xl md:flex transition-all focus-within:bg-black/60 focus-within:border-white/20">
                <Search className="h-4 w-4 text-white/50 shrink-0" />
                <input
                  className="w-full bg-transparent text-sm font-medium text-white placeholder:text-white/30 focus:outline-none"
                  placeholder="搜索记忆、地点、人物..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="text-white/40 hover:text-white/90 text-xs shrink-0 cursor-pointer transition-colors">✕</button>
                )}
              </div>

              {/* View Mode Switch */}
              <Button
                variant="ghost"
                onClick={cycleGalaxyShape}
                className="rounded-2xl bg-black/40 hover:bg-black/60 backdrop-blur-2xl border border-white/10 px-4 py-2.5 text-xs font-medium text-white/80 transition-all shadow-xl h-[42px]"
                title="切换漫游视角"
              >
                <Layers className="mr-1.5 h-4 w-4" /> 
                {galaxyShapeLabel}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setMode("carousel")}
                className="rounded-2xl bg-black/40 hover:bg-black/60 backdrop-blur-2xl border border-white/10 px-4 py-2.5 text-xs font-medium text-white/80 transition-all shadow-xl h-[42px]"
                title="进入拾光漫步"
              >
                <ImageIcon className="mr-1.5 h-4 w-4" /> 
                拾光漫步
              </Button>
            </>
          )}

          {/* Fullscreen Button */}
          <Button
            variant="ghost"
            onClick={toggleFullscreen}
            className="h-[42px] w-[42px] rounded-2xl bg-black/40 hover:bg-black/60 backdrop-blur-2xl border border-white/10 flex items-center justify-center shadow-xl transition-all"
            title={isFullscreen ? "退出全屏" : "纯净全屏"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4 text-white/80" /> : <Maximize2 className="h-4 w-4 text-white/80" />}
          </Button>
        </div>

        {/* ─── Main Content Area ─── */}
        <div className="absolute inset-0 w-full h-full">

          {/* Center Canvas */}
          <div className="absolute inset-0 w-full h-full bg-[#020204]">
            {mode === "carousel" ? (
                <CarouselMode 
                    photos={allPhotos.filter(p => filterMode === "favorites" ? p.favorite : true)} 
                    onExit={() => setMode("galaxy")} 
                    isFullscreen={isFullscreen}
                    toggleFullscreen={toggleFullscreen}
                />
            ) : (
                <Galaxy3D 
                    photos={allPhotos} 
                    activeMonth={filterMode === "favorites" ? "all" : activeMonth} 
                    galaxyShape={galaxyShape}
                    onPhotoClick={(photo) => {
                        setSelectedPhoto(enrichPhotoFromEntry(photo));
                    }}
                />
            )}
          </div>

          {/* ─── Centered Modal (Photo Details) ─── */}
          <AnimatePresence>
          {selectedPhoto && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="memory-photo-modal-overlay"
              onClick={() => setSelectedPhoto(null)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="memory-photo-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <button 
                  onClick={() => setSelectedPhoto(null)}
                  className="memory-photo-close"
                  aria-label="关闭预览"
                  title="关闭预览"
                >
                  <X className="h-5 w-5" />
                </button>

                <div className="memory-photo-stage">
                  <img 
                    src={selectedPhoto.imageUrl} 
                    className="memory-photo-image"
                    alt="preview"
                  />
                </div>

                <aside className="memory-photo-info">
                   <div className="memory-photo-info-kicker">
                     <Sparkles className="h-4 w-4" />
                     <span>拾光片段</span>
                   </div>

                   <button
                     className="memory-photo-date-pill is-clickable"
                     type="button"
                     title="跳转到对应记录"
                     aria-label="跳转到对应记录"
                     onClick={() => jumpToTimelineEntry(selectedPhoto)}
                   >
                     <CalendarDays className="h-4 w-4" />
                     <span>{selectedPhoto.date}</span>
                   </button>

                   {selectedPhoto.tags?.length > 0 && (
                      <div className="memory-photo-section">
                        <div className="memory-photo-section-title">标签</div>
                        <div className="memory-photo-tags">
                          {selectedPhoto.tags.map((tag: string) => (
                            <span key={tag} className="memory-photo-tag">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                   )}

                   {selectedPhoto.note?.trim() && (
                      <div className="memory-photo-section">
                        <div className="memory-photo-section-title">记录</div>
                        <div className="memory-photo-note">
                          <MarkdownPreview content={selectedPhoto.note} sourcePath={selectedPhoto.file?.path || ""} app={plugin.app} />
                        </div>
                      </div>
                   )}
                </aside>
              </motion.div>
            </motion.div>
          )}
          </AnimatePresence>

          {/* ─── Bottom Timeline Redesign ─── */}
          <div className={`absolute bottom-0 left-0 right-0 z-30 h-32 flex items-end justify-center pb-8 pointer-events-auto transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group ${
            isFullscreen ? 'translate-y-[80%] hover:translate-y-0' : 'translate-y-0'
          }`}>
            <div className="relative w-[90%] max-w-4xl flex items-center gap-6 z-10">
              
              {/* Minimal Reset Button */}
              <button 
                onClick={() => { setActiveMonth('all'); setActiveEvent(null); }}
                className={`shrink-0 flex items-center justify-center px-5 py-2 rounded-full transition-all duration-300 font-bold text-[10px] tracking-[0.2em] uppercase border ${
                  activeMonth === 'all' 
                    ? 'border-white/30 text-white bg-white/10 shadow-[0_0_20px_rgba(255,255,255,0.1)]' 
                    : 'border-transparent text-white/30 hover:text-white/80 hover:bg-white/5'
                }`}
              >
                <Orbit className="w-3.5 h-3.5 mr-2 opacity-80" />
                全部记忆
              </button>

              <div className="h-4 w-px bg-white/10 shrink-0" />

              {/* Minimal Timeline Track */}
              <div className="relative h-12 flex-1 flex items-center">
                <div className="absolute left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                
                {months.map((month, index) => {
                  const left = `${months.length > 1 ? (index / (months.length - 1)) * 100 : 50}%`;
                  const active = month === activeMonth;
                  return (
                    <button
                      key={month}
                      onClick={() => {
                        setActiveMonth(month);
                        const ev = events.find(e => e.month === month);
                        if (ev) setActiveEvent(ev);
                      }}
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group/btn cursor-pointer border-none bg-transparent outline-none p-3"
                      style={{ left }}
                    >
                      <div className={`relative flex items-center justify-center transition-all duration-500 ease-out ${
                        active ? "w-3 h-3" : "w-1.5 h-1.5 group-hover/btn:w-2.5 group-hover/btn:h-2.5"
                      }`}>
                        <span className={`block w-full h-full rounded-full transition-all duration-300 ${
                          active ? "bg-white shadow-[0_0_12px_rgba(255,255,255,1)] scale-125" : "bg-white/30 group-hover/btn:bg-white/80"
                        }`} />
                        {active && <span className="absolute inset-0 rounded-full animate-ping bg-white/60" style={{ animationDuration: '2s' }}/>}
                      </div>
                      <span className={`absolute top-full mt-2 text-[10px] font-medium tracking-widest whitespace-nowrap transition-all duration-300 ${
                        active ? "text-white opacity-100 -translate-y-0.5" : "text-white/20 opacity-0 group-hover/btn:opacity-100"
                      }`}>{month.replace('-', '/')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            
            {/* Subtle bottom gradient to ensure visibility against stars */}
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none transition-opacity duration-700 opacity-50 group-hover:opacity-100" />
          </div>
        </div>
      </main>
      {/* CSS Reset for Obsidian overrides */}
      <style>{`
        .shiguang-memory-walk-wrapper .shiguang-memory-walk-wrapper {
          box-sizing: border-box;
        }
        .shiguang-memory-walk-wrapper button,
        .shiguang-memory-walk-wrapper button:hover,
        .shiguang-memory-walk-wrapper button:focus,
        .shiguang-memory-walk-wrapper button:active {
          background-color: transparent;
          border: none;
          padding: 0;
          margin: 0;
          color: inherit;
          font: inherit;
          cursor: pointer;
          box-shadow: none;
          outline: none;
          -webkit-appearance: none;
          appearance: none;
          text-shadow: none;
        }
        .shiguang-memory-walk-wrapper input,
        .shiguang-memory-walk-wrapper input:hover,
        .shiguang-memory-walk-wrapper input:focus {
          background-color: transparent;
          border: none;
          color: inherit;
          font: inherit;
          box-shadow: none;
          outline: none;
          text-shadow: none;
        }
        .shiguang-memory-walk-wrapper h1,
        .shiguang-memory-walk-wrapper h2,
        .shiguang-memory-walk-wrapper p,
        .shiguang-memory-walk-wrapper pre {
          margin: 0;
          padding: 0;
        }
      `}</style>
    </div>
  );
}
