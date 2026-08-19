import React, { useMemo, useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html, Stars } from "@react-three/drei";
import { setCssProps } from "obsidian";
import { TimelineEntry } from "../settings";
import ChildTimelinePlugin from "../main";

export interface GalaxyPhoto {
    id: string;
    entryId?: string;
    imageName?: string;
    title: string;
    date: string; // YYYY-MM-DD
    month: string; // YYYY-MM
    location: string;
    people: string[];
    tags: string[];
    favorite: boolean;
    imageUrl: string;
    note?: string;
    index: number;
    timestamp: number;
}

interface Galaxy3DProps {
    photos: GalaxyPhoto[];
    activeMonth: string;
    galaxyShape: GalaxyShape;
    onPhotoClick: (photo: GalaxyPhoto) => void;
    hoveredPhotoId?: string | null;
}

export type GalaxyShape = "spiral" | "avenue" | "nebula-disk";

const textureCache = new Map<string, THREE.Texture>();
const texturePromises = new Map<string, Promise<THREE.Texture>>();

function getThumbnailTexture(url: string): Promise<THREE.Texture> {
    if (textureCache.has(url)) return Promise.resolve(textureCache.get(url)!);
    if (texturePromises.has(url)) return texturePromises.get(url)!;
    
    const promise = new Promise<THREE.Texture>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 64; // Tiny canvas for massive memory savings
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const scale = Math.max(64 / img.width, 64 / img.height);
                const w = img.width * scale;
                const h = img.height * scale;
                ctx.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
            }
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            textureCache.set(url, texture);
            
            // LRU cache to prevent infinite growth
            if (textureCache.size > 200) {
                const firstKey = textureCache.keys().next().value;
                const oldTex = textureCache.get(firstKey);
                if (oldTex) oldTex.dispose();
                textureCache.delete(firstKey);
                texturePromises.delete(firstKey);
            }
            
            resolve(texture);
        };
        img.onerror = () => resolve(new THREE.Texture());
        img.src = url;
    });
    
    texturePromises.set(url, promise);
    return promise;
}

function PhotoSprite({ photo, pos, isHovered, onHover, onLeave, onClick }: any) {
    const [texture, setTexture] = useState<THREE.Texture | null>(null);
    
    useEffect(() => {
        let isMounted = true;
        getThumbnailTexture(photo.imageUrl).then(tex => {
            if (isMounted) setTexture(tex);
        });
        return () => { isMounted = false; };
    }, [photo.imageUrl]);
    
    const spriteRef = useRef<THREE.Sprite>(null);
    useFrame((state, delta) => {
        if (spriteRef.current) {
            const target = isHovered ? 1.0 : 0.35;
            const cur = spriteRef.current.scale.x;
            const next = THREE.MathUtils.lerp(cur, target, delta * 15);
            
            // Prevent the sprite from occupying the whole screen when the camera flies through it
            const dist = state.camera.position.distanceTo(pos);
            const maxApparentSize = isHovered ? 0.08 : 0.04;
            const maxScale = dist * maxApparentSize; 
            
            const finalScale = Math.min(next, maxScale);
            spriteRef.current.scale.set(finalScale, finalScale, 1);
        }
    });
    
    if (!texture) return null;

    return (
        <sprite
            ref={spriteRef}
            position={pos}
            onClick={(e) => { e.stopPropagation(); onClick(photo); }}
            onPointerEnter={(e) => { e.stopPropagation(); onHover(); setCssProps(document.body, { cursor: 'pointer' }); }}
            onPointerLeave={(e) => { e.stopPropagation(); onLeave(); setCssProps(document.body, { cursor: 'auto' }); }}
        >
            <spriteMaterial map={texture} depthTest={false} transparent opacity={isHovered ? 1 : 0.8} />
        </sprite>
    );
}

const GALAXY_COLORS = [
    new THREE.Color("#fef08a"), // yellow core
    new THREE.Color("#ffffff"), // white transition
    new THREE.Color("#f472b6"), // pink inner arms
    new THREE.Color("#a855f7"), // purple outer arms
    new THREE.Color("#06b6d4"), // cyan edges
];

