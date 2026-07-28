import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Play, Pause, MapPin, Heart, Film, Maximize2, Minimize2 } from "lucide-react";
import { GalaxyPhoto } from "./Galaxy3D";

interface CarouselModeProps {
    photos: GalaxyPhoto[];
    onExit: () => void;
    isFullscreen: boolean;
    toggleFullscreen: () => void;
}

export function CarouselMode({ photos, onExit, isFullscreen, toggleFullscreen }: CarouselModeProps) {
    const [activeIndex, setActiveIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    
    const sortedPhotos = React.useMemo(() => {
        return [...photos].sort((a, b) => a.timestamp - b.timestamp);
    }, [photos]);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isPlaying) {
            interval = setInterval(() => {
                setActiveIndex((prev) => (prev + 1) % sortedPhotos.length);
            }, 3500);
        }
        return () => clearInterval(interval);
    }, [isPlaying, sortedPhotos.length]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight') {
                setActiveIndex((prev) => Math.min(prev + 1, sortedPhotos.length - 1));
                setIsPlaying(false);
            } else if (e.key === 'ArrowLeft') {
                setActiveIndex((prev) => Math.max(prev - 1, 0));
                setIsPlaying(false);
            } else if (e.key === 'Escape') {
                if (isFullscreen) {
                    toggleFullscreen();
                } else {
                    onExit();
                }
            } else if (e.key === ' ') {
                setIsPlaying(p => !p);
                e.preventDefault();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [sortedPhotos.length, onExit, isFullscreen, toggleFullscreen]);

    if (sortedPhotos.length === 0) {
        return (
            <div className="absolute inset-0 bg-[#020204] flex items-center justify-center text-white z-50">
                <button onClick={onExit} className="absolute top-8 left-8 flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full hover:bg-white/20 transition">
                    <ChevronLeft className="w-4 h-4" /> 返回星河
                </button>
                <div className="text-white/50">没有找到照片记忆...</div>
            </div>
        );
    }

    const activePhoto = sortedPhotos[activeIndex];
    
    const getGradient = (index: number) => {
        const gradients = [
            "from-blue-600/40 via-sky-500/20 to-indigo-800/60",
            "from-rose-500/40 via-orange-400/20 to-purple-700/60",
            "from-violet-600/40 via-fuchsia-500/20 to-pink-700/60",
            "from-emerald-500/40 via-teal-400/20 to-cyan-700/60",
        ];
        return gradients[index % gradients.length];
    };

    // Film strip height: 46px. Top bar: 56px. Padding: 24px top + 16px bottom gap.
    // Available image area = 100vh - 56px(top) - 46px(film) - 40px(padding)
    const filmStripH = isFullscreen ? 0 : 46;
    const topBarH = isFullscreen ? 0 : 56;

    return (
        <div className="absolute inset-0 bg-[#050505] overflow-hidden z-[100] font-sans selection:bg-white/30">
            {/* Dynamic Immersive Background */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activePhoto?.id || 'empty'}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.5 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.0, ease: "easeInOut" }}
                    className="absolute inset-0 pointer-events-none"
                >
                    {activePhoto?.imageUrl ? (
                        <div 
                            className="absolute inset-0 bg-cover bg-center blur-[120px] scale-150 saturate-150"
                            style={{ backgroundImage: `url(${activePhoto.imageUrl})` }}
                        />
                    ) : (
                        <div className={`absolute inset-0 bg-gradient-to-br ${getGradient(activeIndex)} blur-[100px] scale-125`} />
                    )}
                </motion.div>
            </AnimatePresence>
            
            <div className="absolute inset-0 bg-black/50 pointer-events-none" /> 

            {/* Film Grain */}
            <div className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-20 animate-pulse"
                 style={{
                     backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
                 }}
            />
            {/* Vignette */}
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_50%,transparent_10%,rgba(0,0,0,1)_120%)]" />

            {/* Top Bar */}
            <div className={`absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 transition-all duration-500 ${isFullscreen ? 'opacity-0 hover:opacity-100 h-[48px]' : 'opacity-100 h-[56px]'}`}>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={onExit}
                        className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur-md px-3 py-1.5 rounded-xl text-white text-xs font-medium transition-all shadow-xl"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" /> 返回星河
                    </button>
                    <div className="bg-white/5 border border-white/10 backdrop-blur-md px-3 py-1.5 rounded-xl flex items-center gap-2 text-white/70 text-xs">
                        <Film className="w-3.5 h-3.5 opacity-50" />
                        {sortedPhotos[activeIndex].month} · {activeIndex + 1}/{sortedPhotos.length}
                    </div>
                </div>
                
                <button 
                    onClick={toggleFullscreen}
                    className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur-md px-3 py-1.5 rounded-xl text-white/70 text-xs font-medium transition-all shadow-xl"
                >
                    {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    {isFullscreen ? '退出全屏' : '纯净全屏'}
                </button>
            </div>

            {/* ─── CENTRAL PROJECTION STAGE ─── */}
            {/* Use absolute positioning with calc() to guarantee the image fits between the top bar and film strip */}
            <div 
                className="absolute left-0 right-0 flex items-center justify-center px-8 transition-all duration-500"
                style={{
                    top: `${topBarH}px`,
                    bottom: `${filmStripH}px`,
                }}
            >
                <AnimatePresence>
                    <motion.div
                        key={activePhoto.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        className="group absolute rounded-[18px] overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.9)] ring-1 ring-white/10 bg-black/30"
                    >
                        {/* Image — constrained to available viewport area */}
                        {activePhoto.imageUrl ? (
                            <img 
                                src={activePhoto.imageUrl} 
                                alt={activePhoto.title} 
                                className="block object-contain"
                                style={{
                                    maxWidth: '88vw',
                                    maxHeight: `calc(100vh - ${topBarH + filmStripH + 32}px)`,
                                }}
                            />
                        ) : (
                            <div 
                                className={`bg-gradient-to-br ${getGradient(activeIndex)}`} 
                                style={{ width: '60vw', height: `calc(100vh - ${topBarH + filmStripH + 48}px)` }}
                            />
                        )}

                        {/* Hover Overlay Content */}
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-400">
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                            
                            <div className="absolute bottom-0 left-0 right-0 p-5 flex items-end justify-between">
                                <div className="max-w-[85%]">
                                    <h2 className="text-white text-lg font-bold tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] leading-snug mb-1 line-clamp-1 break-all">
                                        {activePhoto.title?.split('/').pop()?.replace(/\.(jpg|jpeg|png|heic|gif)$/i, '') || 'Untitled Memory'}
                                    </h2>
                                    <div className="flex items-center gap-3 text-white/70 text-xs">
                                        <span>{activePhoto.date?.slice(5) || 'Unknown'}</span>
                                        <span className="flex items-center gap-1">
                                            <MapPin className="w-3 h-3 opacity-70" />
                                            <span className="truncate">{activePhoto.location || 'Unknown'}</span>
                                        </span>
                                    </div>
                                </div>
                                {activePhoto.favorite && (
                                    <Heart className="w-5 h-5 fill-rose-500 text-rose-500 drop-shadow-md shrink-0" />
                                )}
                            </div>
                        </div>
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* ─── BOTTOM FILM STRIP TRACK ─── */}
            <div className={`absolute bottom-0 left-0 right-0 flex items-center overflow-hidden bg-[#0a0a0a]/95 border-t border-white/5 shadow-[0_-10px_30px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-all duration-700 ${isFullscreen ? 'translate-y-full' : 'translate-y-0'}`}
                 style={{ height: '46px' }}
            >
                {/* Sprocket Holes — top and bottom edges */}
                <div 
                    className="absolute inset-0 pointer-events-none opacity-30"
                    style={{
                        backgroundImage: `
                            repeating-linear-gradient(to right, rgba(255,255,255,0.5), rgba(255,255,255,0.5) 3px, transparent 3px, transparent 7px),
                            repeating-linear-gradient(to right, rgba(255,255,255,0.5), rgba(255,255,255,0.5) 3px, transparent 3px, transparent 7px)
                        `,
                        backgroundPosition: '0 3px, 0 39px',
                        backgroundSize: '100% 3px, 100% 3px',
                        backgroundRepeat: 'no-repeat'
                    }}
                />
                
                {/* Play button integrated into film strip left side */}
                <button 
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="absolute left-4 z-10 w-8 h-8 bg-white/10 hover:bg-white/25 rounded-full flex items-center justify-center text-white transition-colors border border-white/10"
                    title={isPlaying ? '暂停' : '播放'}
                >
                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                </button>
                
                <motion.div
                    className="flex items-center h-full"
                    style={{ paddingLeft: 'calc(50vw - 28px)', paddingRight: '50vw' }}
                    animate={{ x: -(activeIndex * 62) }} // 56px width + 6px gap
                    transition={{ 
                        type: "spring", 
                        stiffness: 120,
                        damping: 18, 
                        mass: 0.9 
                    }}
                >
                    <div className="flex gap-[6px] items-center">
                        {sortedPhotos.map((photo, i) => {
                            const isFront = i === activeIndex;
                            return (
                                <div
                                    key={photo.id}
                                    onClick={() => { setActiveIndex(i); setIsPlaying(false); }}
                                    title={photo.date}
                                    className={`relative w-[56px] h-[32px] flex-shrink-0 rounded-[3px] overflow-hidden cursor-pointer transition-all duration-300 ${isFront ? 'ring-[1.5px] ring-white shadow-[0_0_12px_rgba(255,255,255,0.25)] opacity-100' : 'opacity-25 hover:opacity-50'}`}
                                >
                                    {photo.imageUrl ? (
                                        <img src={photo.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                    ) : (
                                        <div className={`absolute inset-0 bg-gradient-to-br ${getGradient(i)}`} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </motion.div>
            </div>
            
        </div>
    );
}