// Muted silver-white palette for nebula-disk mode matching the reference image
const NEBULA_DISK_COLORS = [
    new THREE.Color("#e8e0d0"), // warm white core
    new THREE.Color("#d0ccc8"), // silver
    new THREE.Color("#c0b8c8"), // faint lavender
    new THREE.Color("#b0b8c0"), // blue-grey
    new THREE.Color("#a8b0b8"), // cool grey edge
];

function getColorForTimeProgress(progress: number) {
    const idx = Math.floor(progress * (GALAXY_COLORS.length - 1));
    const t = (progress * (GALAXY_COLORS.length - 1)) - idx;
    const c1 = GALAXY_COLORS[idx];
    const c2 = GALAXY_COLORS[Math.min(idx + 1, GALAXY_COLORS.length - 1)];
    return c1.clone().lerp(c2, t);
}

function getNebulaColor(progress: number) {
    const idx = Math.floor(progress * (NEBULA_DISK_COLORS.length - 1));
    const t = (progress * (NEBULA_DISK_COLORS.length - 1)) - idx;
    const c1 = NEBULA_DISK_COLORS[idx];
    const c2 = NEBULA_DISK_COLORS[Math.min(idx + 1, NEBULA_DISK_COLORS.length - 1)];
    return c1.clone().lerp(c2, t);
}

function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    return texture;
}

// Softer, wider glow for nebula-disk mode – creates a more diffuse, cloud-like appearance
function createNebulaGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)'); // Sharp hot core
    gradient.addColorStop(0.1, 'rgba(255, 255, 255, 0.4)'); // Strong inner glow
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.08)'); // Very faint wide outer volume
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    return texture;
}

// Tight dot texture for nebula-disk: sharp, small, less glow
function createDiskDustTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.12, 'rgba(255, 255, 255, 0.9)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.3)');
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.05)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipMapLinearFilter;
    return texture;
}

function pseudoRandom(seed: number) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

function getNebulaDiskRadius(total: number) {
    return Math.max(40, Math.pow(Math.max(1, total), 0.5) * 5.5);
}

function getSpiralRadius(total: number) {
    return Math.max(28, Math.pow(Math.max(1, total), 0.5) * 4.2);
}

function calculateSpiralPosition(index: number, count: number, timestamp: number, minTime: number, maxTime: number, overrideTotalScale?: number, isDecorative: boolean = false) {
    // Use actual timestamp for completely natural, organic clustering
    const timeProgress = count <= 1 ? 0.5 : (timestamp - minTime) / (maxTime - minTime || 1);
    const effectiveTotal = overrideTotalScale || count;
    
    const maxRadius = getSpiralRadius(effectiveTotal);
    const arms = 4; 
    const spin = Math.max(2.4, Math.min(5.6, effectiveTotal / 58)); 
    
    // Distribute decorative dust to fill empty gaps and create a majestic galaxy
    const isBackgroundDisk = isDecorative && pseudoRandom(index * 9.1) < 0.16;
    const isCore = isDecorative && !isBackgroundDisk && pseudoRandom(index * 8.2) < 0.16;
    
    let radiusProgress, angle, radius, noiseSpreadX, noiseSpreadY, noiseSpreadZ;
    
    if (isCore) {
        radiusProgress = Math.pow(pseudoRandom(index * 7.3), 1.5) * 0.4; 
        angle = pseudoRandom(index * 6.4) * Math.PI * 2;
        radius = radiusProgress * maxRadius;
        noiseSpreadX = maxRadius * 0.16;
        noiseSpreadY = maxRadius * 0.24;
        noiseSpreadZ = maxRadius * 0.16;
    } else if (isBackgroundDisk) {
        radiusProgress = Math.pow(pseudoRandom(index * 5.5), 0.7);
        angle = pseudoRandom(index * 4.6) * Math.PI * 2;
        radius = radiusProgress * maxRadius * 1.25;
        noiseSpreadX = 1.2;
        noiseSpreadY = maxRadius * 0.08;
        noiseSpreadZ = 1.2;
    } else {
        radiusProgress = Math.pow(timeProgress, 0.5); 
        angle = radiusProgress * Math.PI * 2 * spin + (index % arms) * ((Math.PI * 2) / arms);
        radius = radiusProgress * maxRadius;
        
        const bulge = Math.max(0, 1 - radiusProgress * 2); 
        // Same organic spread for photos and dust so photos look like natural stars within the nebula
        const baseSpread = isDecorative ? 0.105 : 0.14;
        noiseSpreadX = Math.max(0.45, maxRadius * baseSpread) * (1 + bulge * 1.1);
        noiseSpreadY = Math.max(0.7, maxRadius * 0.045) * (1 + bulge * 3);
        noiseSpreadZ = Math.max(0.45, maxRadius * baseSpread) * (1 + bulge * 1.1);
    }
    
    // Deterministic random so positions don't jitter on re-renders
    const r1 = pseudoRandom(index * 13.1 + timestamp);
    const r2 = pseudoRandom(index * 29.2 + timestamp);
    const r3 = pseudoRandom(index * 41.3 + timestamp);
    
    const randomX = (r1 - 0.5) * noiseSpreadX;
    // Fix: Remove the double compression (pseudoRandom - 0.5) that squashed the Y axis to 1/4th height
    const randomY = (r2 - 0.5) * noiseSpreadY;
    const randomZ = (r3 - 0.5) * noiseSpreadZ;
    
    const x = Math.cos(angle) * radius + randomX;
    const y = randomY;
    const z = Math.sin(angle) * radius + randomZ;
    
    return new THREE.Vector3(x, y, z);
}

function calculateAvenuePosition(index: number, count: number, timestamp: number, minTime: number, maxTime: number, overrideTotalScale?: number, isDecorative: boolean = false) {
    // Use actual timestamp for completely natural, organic clustering
    const timeProgress = count <= 1 ? 0.5 : (timestamp - minTime) / (maxTime - minTime || 1);
    const effectiveTotal = overrideTotalScale || count;
    
    // Substantially increased tunnel length and radius for a larger starry avenue
    const tunnelLength = Math.max(45, effectiveTotal * 0.7);
    const maxRadius = Math.max(5, Math.pow(effectiveTotal, 0.3) * 2.5);
    
    let angle, radius, z;
    
    if (isDecorative && pseudoRandom(index * 7.1) < 0.6) {
        // Background ambient dust scattered everywhere in the tunnel volume
        z = (pseudoRandom(index * 6.2) - 0.5) * tunnelLength * 1.5;
        angle = pseudoRandom(index * 5.3) * Math.PI * 2;
        radius = Math.pow(pseudoRandom(index * 4.4), 0.5) * maxRadius * 4;
    } else {
        z = (timeProgress - 0.5) * tunnelLength;
        angle = pseudoRandom(index * 11.1 + timestamp) * Math.PI * 2;
        const radiusSpread = 2.0; // Organic spread
        radius = Math.pow(pseudoRandom(index * 23.2 + timestamp), 0.5) * maxRadius * radiusSpread; 
    }
    
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    
    return new THREE.Vector3(x, y, z);
}

function calculateNebulaDiskPosition(index: number, count: number, timestamp: number, minTime: number, maxTime: number, overrideTotalScale?: number, isDecorative: boolean = false) {
    const timeProgress = count <= 1 ? 0.5 : (timestamp - minTime) / (maxTime - minTime || 1);
    const effectiveTotal = overrideTotalScale || count;
    const maxRadius = getNebulaDiskRadius(effectiveTotal);

    const r1 = pseudoRandom(index * 17.17 + timestamp * 0.0001);
    const r2 = pseudoRandom(index * 31.31 + timestamp * 0.0002);
    const r3 = pseudoRandom(index * 47.47 + timestamp * 0.0003);
    const r4 = pseudoRandom(index * 61.61 + timestamp * 0.0004);

    const arms = 4; // 4 sweeping arms for a rich, complex structure
    const windiness = 2.0;

    let radius: number, angle: number, yVal: number;

    if (isDecorative) {
        const type = pseudoRandom(index * 9.9);
        
        if (type < 0.15) {
            // 1. Blazing Core (15%) - dense spherical bulge
            // Use proper spherical coordinates to guarantee a perfectly round core (no vertical bars)
            const coreRadius = Math.pow(r1, 1.2) * maxRadius * 0.12; // denser in center
            const theta = r2 * Math.PI * 2;
            const phi = Math.acos(2 * r3 - 1); // uniform distribution on sphere surface
            
            const x = coreRadius * Math.sin(phi) * Math.cos(theta);
            const y = coreRadius * Math.cos(phi) * 0.5; // flatten slightly into an oblate spheroid
            const z = coreRadius * Math.sin(phi) * Math.sin(theta);
            
            return new THREE.Vector3(x, y, z);
        } 
        else if (type < 0.55) {
            // 2. Dense Inner Arms (40%) - tightly bound to mathematical spiral line
            const radProgress = Math.pow(r1, 0.8);
            radius = maxRadius * 0.02 + radProgress * maxRadius * 0.8;
            const armPhase = (index % arms) * (Math.PI * 2 / arms);
            angle = windiness * Math.log(1 + radius / 0.1) + armPhase;
            
            // Tight scatter
            angle += (r2 - 0.5) * 0.25;
            radius += (r3 - 0.5) * maxRadius * 0.04;
            yVal = (r4 - 0.5) * maxRadius * 0.015;
        } 
        else if (type < 0.85) {
            // 3. Wide Diffuse Dust Lanes (30%) - creates volumetric depth
            const radProgress = Math.pow(r1, 0.8);
            radius = maxRadius * 0.02 + radProgress * maxRadius * 0.95;
            const armPhase = (index % arms) * (Math.PI * 2 / arms);
            angle = windiness * Math.log(1 + radius / 0.1) + armPhase;
            
            // Wide scatter
            angle += (r2 - 0.5) * 1.0;
            radius += (r3 - 0.5) * maxRadius * 0.12;
            yVal = (r4 - 0.5) * maxRadius * 0.04;
        } 
        else {
            // 4. Background Halo/Disk (15%) - scattered faint stars filling gaps
            radius = Math.pow(r1, 1.2) * maxRadius;
            angle = r2 * Math.PI * 2;
            yVal = (r3 - 0.5) * maxRadius * 0.05;
        }
    } else {
        // Photos
        // We use the item's index fraction rather than its timestamp (timeProgress) to determine radius.
        // This ensures that even if there are huge time gaps between photos, they will still form 
        // a perfectly continuous, beautiful spiral without any empty rings.
        const tProgress = count <= 1 ? 0.5 : index / count;
        const t = Math.pow(tProgress, 1.2); 
        radius = maxRadius * 0.05 + t * maxRadius * 0.65;
        const armPhase = (index % arms) * (Math.PI * 2 / arms);
        angle = windiness * Math.log(1 + radius / 0.1) + armPhase;
        
        // 30% of photos scatter wildly between arms, the rest stick somewhat close to the arms
        if (r3 < 0.3) {
            angle += (r2 - 0.5) * Math.PI * 2; // completely random angle for 30%
        } else {
            angle += (r2 - 0.5) * 0.8; // fairly wide scatter for the rest
        }
        
        yVal = (r4 - 0.5) * 0.5;
    }

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    return new THREE.Vector3(x, yVal, z);
}

function getPositionForShape(shape: GalaxyShape, index: number, count: number, timestamp: number, minTime: number, maxTime: number, overrideTotalScale?: number, isDecorative: boolean = false) {
    if (shape === "spiral") {
        return calculateSpiralPosition(index, count, timestamp, minTime, maxTime, overrideTotalScale, isDecorative);
    }
    if (shape === "avenue") {
        return calculateAvenuePosition(index, count, timestamp, minTime, maxTime, overrideTotalScale, isDecorative);
    }
    return calculateNebulaDiskPosition(index, count, timestamp, minTime, maxTime, overrideTotalScale, isDecorative);
}

function GalaxyDust({ photoCount, shape }: { photoCount: number, shape: GalaxyShape }) {
    const isNebula = shape === "nebula-disk";
    const { positions, colors } = useMemo(() => {
        const count = isNebula ? 120000 : 17000;
        const posArray = new Float32Array(count * 3);
        const colArray = new Float32Array(count * 3);
        
        for (let i = 0; i < count; i++) {
            if (isNebula) {
                const maxRadius = getNebulaDiskRadius(photoCount);
                const pos = calculateNebulaDiskPosition(i, count, i, 0, count, photoCount, true);
                
                posArray[i * 3] = pos.x;
                posArray[i * 3 + 1] = pos.y;
                posArray[i * 3 + 2] = pos.z;
                
                const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
                const normalizedDist = Math.min(1.0, dist / maxRadius);
                let color = new THREE.Color();
                
                // Base dramatic HDR gradient
                if (normalizedDist < 0.1) {
                    // Core: Blazing hot Gold to Magenta
                    color.lerpColors(new THREE.Color("#ffddaa"), new THREE.Color("#ff3366"), normalizedDist / 0.1);
                } else if (normalizedDist < 0.3) {
                    // Inner transition: Magenta to Deep Purple
                    const t = (normalizedDist - 0.1) / 0.2;
                    color.lerpColors(new THREE.Color("#ff3366"), new THREE.Color("#9900ff"), t);
                } else if (normalizedDist < 0.7) {
                    // Main arms: Purple to Electric Cyan
                    const t = (normalizedDist - 0.3) / 0.4;
                    color.lerpColors(new THREE.Color("#9900ff"), new THREE.Color("#00ffff"), t);
                } else {
                    // Outer edges: Cyan fading into Deep Midnight Blue
                    const t = (normalizedDist - 0.7) / 0.3;
                    color.lerpColors(new THREE.Color("#00ffff"), new THREE.Color("#001144"), t);
                }

                // Sculpting the volume by selectively dimming/brightening particles
                const type = pseudoRandom(i * 9.9);
                if (type < 0.15) {
                    // Core Bulge - Bright but not blown out white
                    color.multiplyScalar(0.35); 
                } else if (type < 0.55) {
                    // Dense inner arms - mix of dark dust and bright stars
                    if (pseudoRandom(i * 7.7) < 0.15) {
                        // Diamond highlights in the arms
                        color.lerp(new THREE.Color("#ffffff"), 0.8);
                        color.multiplyScalar(0.9);
                    } else {
                        color.multiplyScalar(0.2);
                    }
                } else if (type < 0.85) {
                    // Diffuse Wide Dust - very faint volumetric glow
                    color.multiplyScalar(0.06);
                } else {
                    // Background Halo - nearly invisible, just adding depth
                    color.multiplyScalar(0.02);
                }
                
                // Add dramatic dark matter dust lanes (random patches that are pure black)
                if (pseudoRandom(i * 123.4) < 0.25) { 
                    color.multiplyScalar(0.01);
                }
                
                colArray[i * 3] = color.r;
                colArray[i * 3 + 1] = color.g;
                colArray[i * 3 + 2] = color.b;

            } else {
                const pos = getPositionForShape(shape, i, count, i, 0, count, photoCount, true);
                posArray[i * 3] = pos.x;
                posArray[i * 3 + 1] = pos.y;
                posArray[i * 3 + 2] = pos.z;
                
                let color = getColorForTimeProgress(pseudoRandom(i * 3.17));
                if (pseudoRandom(i * 15.3) < 0.03) {
                    color = new THREE.Color(pseudoRandom(i) < 0.5 ? "#ffffff" : "#cffafe");
                    color.multiplyScalar(1.5);
                } else {
                    color.multiplyScalar(0.14 + pseudoRandom(i * 19.9) * 0.62);
                }
                colArray[i * 3] = color.r;
                colArray[i * 3 + 1] = color.g;
                colArray[i * 3 + 2] = color.b;
            }
        }
        
        return { positions: posArray, colors: colArray };
    }, [shape, photoCount]);

    const ref = useRef<THREE.Points>(null);
    const texture = useMemo(() => isNebula ? createNebulaGlowTexture() : createGlowTexture(), [isNebula]);

    useFrame((state, delta) => {
        if (ref.current && (shape === 'spiral' || shape === 'nebula-disk')) {
            ref.current.rotation.y += delta * (isNebula ? 0.012 : 0.05);
        }
    });

    return (
        <group>
            {shape === 'spiral' && (
                <pointLight position={[0,0,0]} intensity={1.2} color="#fff1f2" distance={50} decay={2} />
            )}
            {isNebula && (
                <pointLight position={[0,0,0]} intensity={1.0} color="#ffe5b5" distance={70} decay={2.2} />
            )}
            <points ref={ref} key={shape}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" count={positions.length / 3} array={positions} itemSize={3} />
                    <bufferAttribute attach="attributes-color" count={colors.length / 3} array={colors} itemSize={3} />
                </bufferGeometry>
                <pointsMaterial
                    size={isNebula ? 1.5 : 0.5}
                    vertexColors
                    map={texture}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                    opacity={isNebula ? 0.3 : 0.62}
                    sizeAttenuation={true}
                />
            </points>
        </group>
    );
}

function Particles({ photos, activeMonth, galaxyShape, onPhotoClick }: Galaxy3DProps) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const isNebulaDisk = galaxyShape === "nebula-disk";
    
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const colorDummy = useMemo(() => new THREE.Color(), []);
    
    const { positions, colors } = useMemo(() => {
        if (photos.length === 0) return { positions: [], colors: [] };
        
        const minTime = Math.min(...photos.map(p => p.timestamp));
        const maxTime = Math.max(...photos.map(p => p.timestamp));
        
        const posArray: THREE.Vector3[] = [];
        const colArray: Float32Array = new Float32Array(photos.length * 3);
        
        photos.forEach((photo, i) => {
            // Calculate base position
            let pos;
            pos = getPositionForShape(galaxyShape, i, photos.length, photo.timestamp, minTime, maxTime);
            posArray.push(pos);
            
            // Photo stars sit above the dust field. In nebula-disk mode they stay brighter
            // and slightly more colorful so every image remains visible in overview.
            let baseColor = galaxyShape === "nebula-disk"
                ? getColorForTimeProgress(pseudoRandom(i * 5.43 + photo.timestamp * 0.00001))
                : getColorForTimeProgress(pseudoRandom(i * 5.43 + photo.timestamp * 0.00001));
            baseColor.multiplyScalar(galaxyShape === "nebula-disk"
                ? 1.25 + pseudoRandom(i * 7.77) * 0.55
                : 0.7 + pseudoRandom(i * 7.77) * 0.3);
            baseColor.toArray(colArray, i * 3);
        });
        
        return { positions: posArray, colors: colArray };
    }, [photos, galaxyShape]);

    // Target positions for smooth animation
    const targetPositions = useRef<THREE.Vector3[]>([]);
    const currentPositions = useRef<THREE.Vector3[]>([]);
    
    // State for close-up thumbnails
    const [closestPhotos, setClosestPhotos] = useState<number[]>([]);
    const lastCheck = useRef(0);
    
    useEffect(() => {
        targetPositions.current = positions;
        if (currentPositions.current.length !== positions.length) {
            // First render or photo count changed: jump directly
            currentPositions.current = positions.map(p => p.clone());
        }
    }, [positions]);

    useFrame((state, delta) => {
        if (!meshRef.current || currentPositions.current.length === 0) return;
        
        const instancedMesh = meshRef.current;
        let needsUpdate = false;
        
        // Throttled distance check for thumbnails (every 200ms)
        if (state.clock.elapsedTime - lastCheck.current > 0.2) {
            lastCheck.current = state.clock.elapsedTime;
            const camPos = state.camera.position;
            const distances = [];
            const threshold = isNebulaDisk ? 6400 : 900; // 80 units for nebula, 30 for others
            for (let i = 0; i < photos.length; i++) {
                const dist = camPos.distanceToSquared(currentPositions.current[i]);
                if (dist < threshold) {
                    distances.push({ index: i, dist });
                }
            }
            distances.sort((a, b) => a.dist - b.dist);
            const top = distances.slice(0, 40).map(d => d.index);
            
            setClosestPhotos(prev => {
                if (prev.length !== top.length) return top;
                for (let i=0; i<top.length; i++) {
                    if (prev[i] !== top[i]) return top;
                }
                return prev;
            });
        }
        
        const closestPhotosSet = new Set(closestPhotos);
        
        for (let i = 0; i < photos.length; i++) {
            const current = currentPositions.current[i];
            const target = targetPositions.current[i];
            
            // Smoothly move towards target
            if (current.distanceToSquared(target) > 0.001) {
                current.lerp(target, Math.min(delta * 2, 1));
                needsUpdate = true;
            }
            
            // Rotate the entire galaxy slowly if in spiral mode
            if (galaxyShape === 'spiral' || galaxyShape === 'nebula-disk') {
                const angle = delta * (isNebulaDisk ? 0.012 : 0.015);
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const x = current.x * cos - current.z * sin;
                const z = current.x * sin + current.z * cos;
                current.x = x;
                current.z = z;
                // Target needs to be rotated as well so lerp doesn't fight it
                const targetX = target.x;
                const targetZ = target.z;
                target.x = targetX * cos - targetZ * sin;
                target.z = targetX * sin + targetZ * cos;
                needsUpdate = true;
            }
            
            // Update instance matrix
            
            const time = state.clock.elapsedTime;
            const floatOffset = Math.sin(time * 1.5 + i) * 0.4;
            
            // Apply float offset temporarily for matrix calculation
            dummy.position.copy(current);
            dummy.position.y += floatOffset;
            
            // Scale logic:
            let scale = 1.0;
            const photo = photos[i];
            
            if (closestPhotosSet.has(i)) {
                // Hide the base dust sphere completely if it's currently rendered as a detailed PhotoSprite
                scale = 0;
            } else {
                const isActiveMonth = activeMonth === "all" || photo.month === activeMonth;
                if (!isActiveMonth) {
                    scale = isNebulaDisk ? 0.3 : 0.3; 
                } else {
                    scale = isNebulaDisk ? 0.8 : 1.0; 
                }
                
                // Prevent the sphere from becoming gigantic when the camera flies through it
                const dist = state.camera.position.distanceTo(current);
                const maxScale = (0.04 * dist) / 0.16;
                scale = Math.min(scale, maxScale);
                
                if (i === hoveredIdx) {
                    scale *= isNebulaDisk ? 1.2 + Math.sin(time * 6) * 0.1 : 1.5 + Math.sin(time * 6) * 0.3; // Glow and pulse
                } else {
                    scale *= 1.0 + Math.sin(time * 2 + i) * (isNebulaDisk ? 0.02 : 0.15); // Gentle breathing
                }
            }
            
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(i, dummy.matrix);
            
            // Color logic: dim non-active
            colorDummy.fromArray(colors, i * 3);
            const isActiveMonth = activeMonth === "all" || photo.month === activeMonth;
            if (!isActiveMonth) {
                colorDummy.multiplyScalar(isNebulaDisk ? 0.35 : 0.2);
            } else if (i === hoveredIdx) {
                colorDummy.setHex(0xffffff); // Hover becomes pure white glow
            }
            instancedMesh.setColorAt(i, colorDummy);
        }
        
        if (needsUpdate || hoveredIdx !== null || activeMonth) {
            instancedMesh.instanceMatrix.needsUpdate = true;
            if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
        }
    });

    const hoveredPhoto = hoveredIdx !== null ? photos[hoveredIdx] : null;

    return (
        <group>
            <instancedMesh
                ref={meshRef}
                args={[undefined, undefined, photos.length]}
                onPointerMove={(e) => {
                    e.stopPropagation();
                    if (e.instanceId !== undefined && e.instanceId !== hoveredIdx) {
                        setHoveredIdx(e.instanceId);
                        setCssProps(document.body, { cursor: 'pointer' });
                    }
                }}
                onPointerOut={(e) => {
                    e.stopPropagation();
                    setHoveredIdx(null);
                    setCssProps(document.body, { cursor: 'auto' });
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    if (e.instanceId !== undefined) {
                        onPhotoClick(photos[e.instanceId]);
                    }
                }}
            >
                <sphereGeometry args={[0.2, 16, 16]} />
                <meshBasicMaterial toneMapped={false} transparent opacity={isNebulaDisk ? 0.9 : 0.7} blending={isNebulaDisk ? THREE.NormalBlending : THREE.AdditiveBlending} depthWrite={false} />
            </instancedMesh>
            
            {/* True 3D Sprites for Close-up Thumbnails */}
            {closestPhotos.map(idx => {
                const photo = photos[idx];
                const pos = currentPositions.current[idx];
                if (!pos) return null;
                const isHovered = hoveredIdx === idx;
                
                return (
                    <PhotoSprite 
                        key={photo.id}
                        photo={photo}
                        pos={pos}
                        isHovered={isHovered}
                        onClick={onPhotoClick}
                        onHover={() => setHoveredIdx(idx)}
                        onLeave={() => setHoveredIdx(null)}
                    />
                );
            })}
            
            {/* Render Hovered Star if it's not in closestPhotos (e.g. hovered via other means) */}
            {hoveredPhoto && hoveredIdx !== null && !closestPhotos.includes(hoveredIdx) && currentPositions.current[hoveredIdx] && (
                <PhotoSprite 
                    key={hoveredPhoto.id}
                    photo={hoveredPhoto}
                    pos={currentPositions.current[hoveredIdx]}
                    isHovered={true}
                    onClick={onPhotoClick}
                    onHover={() => setHoveredIdx(hoveredIdx)}
                    onLeave={() => setHoveredIdx(null)}
                />
            )}
        </group>
    );
}

export default function Galaxy3D(props: Galaxy3DProps) {
    const isNebulaDisk = props.galaxyShape === "nebula-disk";
    const nebulaRadius = getNebulaDiskRadius(props.photos.length);
    const nebulaCameraPosition: [number, number, number] = [0, nebulaRadius * 0.78, nebulaRadius * 2.7];
    const nebulaFogNear = nebulaRadius * 1.45;
    const nebulaFogFar = nebulaRadius * 5.2;
    return (
        <div className="w-full h-full absolute inset-0 bg-[#020204]">
            <Canvas
                camera={{
                    position: isNebulaDisk ? nebulaCameraPosition : [0, 25, 60],
                    fov: isNebulaDisk ? 42 : 45
                }}
                dpr={[1, 2.5]}
            >
                <color attach="background" args={["#020204"]} />
                <fog attach="fog" args={["#020204", isNebulaDisk ? nebulaFogNear : 30, isNebulaDisk ? nebulaFogFar : 180]} />
                
                <ambientLight intensity={isNebulaDisk ? 0.25 : 0.5} />
                
                <Stars
                    radius={110}
                    depth={50}
                    count={isNebulaDisk ? 1800 : 6000}
                    factor={isNebulaDisk ? 1.8 : 4}
                    saturation={isNebulaDisk ? 0.2 : 1}
                    fade
                    speed={0.5}
                />
                
                <GalaxyDust photoCount={props.photos.length} shape={props.galaxyShape} />
                
                <Particles {...props} />
                
                <OrbitControls 
                    enableDamping 
                    dampingFactor={0.05} 
                    minDistance={isNebulaDisk ? Math.max(8, nebulaRadius * 0.18) : 5} 
                    maxDistance={isNebulaDisk ? nebulaRadius * 5 : 150} 
                    autoRotate={true}
                    autoRotateSpeed={isNebulaDisk ? 0.06 : 0.15}
                />
            </Canvas>
        </div>
    );
}
