import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  Activity,
  Cog,
  Drill,
  Globe,
  Maximize2,
  Minimize2,
  Moon,
  Mountain,
  Radar,
  Truck,
  X,
} from 'lucide-react';
import {
  computeScenarioMetrics,
  computeScreenSpaceCalloutLayout,
  computeShovelKinematics,
  formatSimClock,
  getAssetCalloutTelemetry,
  getBenchRadius,
  type MiningAssetId,
  type MineTelemetryState,
  type ScenarioState,
  type TruckFsmPhase,
  type TruckTelemetry,
} from './utils/mineSimulation';

export type { MiningAssetId };

type LightingPreset = 'noon' | 'sunset' | 'night';

const INITIAL_TRUCKS: TruckTelemetry[] = [
  {
    id: 'truck-01',
    name: 'CAT 793F #01',
    shovel: 'EX-01 (+280м, Малахит)',
    bench: '+280м',
    payload: 227,
    grade: 0.64,
    speed: 14.5,
    state: 'HAULING',
    fsmPhase: 'HAULING_UP',
    oreType: 'malachite',
    tirePressureBar: 7.4,
    tkph: 518,
    fuelLph: 328,
    etaMin: 1.4,
  },
  {
    id: 'truck-02',
    name: 'CAT 793F #02',
    shovel: 'EX-01 (+280м, Малахит)',
    bench: '+280м',
    payload: 105,
    grade: 0.64,
    speed: 0.0,
    state: 'HAULING',
    fsmPhase: 'LOADING',
    oreType: 'malachite',
    tirePressureBar: 7.5,
    tkph: 509,
    fuelLph: 45,
    etaMin: 3.6,
  },
  {
    id: 'truck-03',
    name: 'CAT 793F #03',
    shovel: 'EX-02 (+220м, Халькопирит)',
    bench: '+220м',
    payload: 227,
    grade: 0.40,
    speed: 0.0,
    state: 'HAULING',
    fsmPhase: 'DUMPING',
    oreType: 'sulfide',
    tirePressureBar: 7.4,
    tkph: 512,
    fuelLph: 60,
    etaMin: 0.1,
  },
  {
    id: 'truck-04',
    name: 'CAT 793F #04',
    shovel: 'EX-02 (+220м, Халькопирит)',
    bench: '+220м',
    payload: 0,
    grade: 0.40,
    speed: 28.0,
    state: 'RETURNING',
    fsmPhase: 'RETURNING_EMPTY',
    oreType: 'sulfide',
    tirePressureBar: 7.3,
    tkph: 486,
    fuelLph: 88,
    etaMin: 4.6,
  },
  {
    id: 'truck-05',
    name: 'CAT 793F #05',
    shovel: 'EX-03 (+310м, Вскрыша)',
    bench: '+310м',
    payload: 227,
    grade: 0.08,
    speed: 14.5,
    state: 'HAULING',
    fsmPhase: 'HAULING_UP',
    oreType: 'overburden',
    tirePressureBar: 7.4,
    tkph: 498,
    fuelLph: 328,
    etaMin: 2.0,
  },
];

// --- PROCEDURAL PBR TEXTURE GENERATORS ---

function createSoftParticleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255, 250, 242, 1.0)');
  grad.addColorStop(0.35, 'rgba(235, 220, 198, 0.68)');
  grad.addColorStop(0.7, 'rgba(205, 185, 160, 0.22)');
  grad.addColorStop(1, 'rgba(180, 160, 135, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface RockStrataOptions {
  baseHex: string;
  darkHex: string;
  lightHex: string;
  veinPrimaryHex?: string;
  veinSecondaryHex?: string;
  veinDensity?: number;
  blastMarks?: boolean;
}

function createRockStrataTextures(
  opts: RockStrataOptions,
  maxAnisotropy: number
): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const width = 512;
  const height = 256;

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = width;
  colorCanvas.height = height;
  const cCtx = colorCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = width;
  bumpCanvas.height = height;
  const bCtx = bumpCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const rCtx = roughCanvas.getContext('2d')!;

  cCtx.fillStyle = opts.baseHex;
  cCtx.fillRect(0, 0, width, height);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, width, height);

  rCtx.fillStyle = '#e0e0e0';
  rCtx.fillRect(0, 0, width, height);

  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let y = 0; y < height; y += 3) {
    const wave = Math.sin(y * 0.14) * 4 + Math.cos(y * 0.05) * 3;
    const isDark = rand() > 0.48;
    cCtx.fillStyle = isDark ? opts.darkHex : opts.lightHex;
    cCtx.globalAlpha = 0.18 + rand() * 0.26;
    cCtx.beginPath();
    cCtx.moveTo(0, y);
    for (let x = 0; x <= width; x += 32) {
      const dy = Math.sin(x * 0.025 + y * 0.1) * 3.5 + wave * 0.3;
      cCtx.lineTo(x, y + dy);
    }
    cCtx.lineTo(width, y + 4 + rand() * 6);
    cCtx.lineTo(0, y + 4 + rand() * 6);
    cCtx.closePath();
    cCtx.fill();

    bCtx.fillStyle = isDark ? '#505050' : '#b8b8b8';
    bCtx.globalAlpha = 0.25;
    bCtx.fillRect(0, y, width, 2 + rand() * 3);
  }

  cCtx.globalAlpha = 1.0;
  for (let i = 0; i < 95; i++) {
    const x0 = rand() * width;
    const y0 = rand() * height;
    const len = 18 + rand() * 55;
    const angle = (rand() - 0.5) * 0.5 + Math.PI / 2;

    cCtx.strokeStyle = opts.darkHex;
    cCtx.lineWidth = 0.8 + rand() * 1.8;
    cCtx.globalAlpha = 0.35;
    cCtx.beginPath();
    cCtx.moveTo(x0, y0);
    cCtx.lineTo(x0 + Math.cos(angle) * len * 0.5 + (rand() - 0.5) * 8, y0 + Math.sin(angle) * len * 0.5);
    cCtx.lineTo(x0 + Math.cos(angle) * len, y0 + Math.sin(angle) * len);
    cCtx.stroke();

    bCtx.strokeStyle = '#262626';
    bCtx.lineWidth = 1.5 + rand() * 2.0;
    bCtx.globalAlpha = 0.55;
    bCtx.beginPath();
    cCtx.moveTo(x0, y0);
    cCtx.lineTo(x0 + Math.cos(angle) * len, y0 + Math.sin(angle) * len);
    bCtx.stroke();
  }

  if (opts.blastMarks !== false) {
    for (let x = 16; x < width; x += 28) {
      cCtx.strokeStyle = opts.darkHex;
      cCtx.lineWidth = 2.0;
      cCtx.globalAlpha = 0.22;
      cCtx.beginPath();
      cCtx.moveTo(x, 8);
      cCtx.lineTo(x + (rand() - 0.5) * 3, height - 12);
      cCtx.stroke();

      bCtx.strokeStyle = '#383838';
      bCtx.lineWidth = 2.5;
      bCtx.globalAlpha = 0.35;
      bCtx.beginPath();
      cCtx.moveTo(x, 8);
      cCtx.lineTo(x, height - 12);
      bCtx.stroke();
    }
  }

  const veinCount = Math.floor((opts.veinDensity ?? 0) * 65);
  for (let v = 0; v < veinCount; v++) {
    const startX = rand() * width;
    const startY = rand() * height;
    const isSecondary = opts.veinSecondaryHex && rand() > 0.62;
    const veinColor = isSecondary ? opts.veinSecondaryHex! : (opts.veinPrimaryHex || '#10b981');

    cCtx.strokeStyle = veinColor;
    cCtx.lineWidth = 1.4 + rand() * 3.8;
    cCtx.globalAlpha = 0.55 + rand() * 0.4;
    cCtx.beginPath();
    let cx = startX;
    let cy = startY;
    cCtx.moveTo(cx, cy);
    const segments = 5 + Math.floor(rand() * 6);
    for (let s = 0; s < segments; s++) {
      cx += (rand() - 0.3) * 28;
      cy += (rand() - 0.5) * 22;
      cCtx.lineTo(cx, cy);
    }
    cCtx.stroke();

    rCtx.strokeStyle = '#555555';
    rCtx.lineWidth = 2.5 + rand() * 4.0;
    rCtx.globalAlpha = 0.75;
    rCtx.beginPath();
    rCtx.moveTo(startX, startY);
    rCtx.lineTo(cx, cy);
    rCtx.stroke();

    bCtx.strokeStyle = '#dcdcdc';
    bCtx.lineWidth = 1.5;
    bCtx.globalAlpha = 0.45;
    bCtx.beginPath();
    bCtx.moveTo(startX, startY);
    bCtx.lineTo(cx, cy);
    bCtx.stroke();
  }

  for (let g = 0; g < 1200; g++) {
    const gx = rand() * width;
    const gy = rand() * height;
    const sz = 1 + rand() * 2.5;
    cCtx.fillStyle = rand() > 0.5 ? opts.lightHex : opts.darkHex;
    cCtx.globalAlpha = 0.16;
    cCtx.fillRect(gx, gy, sz, sz);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return { map, bumpMap, roughnessMap };
}

function createHaulRoadTextures(maxAnisotropy: number): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const w = 256;
  const h = 512;

  const cCan = document.createElement('canvas');
  cCan.width = w;
  cCan.height = h;
  const cCtx = cCan.getContext('2d')!;

  const bCan = document.createElement('canvas');
  bCan.width = w;
  bCan.height = h;
  const bCtx = bCan.getContext('2d')!;

  const rCan = document.createElement('canvas');
  rCan.width = w;
  rCan.height = h;
  const rCtx = rCan.getContext('2d')!;

  // Base dry steppe dust & crushed porphyry gravel (#544738 / #42372c) — zero highway markings
  cCtx.fillStyle = '#544738';
  cCtx.fillRect(0, 0, w, h);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, w, h);

  rCtx.fillStyle = '#e6e6e6';
  rCtx.fillRect(0, 0, w, h);

  // Dust drift accumulation toward road shoulders and compacted center crown
  const grad = cCtx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0.0, '#786855');
  grad.addColorStop(0.12, '#544738');
  grad.addColorStop(0.28, '#42372c');
  grad.addColorStop(0.5, '#594b3c');
  grad.addColorStop(0.72, '#42372c');
  grad.addColorStop(0.88, '#544738');
  grad.addColorStop(1.0, '#786855');
  cCtx.fillStyle = grad;
  cCtx.fillRect(0, 0, w, h);

  // Dual heavy 40.00R57 haul tire ruts with two distinct lane tracks (+2.85m and -2.85m)
  const rutX = [w * 0.17, w * 0.33, w * 0.67, w * 0.83];
  rutX.forEach((rx) => {
    const rutGrad = cCtx.createLinearGradient(rx - 14, 0, rx + 14, 0);
    rutGrad.addColorStop(0, 'rgba(66, 55, 44, 0.0)');
    rutGrad.addColorStop(0.25, 'rgba(52, 43, 34, 0.78)');
    rutGrad.addColorStop(0.5, 'rgba(42, 34, 27, 0.92)');
    rutGrad.addColorStop(0.75, 'rgba(52, 43, 34, 0.78)');
    rutGrad.addColorStop(1, 'rgba(66, 55, 44, 0.0)');
    cCtx.fillStyle = rutGrad;
    cCtx.fillRect(rx - 14, 0, 28, h);

    // Compacted lower roughness in wheel ruts
    rCtx.fillStyle = '#969696';
    rCtx.fillRect(rx - 10, 0, 20, h);

    // Recessed rut channel in bump map + chevron herringbone lug impressions
    bCtx.fillStyle = '#5c5c5c';
    bCtx.fillRect(rx - 10, 0, 20, h);

    bCtx.strokeStyle = '#363636';
    bCtx.lineWidth = 2.8;
    cCtx.strokeStyle = 'rgba(34, 28, 22, 0.35)';
    cCtx.lineWidth = 1.8;
    for (let y = 0; y < h; y += 10) {
      bCtx.beginPath();
      bCtx.moveTo(rx - 10, y);
      bCtx.lineTo(rx, y + 5);
      bCtx.lineTo(rx + 10, y);
      bCtx.stroke();

      cCtx.beginPath();
      cCtx.moveTo(rx - 9, y);
      cCtx.lineTo(rx, y + 4.5);
      cCtx.lineTo(rx + 9, y);
      cCtx.stroke();
    }
  });

  // Crushed rock aggregate & porphyry scree grit across haul surface
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 2600; i++) {
    const gx = rand() * w;
    const gy = rand() * h;
    const sz = 1 + rand() * 2.8;
    cCtx.fillStyle = rand() > 0.55 ? '#6e5e4d' : '#332a21';
    cCtx.globalAlpha = 0.28;
    cCtx.fillRect(gx, gy, sz, sz);

    bCtx.fillStyle = rand() > 0.5 ? '#bababa' : '#4a4a4a';
    bCtx.globalAlpha = 0.34;
    bCtx.fillRect(gx, gy, sz, sz);
  }
  cCtx.globalAlpha = 1.0;
  bCtx.globalAlpha = 1.0;

  const map = new THREE.CanvasTexture(cCan);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 28);
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bCan);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(1, 28);
  bumpMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(rCan);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(1, 28);
  roughnessMap.anisotropy = maxAnisotropy;

  return { map, bumpMap, roughnessMap };
}

function createCatEquipmentTextures(maxAnisotropy: number): {
  catPaintMap: THREE.CanvasTexture;
  catRoughnessMap: THREE.CanvasTexture;
  tireMap: THREE.CanvasTexture;
  tireBumpMap: THREE.CanvasTexture;
} {
  const pCan = document.createElement('canvas');
  pCan.width = 256;
  pCan.height = 256;
  const pCtx = pCan.getContext('2d')!;

  const rCan = document.createElement('canvas');
  rCan.width = 256;
  rCan.height = 256;
  const rCtx = rCan.getContext('2d')!;

  pCtx.fillStyle = '#eab308';
  pCtx.fillRect(0, 0, 256, 256);

  rCtx.fillStyle = '#585858';
  rCtx.fillRect(0, 0, 256, 256);

  for (let x = 16; x < 256; x += 32) {
    pCtx.fillStyle = '#ca8a04';
    pCtx.fillRect(x, 0, 6, 256);
    pCtx.fillStyle = '#fde047';
    pCtx.fillRect(x + 6, 0, 2, 256);

    rCtx.fillStyle = '#999999';
    rCtx.fillRect(x, 0, 8, 256);
  }

  const dustGrad = pCtx.createLinearGradient(0, 150, 0, 256);
  dustGrad.addColorStop(0, 'rgba(120, 98, 74, 0.0)');
  dustGrad.addColorStop(0.65, 'rgba(115, 94, 70, 0.45)');
  dustGrad.addColorStop(1, 'rgba(92, 75, 56, 0.78)');
  pCtx.fillStyle = dustGrad;
  pCtx.fillRect(0, 150, 256, 106);

  const roughGrad = rCtx.createLinearGradient(0, 150, 0, 256);
  roughGrad.addColorStop(0, 'rgba(220, 220, 220, 0.0)');
  roughGrad.addColorStop(1, 'rgba(240, 240, 240, 0.9)');
  rCtx.fillStyle = roughGrad;
  rCtx.fillRect(0, 150, 256, 106);

  pCtx.fillStyle = '#18181b';
  pCtx.fillRect(0, 28, 256, 14);
  pCtx.fillStyle = '#facc15';
  pCtx.font = 'bold 11px monospace';
  pCtx.fillText('CAT 793F   KAZ MINERALS   AKTOGAY', 12, 39);

  const tCan = document.createElement('canvas');
  tCan.width = 256;
  tCan.height = 256;
  const tCtx = tCan.getContext('2d')!;

  const tbCan = document.createElement('canvas');
  tbCan.width = 256;
  tbCan.height = 256;
  const tbCtx = tbCan.getContext('2d')!;

  tCtx.fillStyle = '#1c1917';
  tCtx.fillRect(0, 0, 256, 256);

  tbCtx.fillStyle = '#404040';
  tbCtx.fillRect(0, 0, 256, 256);

  for (let y = 0; y < 256; y += 16) {
    tCtx.fillStyle = '#574c3f';
    tCtx.fillRect(0, y, 256, 5);

    tCtx.fillStyle = '#171717';
    tCtx.fillRect(0, y + 5, 118, 11);
    tCtx.fillRect(138, y + 9, 118, 11);

    tbCtx.fillStyle = '#ececec';
    tbCtx.fillRect(0, y + 5, 118, 11);
    tbCtx.fillRect(138, y + 9, 118, 11);
  }

  const catPaintMap = new THREE.CanvasTexture(pCan);
  catPaintMap.colorSpace = THREE.SRGBColorSpace;
  catPaintMap.anisotropy = maxAnisotropy;

  const catRoughnessMap = new THREE.CanvasTexture(rCan);
  catRoughnessMap.anisotropy = maxAnisotropy;

  const tireMap = new THREE.CanvasTexture(tCan);
  tireMap.colorSpace = THREE.SRGBColorSpace;
  tireMap.wrapS = tireMap.wrapT = THREE.RepeatWrapping;
  tireMap.anisotropy = maxAnisotropy;

  const tireBumpMap = new THREE.CanvasTexture(tbCan);
  tireBumpMap.wrapS = tireBumpMap.wrapT = THREE.RepeatWrapping;
  tireBumpMap.anisotropy = maxAnisotropy;

  return { catPaintMap, catRoughnessMap, tireMap, tireBumpMap };
}

function applyPolarRingUVs(
  geo: THREE.BufferGeometry,
  innerR: number,
  outerR: number,
  angularRepeats: number,
  radialRepeats: number
) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const angle = (Math.atan2(y, x) + Math.PI) / (Math.PI * 2);
    const r = Math.hypot(x, y);
    const rNorm = (r - innerR) / Math.max(0.001, outerR - innerR);
    uv.setXY(i, angle * angularRepeats, rNorm * radialRepeats);
  }
  uv.needsUpdate = true;
}

function createSteppeAndBermTextures(maxAnisotropy: number): {
  steppeMap: THREE.CanvasTexture;
  bermMap: THREE.CanvasTexture;
  sumpMap: THREE.CanvasTexture;
  shovelRedMap: THREE.CanvasTexture;
  shovelBlueMap: THREE.CanvasTexture;
} {
  const sCan = document.createElement('canvas');
  sCan.width = 512;
  sCan.height = 512;
  const sCtx = sCan.getContext('2d')!;
  sCtx.fillStyle = '#8b7965';
  sCtx.fillRect(0, 0, 512, 512);

  let seed = 901;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let y = 0; y < 512; y += 6) {
    sCtx.fillStyle = rand() > 0.5 ? '#7c6b57' : '#998772';
    sCtx.globalAlpha = 0.22;
    sCtx.fillRect(0, y, 512, 4 + rand() * 6);
  }
  for (let i = 0; i < 3200; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    sCtx.fillStyle = rand() > 0.65 ? '#5e5546' : rand() > 0.3 ? '#a3917b' : '#6c634e';
    sCtx.globalAlpha = 0.28;
    const r = 1 + rand() * 3.5;
    sCtx.fillRect(x, y, r, r);
  }

  const bCan = document.createElement('canvas');
  bCan.width = 512;
  bCan.height = 256;
  const bCtx = bCan.getContext('2d')!;
  bCtx.fillStyle = '#5c5044';
  bCtx.fillRect(0, 0, 512, 256);

  const bGrad = bCtx.createLinearGradient(0, 0, 0, 256);
  bGrad.addColorStop(0, '#4a3f35');
  bGrad.addColorStop(0.3, '#635649');
  bGrad.addColorStop(0.75, '#594d41');
  bGrad.addColorStop(1, '#3e352c');
  bCtx.fillStyle = bGrad;
  bCtx.fillRect(0, 0, 512, 256);

  for (let y = 36; y < 220; y += 22) {
    bCtx.fillStyle = '#42382f';
    bCtx.globalAlpha = 0.35;
    bCtx.fillRect(0, y, 512, 5);
  }
  for (let i = 0; i < 2400; i++) {
    bCtx.fillStyle = rand() > 0.5 ? '#786959' : '#382f27';
    bCtx.globalAlpha = 0.28;
    bCtx.fillRect(rand() * 512, rand() * 256, 2, 2);
  }

  const wCan = document.createElement('canvas');
  wCan.width = 256;
  wCan.height = 256;
  const wCtx = wCan.getContext('2d')!;
  const wGrad = wCtx.createRadialGradient(128, 128, 10, 128, 128, 125);
  wGrad.addColorStop(0, '#042f2e');
  wGrad.addColorStop(0.45, '#0f766e');
  wGrad.addColorStop(0.78, '#14b8a6');
  wGrad.addColorStop(0.92, '#5eead4');
  wGrad.addColorStop(1, '#44382e');
  wCtx.fillStyle = wGrad;
  wCtx.fillRect(0, 0, 256, 256);

  wCtx.strokeStyle = 'rgba(153, 246, 228, 0.28)';
  wCtx.lineWidth = 1.5;
  for (let r = 24; r < 115; r += 18) {
    wCtx.beginPath();
    wCtx.arc(128, 128, r, 0, Math.PI * 2);
    wCtx.stroke();
  }

  function makeShovelTex(mainColor: string, darkColor: string): THREE.CanvasTexture {
    const can = document.createElement('canvas');
    can.width = 256;
    can.height = 256;
    const ctx = can.getContext('2d')!;
    ctx.fillStyle = mainColor;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = darkColor;
    ctx.lineWidth = 2;
    for (let x = 32; x < 256; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }

    ctx.fillStyle = '#18181b';
    for (let y = 52; y < 145; y += 8) {
      ctx.fillRect(38, y, 76, 4);
      ctx.fillRect(142, y, 76, 4);
    }

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 168, 256, 22);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('CAT 7495   KAZ MINERALS', 24, 184);

    const dGrad = ctx.createLinearGradient(0, 190, 0, 256);
    dGrad.addColorStop(0, 'rgba(30, 25, 20, 0.0)');
    dGrad.addColorStop(1, 'rgba(45, 36, 28, 0.82)');
    ctx.fillStyle = dGrad;
    ctx.fillRect(0, 190, 256, 66);

    const t = new THREE.CanvasTexture(can);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAnisotropy;
    return t;
  }

  const steppeMap = new THREE.CanvasTexture(sCan);
  steppeMap.colorSpace = THREE.SRGBColorSpace;
  steppeMap.wrapS = steppeMap.wrapT = THREE.RepeatWrapping;
  steppeMap.anisotropy = maxAnisotropy;

  const bermMap = new THREE.CanvasTexture(bCan);
  bermMap.colorSpace = THREE.SRGBColorSpace;
  bermMap.wrapS = bermMap.wrapT = THREE.RepeatWrapping;
  bermMap.anisotropy = maxAnisotropy;

  const sumpMap = new THREE.CanvasTexture(wCan);
  sumpMap.colorSpace = THREE.SRGBColorSpace;
  sumpMap.anisotropy = maxAnisotropy;

  return {
    steppeMap,
    bermMap,
    sumpMap,
    shovelRedMap: makeShovelTex('#dc2626', '#991b1b'),
    shovelBlueMap: makeShovelTex('#2563eb', '#1e40af'),
  };
}

function applyGeologicalStrataShader(
  material: THREE.MeshStandardMaterial,
  mineralizationStrength: number,
  veinColorHex: number,
  secondaryVeinHex: number
) {
  const veinCol = new THREE.Color(veinColorHex);
  const secCol = new THREE.Color(secondaryVeinHex);
  const customUniforms = {
    uMineralStrength: { value: mineralizationStrength },
    uVeinColor: { value: veinCol },
    uSecVeinColor: { value: secCol },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMineralStrength = customUniforms.uMineralStrength;
    shader.uniforms.uVeinColor = customUniforms.uVeinColor;
    shader.uniforms.uSecVeinColor = customUniforms.uSecVeinColor;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPos;
         varying vec3 vWorldNormal;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vWorldNormal = normalize(mat3(modelMatrix) * normal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPos;
         varying vec3 vWorldNormal;
         uniform float uMineralStrength;
         uniform vec3 uVeinColor;
         uniform vec3 uSecVeinColor;

         float hash31(vec3 p) {
           p = fract(p * 0.1031);
           p += dot(p, p.yzx + 33.33);
           return fract((p.x + p.y) * p.z);
         }

         float noise3D(vec3 x) {
           vec3 i = floor(x);
           vec3 f = fract(x);
           f = f * f * (3.0 - 2.0 * f);
           return mix(
             mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
                 mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                 mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z
           );
         }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float faultShift = noise3D(vWorldPos * 0.045) * 4.2;
         float strataY = vWorldPos.y + faultShift;
         float strataBand = sin(strataY * 2.6) * 0.5 + 0.5;
         float fineLayer = sin(strataY * 9.5 + noise3D(vWorldPos * 0.25) * 3.0) * 0.5 + 0.5;

         diffuseColor.rgb *= mix(0.78, 1.14, strataBand * 0.65 + fineLayer * 0.35);

         if (uMineralStrength > 0.01) {
           float veinNoise1 = abs(sin(vWorldPos.x * 0.18 + vWorldPos.y * 0.55 + vWorldPos.z * 0.18 + noise3D(vWorldPos * 0.22) * 4.5));
           float veinMask1 = smoothstep(0.92 - uMineralStrength * 0.16, 0.995, 1.0 - veinNoise1);

           float veinNoise2 = abs(cos(vWorldPos.x * 0.27 - vWorldPos.y * 0.42 + vWorldPos.z * 0.24 + noise3D(vWorldPos * 0.31) * 3.8));
           float veinMask2 = smoothstep(0.94 - uMineralStrength * 0.12, 0.995, 1.0 - veinNoise2);

           diffuseColor.rgb = mix(diffuseColor.rgb, uVeinColor, veinMask1 * uMineralStrength * 0.88);
           diffuseColor.rgb = mix(diffuseColor.rgb, uSecVeinColor, veinMask2 * uMineralStrength * 0.72);
         }

         float upness = clamp(vWorldNormal.y, 0.0, 1.0);
         vec3 steppeDust = vec3(0.58, 0.49, 0.39);
         diffuseColor.rgb = mix(diffuseColor.rgb, steppeDust, smoothstep(0.45, 0.95, upness) * 0.32);`
      );
  };

  return customUniforms;
}

export default function AktogayTwinStudio() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Direct DOM refs for 60FPS screen-space callout & SVG leader line updates (zero React re-render lag)
  const calloutWrapperRef = useRef<HTMLDivElement | null>(null);
  const svgOverlayRef = useRef<SVGSVGElement | null>(null);
  const svgPolylineRef = useRef<SVGPolylineElement | null>(null);
  const svgAnchorDotRef = useRef<SVGCircleElement | null>(null);
  const svgAnchorHaloRef = useRef<SVGCircleElement | null>(null);
  const svgCardDotRef = useRef<SVGCircleElement | null>(null);

  const [telemetry, setTelemetry] = useState<MineTelemetryState>({
    simTimeMin: 124.5,
    feedGradeCu: 0.480,
    targetGradeCu: 0.480,
    minedTonnes: 4540,
    crusherTph: 2270,
    fleetFuelLph: 426,
    radarStatus: 'NORMAL',
    radarDispMmDay: 0.20,
    activeScenarios: {
      ex1Fail: false,
      roadBlock: false,
      dilution: false,
    },
    logs: [
      { time: '10:04', text: 'Система шихтовки руды Актогай активна. Целевое содержание Cu: 0.480%.', type: 'info' },
      { time: '09:52', text: 'Экскаватор EX-01 (+280м): отгрузка окисленной малахитовой руды 0.64% Cu.', type: 'success' },
      { time: '09:40', text: 'Георадар SSR-XT: борт карьера стабилен (смещение 0.20 мм/сут).', type: 'info' },
    ],
    trucks: INITIAL_TRUCKS,
  });

  // 1. Unified Asset Selection State (null in 'orbit' overview mode)
  const [selectedAsset, setSelectedAsset] = useState<MiningAssetId | null>(null);
  const [isCardMinimized, setIsCardMinimized] = useState<boolean>(false);
  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('night');
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [hudCollapsed, setHudCollapsed] = useState<boolean>(false);

  // Cinematic What-If Emergency Alert State (Sci-Fi HUD Banner & Vignette)
  const [emergencyAlert, setEmergencyAlert] = useState<{
    key: keyof ScenarioState;
    badge: string;
    title: string;
    subtitle: string;
    tone: 'amber' | 'red' | 'purple';
  } | null>(null);
  const emergencyTimerRef = useRef<number | null>(null);

  // Mutable ref so the 60FPS WebGL loop reads latest state without tearing down the canvas
  const simStateRef = useRef({
    selectedAsset: null as MiningAssetId | null,
    isCardMinimized: false,
    cameraTransitioning: false,
    truckInitialFlyIn: false,
    desiredCamPos: new THREE.Vector3(-82, 112, 238),
    desiredTarget: new THREE.Vector3(6, 12, -18),
    shakeIntensity: 0,
    shakeElapsed: 0,
    alertRemainSec: 0,
    targetFeedGradeCu: 0.480,
    lightingPreset: 'night' as LightingPreset,
    simSpeed: 1,
    scenarios: { ex1Fail: false, roadBlock: false, dilution: false } as ScenarioState,
  });

  const threeActionsRef = useRef<{
    selectAsset: (assetId: MiningAssetId | null) => void;
    setLightingMode: (preset: LightingPreset) => void;
    toggleScenario: (key: keyof ScenarioState) => void;
  }>({
    selectAsset: () => {},
    setLightingMode: () => {},
    toggleScenario: () => {},
  });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // --- 1. SOFTWARE-WEBGL GUARD & RENDERER CONFIG ---
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101d30);
    scene.fog = new THREE.FogExp2(0x101d30, 0.00038);

    const width = container.clientWidth || 1440;
    const height = container.clientHeight || 900;

    const camera = new THREE.PerspectiveCamera(44, width / height, 1.5, 4800);
    camera.position.set(-82, 112, 238);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.cursor = 'grab';
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    // Post-processing pipeline: RenderPass -> SSAOPass -> UnrealBloomPass -> OutputPass
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const ssaoPass = new SSAOPass(scene, camera, width, height);
    ssaoPass.kernelRadius = 4.5;
    ssaoPass.minDistance = 0.00005;
    ssaoPass.maxDistance = 0.0018;
    composer.addPass(ssaoPass);

    // Exclude translucent volumetric cones (SSR radar beam & headlight beams) from SSAO normal pass
    const ssaoExcludedObjects: THREE.Object3D[] = [];
    const origSsaoRender = ssaoPass.render.bind(ssaoPass);
    ssaoPass.render = (
      r: THREE.WebGLRenderer,
      writeBuffer: THREE.WebGLRenderTarget,
      readBuffer: THREE.WebGLRenderTarget,
      deltaTime: number,
      maskActive: boolean
    ) => {
      const prevVis = ssaoExcludedObjects.map((obj) => obj.visible);
      for (let i = 0; i < ssaoExcludedObjects.length; i++) {
        ssaoExcludedObjects[i].visible = false;
      }
      origSsaoRender(r, writeBuffer, readBuffer, deltaTime, maskActive);
      for (let i = 0; i < ssaoExcludedObjects.length; i++) {
        ssaoExcludedObjects[i].visible = prevVis[i];
      }
    };

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.24,
      0.55,
      0.84
    );
    composer.addPass(bloomPass);

    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2.04;
    controls.minDistance = 14;
    controls.maxDistance = 920;
    controls.target.set(6, 12, -18);

    // Stop camera position fly-in as soon as user manually orbits or zooms,
    // allowing free 360-degree OrbitControls inspection around moving trucks or static assets!
    controls.addEventListener('start', () => {
      simStateRef.current.cameraTransitioning = false;
      simStateRef.current.truckInitialFlyIn = false;
    });

    // --- 2. ATMOSPHERIC SKY DOME, STAR DOME, HORIZON AZIMUTH RING & STEPPE LIGHTING RIG ---
    const skyUniforms = {
      uTopColor: { value: new THREE.Color(0x040711) },
      uHorizonColor: { value: new THREE.Color(0x121f33) },
      uSunColor: { value: new THREE.Color(0x6495ed) },
      uSunDir: { value: new THREE.Vector3(-160, 220, -140).normalize() },
    };

    const skyDomeGeo = new THREE.SphereGeometry(3800, 32, 16);
    const skyDomeMat = new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldDir;
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        void main() {
          float h = clamp(vWorldDir.y, 0.0, 1.0);
          vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.48));
          float sunAmt = max(dot(vWorldDir, uSunDir), 0.0);
          col += uSunColor * pow(sunAmt, 20.0) * 0.32;
          col += uSunColor * smoothstep(0.996, 0.9996, sunAmt) * 1.2;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyDome = new THREE.Mesh(skyDomeGeo, skyDomeMat);
    scene.add(skyDome);

    // Night Star Dome: 800 twinkling stars in the upper hemisphere (y > 60m)
    const STAR_COUNT = 800;
    const starPositions = new Float32Array(STAR_COUNT * 3);
    const starPhases = new Float32Array(STAR_COUNT);
    const starSizes = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Deterministic pseudo-random distribution across upper sky dome
      const u1 = ((i * 137.508) % 360) * (Math.PI / 180);
      const elev = 0.06 + ((i * 73) % 94) / 100 * 1.42; // strictly above horizon (y > 60m)
      const r = 1950 + (i % 7) * 45;
      starPositions[i * 3] = r * Math.cos(elev) * Math.cos(u1);
      starPositions[i * 3 + 1] = Math.max(68, r * Math.sin(elev));
      starPositions[i * 3 + 2] = r * Math.cos(elev) * Math.sin(u1);
      starPhases[i] = (i * 0.83) % (Math.PI * 2);
      starSizes[i] = 1.6 + (i % 4) * 0.85;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));

    const starUniforms = {
      uTime: { value: 0 },
    };
    const starMat = new THREE.ShaderMaterial({
      uniforms: starUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aPhase;
        attribute float aSize;
        varying float vTwinkle;
        uniform float uTime;
        void main() {
          vTwinkle = 0.45 + 0.55 * sin(uTime * 2.2 + aPhase);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (1.0 + 0.25 * sin(uTime * 3.1 + aPhase));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vTwinkle;
        void main() {
          vec2 cxy = 2.0 * gl_PointCoord - 1.0;
          float r2 = dot(cxy, cxy);
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 4.2);
          vec3 starCol = mix(vec3(0.65, 0.86, 1.0), vec3(1.0, 0.98, 0.92), core);
          gl_FragColor = vec4(starCol, core * vTwinkle * 0.92);
        }
      `,
    });
    const starDomePoints = new THREE.Points(starGeo, starMat);
    starDomePoints.frustumCulled = false;
    scene.add(starDomePoints);
    ssaoExcludedObjects.push(starDomePoints);

    // Distant Cyberpunk Horizon Radar Azimuth Ring (#00f0ff, opacity 0.04)
    const horizonAzimuthGroup = new THREE.Group();
    horizonAzimuthGroup.position.y = 35.8;
    const azRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(860, 864, 128),
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.045,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    azRingMesh.rotation.x = -Math.PI / 2;
    horizonAzimuthGroup.add(azRingMesh);

    const azTickVertices: number[] = [];
    for (let deg = 0; deg < 360; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      const rIn = deg % 30 === 0 ? 842 : 852;
      const rOut = deg % 30 === 0 ? 882 : 870;
      azTickVertices.push(
        rIn * Math.cos(rad), 0, rIn * Math.sin(rad),
        rOut * Math.cos(rad), 0, rOut * Math.sin(rad)
      );
    }
    const azTickGeo = new THREE.BufferGeometry();
    azTickGeo.setAttribute('position', new THREE.Float32BufferAttribute(azTickVertices, 3));
    const azTicks = new THREE.LineSegments(
      azTickGeo,
      new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    horizonAzimuthGroup.add(azTicks);
    scene.add(horizonAzimuthGroup);
    ssaoExcludedObjects.push(horizonAzimuthGroup);

    const sunLight = new THREE.DirectionalLight(0x3b629b, 0.35);
    sunLight.position.set(-160, 220, -140);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 40;
    sunLight.shadow.camera.far = 780;
    const shadowBound = 260;
    sunLight.shadow.camera.left = -shadowBound;
    sunLight.shadow.camera.right = shadowBound;
    sunLight.shadow.camera.top = shadowBound;
    sunLight.shadow.camera.bottom = -shadowBound;
    sunLight.shadow.bias = -0.00035;
    sunLight.shadow.normalBias = 0.025;
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x16243b, 0x080b10, 0.42);
    hemiLight.position.set(0, 120, 0);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x00d2ff, 0.38);
    rimLight.position.set(-180, 140, -190);
    scene.add(rimLight);

    // --- 3. ORGANIC ASYMMETRIC PIT BENCH GEOLOGY & PBR STRATA ---
    const steppeAndBermTex = createSteppeAndBermTextures(maxAniso);

    const overburdenTex = createRockStrataTextures(
      {
        baseHex: '#7d6e5d',
        darkHex: '#4f4439',
        lightHex: '#9c8c79',
        veinPrimaryHex: '#b48a64',
        veinDensity: 0.15,
      },
      maxAniso
    );
    const malachiteBenchTex = createRockStrataTextures(
      {
        baseHex: '#4f5e58',
        darkHex: '#283631',
        lightHex: '#6b7f78',
        veinPrimaryHex: '#10b981',
        veinSecondaryHex: '#3b82f6',
        veinDensity: 0.9,
      },
      maxAniso
    );
    const sulfideBenchTex = createRockStrataTextures(
      {
        baseHex: '#6c5340',
        darkHex: '#3f2e22',
        lightHex: '#8c6e56',
        veinPrimaryHex: '#eab308',
        veinSecondaryHex: '#14b8a6',
        veinDensity: 0.65,
      },
      maxAniso
    );
    const porphyryBenchTex = createRockStrataTextures(
      {
        baseHex: '#754e34',
        darkHex: '#472d1c',
        lightHex: '#966849',
        veinPrimaryHex: '#f59e0b',
        veinSecondaryHex: '#0d9488',
        veinDensity: 0.8,
      },
      maxAniso
    );
    const bedrockBenchTex = createRockStrataTextures(
      {
        baseHex: '#453931',
        darkHex: '#241d18',
        lightHex: '#5e4f45',
        veinPrimaryHex: '#38bdf8',
        veinDensity: 0.25,
      },
      maxAniso
    );

    const pitGroup = new THREE.Group();
    const rimRadius = 152;
    const outerRadius = 3200;

    // Low-frequency undulating Kazakh Steppe hills outside the pit rim (strictly zero inside rimRadius + 10)
    function getSteppeElevation(wx: number, wz: number): number {
      const baseR = Math.hypot(wx, wz);
      if (baseR <= rimRadius + 10) return 0;
      const steppeHills =
        Math.sin(wx * 0.006) * Math.cos(wz * 0.006) * 14.0 +
        Math.sin(wx * 0.015) * 4.5;
      const blend = Math.min(1, (baseR - (rimRadius + 10)) / 95);
      return steppeHills * blend;
    }

    // Deterministic Radial Notch Carving for Two-Lane Spiral Haul Roads (11.4m) & Shovel Loading Bays
    function getRoadCarve(worldY: number, angle: number): { needCarve: boolean; targetBaseR: number } {
      let needCarve = false;
      let targetBaseR = 0;
      // 1. Основной двухполосный серпантин EX-02 / EX-01 (routeEX2, 11.4м: theta от 2.4 до -1.0, y от 3.0 до 35.0)
      const uEX2 = (2.4 - angle) / 3.4;
      if (uEX2 >= -0.02 && uEX2 <= 1.02) {
        const uc = Math.max(0, Math.min(1, uEX2));
        const roadY = 3.0 + 32.0 * uc;
        const roadBaseR = 42.0 + 110.0 * uc;
        const dy = worldY - roadY;
        // Воздушный габарит: от -0.8м (подложка насыпи) до +7.5м (габарит 7.4-метрового CAT 793F с запасом)
        if (dy >= -0.8 && dy <= 7.5) {
          needCarve = true;
          // Полуширина двухполосной дороги 5.7м + водоотводная канава и берма 2.8м = 8.5м
          targetBaseR = Math.max(targetBaseR, roadBaseR + 8.5);
        }
      }
      // 2. Объездной маршрут при обрушении (routeDetour, 10.2м: theta от 2.4 до 5.28)
      // В Three.js Math.atan2 возвращает диапазон [-PI, PI]. Углы > PI переходят в отрицательные [-PI, -1.0]
      let aDetour = angle;
      if (aDetour < -1.0) {
        aDetour += Math.PI * 2;
      }
      const uDetour = (aDetour - 2.4) / 2.88;
      if (uDetour >= -0.02 && uDetour <= 1.02) {
        const uc = Math.max(0, Math.min(1, uDetour));
        const roadY = 3.0 + 32.0 * uc;
        const roadBaseR = 42.0 + 110.0 * uc;
        const dy = worldY - roadY;
        if (dy >= -0.8 && dy <= 7.5) {
          needCarve = true;
          targetBaseR = Math.max(targetBaseR, roadBaseR + 8.2);
        }
      }
      // 3. Амфитеатральная выемка забоя под погрузочный карман EX-01 (+19м, baseR = 114.0, theta = 0.72)
      const dThetaEx1 = Math.abs(angle - 0.72);
      if (worldY > 19.1 && worldY <= 28.5 && dThetaEx1 <= 0.24) {
        const bayBlend = Math.cos((dThetaEx1 / 0.24) * (Math.PI * 0.5));
        needCarve = true;
        targetBaseR = Math.max(targetBaseR, 114.0 + 11.5 * bayBlend);
      }
      return { needCarve, targetBaseR };
    }

    // Surrounding Infinite Kazakh Steppe Terrain (outerRadius = 3200m) — inner rim vertices strictly locked to getBenchRadius & getRoadCarve
    const terrainGeo = new THREE.RingGeometry(rimRadius, outerRadius, 128, 36);
    applyPolarRingUVs(terrainGeo, rimRadius, outerRadius, 42, 26);
    const tPos = terrainGeo.attributes.position;
    for (let i = 0; i < tPos.count; i++) {
      const lx = tPos.getX(i);
      const ly = tPos.getY(i);
      const baseR = Math.hypot(lx, ly);
      // Note: terrain mesh is rotated by rotation.x = -Math.PI / 2, so worldZ = -ly and worldX = lx
      const theta = Math.atan2(-ly, lx);

      const carve = getRoadCarve(35.0, theta);
      let effectiveBaseR = baseR;
      if (carve.needCarve && effectiveBaseR < carve.targetBaseR) {
        effectiveBaseR = carve.targetBaseR;
      }

      // Strictly lock inner perimeter to getBenchRadius(effectiveBaseR, theta, 38.0) and smoothly blend to outer horizon
      const rimDeformedR = getBenchRadius(effectiveBaseR, theta, 38.0);
      const outerBlend = Math.min(1, Math.max(0, (baseR - rimRadius) / 480));
      const finalR = rimDeformedR * (1 - outerBlend) + baseR * outerBlend;

      const wx = finalR * Math.cos(theta);
      const wz = finalR * Math.sin(theta);
      tPos.setX(i, wx);
      tPos.setY(i, -wz);

      if (baseR > rimRadius + 10) {
        const steppeHills =
          Math.sin(wx * 0.006) * Math.cos(wz * 0.006) * 14.0 +
          Math.sin(wx * 0.015) * 4.5;
        const blend = Math.min(1, (baseR - (rimRadius + 10)) / 95);
        tPos.setZ(i, steppeHills * blend);
      } else {
        tPos.setZ(i, 0);
      }
    }
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x0e1626,
      map: steppeAndBermTex.steppeMap,
      bumpMap: overburdenTex.bumpMap,
      bumpScale: 0.45,
      emissive: 0x070d19,
      emissiveIntensity: 0.35,
      roughness: 0.92,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });

    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.y = 35;
    terrain.receiveShadow = true;
    pitGroup.add(terrain);

    // Topographic Geodesic Holo-Grid (GIS Holo-Grid) over outer steppe (r = 175m to r = 2800m)
    const gisGridVertices: number[] = [];
    const gisContourRadii = [
      188, 225, 270, 325, 390, 465, 555, 660, 780, 920, 1080, 1270, 1490, 1750, 2060, 2420, 2800,
    ];
    const gisSegs = 96;
    for (const rRing of gisContourRadii) {
      for (let s = 0; s < gisSegs; s++) {
        const a0 = (s / gisSegs) * Math.PI * 2;
        const a1 = ((s + 1) / gisSegs) * Math.PI * 2;
        const x0 = rRing * Math.cos(a0);
        const z0 = rRing * Math.sin(a0);
        const y0 = 35.0 + getSteppeElevation(x0, z0) + 0.38;
        const x1 = rRing * Math.cos(a1);
        const z1 = rRing * Math.sin(a1);
        const y1 = 35.0 + getSteppeElevation(x1, z1) + 0.38;
        gisGridVertices.push(x0, y0, z0, x1, y1, z1);
      }
    }
    const radialRayCount = 24;
    const radialSteps = 36;
    for (let rIdx = 0; rIdx < radialRayCount; rIdx++) {
      const ang = (rIdx / radialRayCount) * Math.PI * 2;
      for (let st = 0; st < radialSteps; st++) {
        const r0 = 185 + (st / radialSteps) * (2800 - 185);
        const r1 = 185 + ((st + 1) / radialSteps) * (2800 - 185);
        const x0 = r0 * Math.cos(ang);
        const z0 = r0 * Math.sin(ang);
        const y0 = 35.0 + getSteppeElevation(x0, z0) + 0.38;
        const x1 = r1 * Math.cos(ang);
        const z1 = r1 * Math.sin(ang);
        const y1 = 35.0 + getSteppeElevation(x1, z1) + 0.38;
        gisGridVertices.push(x0, y0, z0, x1, y1, z1);
      }
    }
    const gisGridGeo = new THREE.BufferGeometry();
    gisGridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gisGridVertices, 3));
    const gisHoloGridMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x00d2ff) },
        uOpacity: { value: 0.085 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying float vDist;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDist = length(wp.xz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vDist;
        void main() {
          float innerFade = smoothstep(180.0, 225.0, vDist);
          float outerFade = smoothstep(2800.0, 360.0, vDist);
          gl_FragColor = vec4(uColor, uOpacity * innerFade * outerFade);
        }
      `,
    });
    const gisHoloGridLines = new THREE.LineSegments(gisGridGeo, gisHoloGridMat);
    pitGroup.add(gisHoloGridLines);
    ssaoExcludedObjects.push(gisHoloGridLines);

    // Perimeter Safety Crest Bund (deformed to match getBenchRadius & ramp notch along the pit rim)
    const ridgeGeo = new THREE.TorusGeometry(rimRadius + 2.2, 2.1, 12, 128);
    const rPos = ridgeGeo.attributes.position;
    for (let i = 0; i < rPos.count; i++) {
      const lx = rPos.getX(i);
      const ly = rPos.getY(i);
      // ridge has rotation.x = Math.PI / 2 -> worldX = lx, worldZ = ly
      const theta = Math.atan2(ly, lx);
      const carve = getRoadCarve(35.0, theta);
      const targetRimR =
        carve.needCarve && rimRadius + 2.2 < carve.targetBaseR + 1.5
          ? carve.targetBaseR + 1.5
          : rimRadius + 2.2;
      const scale = getBenchRadius(targetRimR, theta, 38.0) / (rimRadius + 2.2);
      rPos.setX(i, lx * scale);
      rPos.setY(i, ly * scale);
    }
    ridgeGeo.computeVertexNormals();

    const ridgeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: steppeAndBermTex.bermMap,
      bumpMap: overburdenTex.bumpMap,
      bumpScale: 0.7,
      roughness: 0.92,
      metalness: 0.05,
    });
    const ridge = new THREE.Mesh(ridgeGeo, ridgeMat);
    ridge.rotation.x = Math.PI / 2;
    ridge.position.y = 36.0;
    ridge.castShadow = true;
    ridge.receiveShadow = true;
    pitGroup.add(ridge);

    const benchTiers = [
      {
        yTop: 35,
        rTop: 152,
        yBottom: 28,
        rToe: 136,
        rBermIn: 122,
        tex: overburdenTex,
        repeatX: 24,
        mineralStrength: 0.14,
        veinHex: 0xd97706,
        secVeinHex: 0x78716c,
        metalness: 0.06,
        bermTint: 0x8c7b69,
      },
      {
        yTop: 28,
        rTop: 122,
        yBottom: 19,
        rToe: 104,
        rBermIn: 90,
        tex: malachiteBenchTex,
        repeatX: 20,
        mineralStrength: 0.88,
        veinHex: 0x10b981,
        secVeinHex: 0x2563eb,
        metalness: 0.18,
        bermTint: 0x5c756c,
      },
      {
        yTop: 19,
        rTop: 90,
        yBottom: 11,
        rToe: 74,
        rBermIn: 62,
        tex: sulfideBenchTex,
        repeatX: 16,
        mineralStrength: 0.58,
        veinHex: 0xf59e0b,
        secVeinHex: 0x0d9488,
        metalness: 0.2,
        bermTint: 0x786250,
      },
      {
        yTop: 11,
        rTop: 62,
        yBottom: 3,
        rToe: 48,
        rBermIn: 36,
        tex: porphyryBenchTex,
        repeatX: 12,
        mineralStrength: 0.78,
        veinHex: 0xeab308,
        secVeinHex: 0x14b8a6,
        metalness: 0.24,
        bermTint: 0x805d44,
      },
      {
        yTop: 3,
        rTop: 36,
        yBottom: -5,
        rToe: 26,
        rBermIn: 18,
        tex: bedrockBenchTex,
        repeatX: 8,
        mineralStrength: 0.35,
        veinHex: 0x38bdf8,
        secVeinHex: 0xf59e0b,
        metalness: 0.15,
        bermTint: 0x57493f,
      },
      {
        yTop: -5,
        rTop: 18,
        yBottom: -12,
        rToe: 14,
        rBermIn: 0,
        tex: bedrockBenchTex,
        repeatX: 6,
        mineralStrength: 0.22,
        veinHex: 0x0ea5e9,
        secVeinHex: 0x10b981,
        metalness: 0.15,
        bermTint: 0x453931,
      },
    ];

    const benchStrataUniforms: Array<{
      uniforms: {
        uMineralStrength: { value: number };
        uVeinColor: { value: THREE.Color };
        uSecVeinColor: { value: THREE.Color };
      };
      baseStrength: number;
      faceMat: THREE.MeshStandardMaterial;
    }> = [];

    benchTiers.forEach((t, tierIdx) => {
      const height = t.yTop - t.yBottom;
      const centerY = (t.yTop + t.yBottom) / 2;

      const faceGeo = new THREE.CylinderGeometry(t.rTop, t.rToe, height, 128, 8, true);
      const posAttr = faceGeo.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);
        const vz = posAttr.getZ(i);
        const angle = Math.atan2(vz, vx);
        const baseR = Math.hypot(vx, vz);
        const worldY = centerY + vy;

        const carve = getRoadCarve(worldY, angle);
        let effectiveBaseR = baseR;
        if (carve.needCarve && effectiveBaseR < carve.targetBaseR) {
          effectiveBaseR = carve.targetBaseR;
        }
        const organicR = getBenchRadius(effectiveBaseR, angle, worldY);
        const vNorm = Math.max(0, 1 - Math.pow(vy / (height * 0.5), 2));
        const rawFbm =
          (Math.sin(angle * 15 + tierIdx * 2.1 + worldY * 0.32) * 0.68 +
            Math.cos(angle * 33 + vy * 0.62) * 0.48 +
            Math.sin(angle * 51 - worldY * 0.45) * 0.32) *
          vNorm;
        // В зоне вырубки полутраншеи шум взрывной отбойки может уходить только ВГЛУБЬ массива скалы,
        // но никогда не должен выступать внутрь проезжей части:
        const fbmCrag = carve.needCarve ? Math.max(0, rawFbm) * 0.4 : rawFbm;
        const finalR = organicR + fbmCrag;
        posAttr.setX(i, finalR * Math.cos(angle));
        posAttr.setZ(i, finalR * Math.sin(angle));
      }
      faceGeo.computeVertexNormals();

      const faceMap = t.tex.map.clone();
      faceMap.repeat.set(t.repeatX, 1.4);
      faceMap.needsUpdate = true;

      const faceBump = t.tex.bumpMap.clone();
      faceBump.repeat.set(t.repeatX, 1.4);
      faceBump.needsUpdate = true;

      const faceRough = t.tex.roughnessMap.clone();
      faceRough.repeat.set(t.repeatX, 1.4);
      faceRough.needsUpdate = true;

      const faceMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: faceMap,
        bumpMap: faceBump,
        bumpScale: 1.25,
        roughnessMap: faceRough,
        roughness: 0.85,
        metalness: t.metalness,
        side: THREE.DoubleSide,
      });
      const strataUniforms = applyGeologicalStrataShader(
        faceMat,
        t.mineralStrength,
        t.veinHex,
        t.secVeinHex
      );
      benchStrataUniforms.push({
        uniforms: strataUniforms,
        baseStrength: t.mineralStrength,
        faceMat,
      });

      const faceMesh = new THREE.Mesh(faceGeo, faceMat);
      faceMesh.position.y = centerY;
      faceMesh.receiveShadow = true;
      faceMesh.castShadow = true;
      pitGroup.add(faceMesh);

      if (t.rBermIn > 0) {
        const bermGeo = new THREE.RingGeometry(t.rBermIn - 0.6, t.rToe + 0.9, 128, 3);
        applyPolarRingUVs(bermGeo, t.rBermIn - 0.6, t.rToe + 0.9, t.repeatX, 1.0);
        const bPos = bermGeo.attributes.position;
        for (let i = 0; i < bPos.count; i++) {
          const lx = bPos.getX(i);
          const ly = bPos.getY(i);
          const baseR = Math.hypot(lx, ly);
          const theta = Math.atan2(-ly, lx);
          const carve = getRoadCarve(t.yBottom, theta);
          let effectiveBaseR = baseR;
          if (carve.needCarve && effectiveBaseR < carve.targetBaseR) {
            effectiveBaseR = carve.targetBaseR;
          }
          const finalR = getBenchRadius(effectiveBaseR, theta, t.yBottom);
          bPos.setX(i, finalR * Math.cos(theta));
          bPos.setY(i, -finalR * Math.sin(theta));
        }
        bermGeo.computeVertexNormals();

        const bermMat = new THREE.MeshStandardMaterial({
          color: t.bermTint,
          map: steppeAndBermTex.bermMap,
          bumpMap: t.tex.bumpMap,
          bumpScale: 0.55,
          roughness: 0.92,
          metalness: 0.06,
          side: THREE.DoubleSide,
        });

        const bermMesh = new THREE.Mesh(bermGeo, bermMat);
        bermMesh.rotation.x = -Math.PI / 2;
        bermMesh.position.y = t.yBottom;
        bermMesh.receiveShadow = true;
        pitGroup.add(bermMesh);
      }
    });

    // Pit Floor & Dewatering Sump deformed with getBenchRadius to match lowest bench toe
    const floorGeo = new THREE.CircleGeometry(15.0, 64);
    const flPos = floorGeo.attributes.position;
    for (let i = 0; i < flPos.count; i++) {
      const lx = flPos.getX(i);
      const ly = flPos.getY(i);
      const baseR = Math.hypot(lx, ly);
      if (baseR > 0.001) {
        const theta = Math.atan2(-ly, lx);
        const finalR = getBenchRadius(baseR, theta, -12.0);
        flPos.setX(i, finalR * Math.cos(theta));
        flPos.setY(i, -finalR * Math.sin(theta));
      }
    }
    floorGeo.computeVertexNormals();

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x5c4d42,
      map: steppeAndBermTex.bermMap,
      bumpMap: bedrockBenchTex.bumpMap,
      bumpScale: 0.8,
      roughness: 0.9,
      metalness: 0.1,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -12;
    floorMesh.receiveShadow = true;
    pitGroup.add(floorMesh);

    const sumpGeo = new THREE.CircleGeometry(9.0, 48);
    const smPos = sumpGeo.attributes.position;
    for (let i = 0; i < smPos.count; i++) {
      const lx = smPos.getX(i);
      const ly = smPos.getY(i);
      const baseR = Math.hypot(lx, ly);
      if (baseR > 0.001) {
        const theta = Math.atan2(-ly, lx);
        const finalR = getBenchRadius(baseR, theta, -11.82);
        smPos.setX(i, finalR * Math.cos(theta));
        smPos.setY(i, -finalR * Math.sin(theta));
      }
    }
    sumpGeo.computeVertexNormals();

    const sumpMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      map: steppeAndBermTex.sumpMap,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.85,
      roughness: 0.18,
      metalness: 0.18,
      transparent: true,
      opacity: 0.78,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const sumpMesh = new THREE.Mesh(sumpGeo, sumpMat);
    sumpMesh.rotation.x = -Math.PI / 2;
    sumpMesh.position.y = -11.82;
    sumpMesh.receiveShadow = true;
    pitGroup.add(sumpMesh);

    // Dewatering Sump Bioluminescent Reflection Light on Pit Floor (-11.8m)
    const sumpPointLight = new THREE.PointLight(0x06b6d4, 2.4, 48, 1.8);
    sumpPointLight.position.set(0, -9.2, 0);
    pitGroup.add(sumpPointLight);

    scene.add(pitGroup);

    // Helper to compute exact world coordinates on any deformed bench berm
    function getBermWorldPoint(baseR: number, theta: number, y: number): THREE.Vector3 {
      const r = getBenchRadius(baseR, theta, y);
      return new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta));
    }

    // --- 4. SPIRAL HAUL ROADS, TIRE TRACKS & 1.85m TRAPEZOIDAL SAFETY BERMS ---
    const roadTextures = createHaulRoadTextures(maxAniso);

    function createRoadRibbonWithBerm(
      curve: THREE.CatmullRomCurve3,
      width = 11.4,
      yOffset = 0.55,
      segments = 180
    ): { roadGeo: THREE.BufferGeometry; bermGeo: THREE.BufferGeometry } {
      const points = curve.getSpacedPoints(segments);
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      const bermPositions: number[] = [];
      const bermIndices: number[] = [];

      for (let i = 0; i <= segments; i++) {
        const p = points[i];
        const t = Math.min(0.999, Math.max(0.001, i / segments));
        const tangent = curve.getTangentAt(t).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        // crossVectors(tangent, up) строго дает (-tangent.z, 0, tangent.x) с Y тождественно равным 0!
        const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();

        // 5-точечный объемный поперечный профиль насыпи:
        // V0 (skirtLeft): левый насыпной откос в сторону борта/выемочной траншеи
        const skirtLeft = new THREE.Vector3().copy(p).addScaledVector(normal, width / 2 + 1.4);
        skirtLeft.y = p.y - 1.8;

        // V1 (leftEdge): левая бровка проезжей части
        const leftEdge = new THREE.Vector3().copy(p).addScaledVector(normal, width / 2);
        leftEdge.y = p.y + yOffset;

        // V2 (crownCenter): центральная ось полотна (двускатный профиль 1.5% для водоотвода)
        const crownCenter = new THREE.Vector3().copy(p);
        crownCenter.y = p.y + yOffset + 0.08;

        // V3 (rightEdge): правая бровка проезжей части
        const rightEdge = new THREE.Vector3().copy(p).addScaledVector(normal, -width / 2);
        rightEdge.y = p.y + yOffset;

        // V4 (skirtRight): правый насыпной откос в сторону чаши карьера
        const skirtRight = new THREE.Vector3().copy(p).addScaledVector(normal, -(width / 2 + 1.4));
        skirtRight.y = p.y - 1.8;

        positions.push(
          skirtLeft.x, skirtLeft.y, skirtLeft.z,
          leftEdge.x, leftEdge.y, leftEdge.z,
          crownCenter.x, crownCenter.y, crownCenter.z,
          rightEdge.x, rightEdge.y, rightEdge.z,
          skirtRight.x, skirtRight.y, skirtRight.z
        );

        const v = i / segments;
        uvs.push(-0.15, v, 0.0, v, 0.5, v, 1.0, v, 1.15, v);

        // Предохранительный вал bermGeo вдоль leftEdge с высотой пика +1.85 м
        const bermInner = leftEdge.clone().addScaledVector(normal, -0.45);
        const bermPeak = leftEdge.clone().addScaledVector(normal, 0.45);
        bermPeak.y += 1.85;
        const bermCrestOuter = leftEdge.clone().addScaledVector(normal, 1.05);
        bermCrestOuter.y += 1.72;
        const bermOuter = leftEdge.clone().addScaledVector(normal, 1.45);
        bermOuter.y = p.y - 1.8;

        bermPositions.push(
          bermInner.x, bermInner.y - 0.06, bermInner.z,
          bermPeak.x, bermPeak.y, bermPeak.z,
          bermCrestOuter.x, bermCrestOuter.y, bermCrestOuter.z,
          bermOuter.x, bermOuter.y, bermOuter.z
        );

        if (i < segments) {
          const base = i * 5;
          const next = (i + 1) * 5;
          for (let q = 0; q < 4; q++) {
            indices.push(base + q, base + q + 1, next + q);
            indices.push(base + q + 1, next + q + 1, next + q);
          }

          const bBase = i * 4;
          // Inner 1:1 slope face
          bermIndices.push(bBase, bBase + 1, bBase + 4);
          bermIndices.push(bBase + 1, bBase + 5, bBase + 4);
          // Trapezoidal top crest
          bermIndices.push(bBase + 1, bBase + 2, bBase + 5);
          bermIndices.push(bBase + 2, bBase + 6, bBase + 5);
          // Outer pit-side slope face
          bermIndices.push(bBase + 2, bBase + 3, bBase + 6);
          bermIndices.push(bBase + 3, bBase + 7, bBase + 6);
        }
      }

      const roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      roadGeo.setIndex(indices);
      roadGeo.computeVertexNormals();

      const bermGeo = new THREE.BufferGeometry();
      bermGeo.setAttribute('position', new THREE.Float32BufferAttribute(bermPositions, 3));
      bermGeo.setIndex(bermIndices);
      bermGeo.computeVertexNormals();

      return { roadGeo, bermGeo };
    }

    const ptsEX2: THREE.Vector3[] = [];
    const steps = 28;
    const startTheta = 2.4;
    const endTheta = -1.0;
    const startR = 42.0;
    const endR = 152.0;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const y = 3.0 + (35.0 - 3.0) * u;
      const baseR = startR + (endR - startR) * u;
      const theta = startTheta + (endTheta - startTheta) * u;
      ptsEX2.push(getBermWorldPoint(baseR, theta, y));
    }
    const routeEX2 = new THREE.CatmullRomCurve3(ptsEX2);

    const ptsEX1: THREE.Vector3[] = [];
    for (let i = Math.floor(steps * 0.5); i <= steps; i++) {
      ptsEX1.push(ptsEX2[i].clone());
    }
    const routeEX1 = new THREE.CatmullRomCurve3(ptsEX1);

    const ex3StartPos = getBermWorldPoint(128.5, -2.35, 28.0);
    const ex3RimExit = getBermWorldPoint(148.0, -2.32, 35.0);
    const ptsEX3 = [
      ex3StartPos.clone(),
      getBermWorldPoint(138.0, -2.34, 31.5),
      ex3RimExit.clone(),
      new THREE.Vector3(-124, 39.5, -122),
      new THREE.Vector3(-136, 42.0, -132),
    ];
    const routeEX3 = new THREE.CatmullRomCurve3(ptsEX3);

    const ptsDetour: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      const y = 3.0 + 32.0 * u;
      const baseR = 42.0 + (152.0 - 42.0) * u;
      const theta = 2.4 + (5.28 - 2.4) * u;
      ptsDetour.push(getBermWorldPoint(baseR, theta, y));
    }
    const routeDetour = new THREE.CatmullRomCurve3(ptsDetour);

    const roadMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: roadTextures.map,
      bumpMap: roadTextures.bumpMap,
      bumpScale: 0.55,
      roughnessMap: roadTextures.roughnessMap,
      roughness: 0.92,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });

    const windrowBermMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: overburdenTex.map,
      bumpMap: overburdenTex.bumpMap,
      bumpScale: 0.85,
      roughness: 0.95,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });

    const mainRibbon = createRoadRibbonWithBerm(routeEX2, 11.4, 0.55, 180);
    const mainRoadMesh = new THREE.Mesh(mainRibbon.roadGeo, roadMat);
    mainRoadMesh.receiveShadow = true;
    scene.add(mainRoadMesh);
    const mainBermMesh = new THREE.Mesh(mainRibbon.bermGeo, windrowBermMat);
    mainBermMesh.castShadow = true;
    mainBermMesh.receiveShadow = true;
    scene.add(mainBermMesh);

    const ex3Ribbon = createRoadRibbonWithBerm(routeEX3, 10.8, 0.55, 64);
    const ex3RoadMesh = new THREE.Mesh(ex3Ribbon.roadGeo, roadMat);
    ex3RoadMesh.receiveShadow = true;
    scene.add(ex3RoadMesh);
    const ex3BermMesh = new THREE.Mesh(ex3Ribbon.bermGeo, windrowBermMat);
    ex3BermMesh.castShadow = true;
    ex3BermMesh.receiveShadow = true;
    scene.add(ex3BermMesh);

    const detourRibbon = createRoadRibbonWithBerm(routeDetour, 10.2, 0.55, 150);
    const detourMesh = new THREE.Mesh(detourRibbon.roadGeo, roadMat);
    detourMesh.receiveShadow = true;
    scene.add(detourMesh);
    const detourBermMesh = new THREE.Mesh(detourRibbon.bermGeo, windrowBermMat);
    detourBermMesh.castShadow = true;
    detourBermMesh.receiveShadow = true;
    scene.add(detourBermMesh);

    // Coarse rock armor boulders (0.6m to 1.4m DodecahedronGeometry) along safety berm crests
    const bermBoulderCount = 96;
    const bermBoulderGeo = new THREE.DodecahedronGeometry(1.0, 0);
    const bermBoulderMat = new THREE.MeshStandardMaterial({
      color: 0x8b7968,
      map: overburdenTex.map,
      bumpMap: overburdenTex.bumpMap,
      bumpScale: 0.95,
      roughness: 0.94,
      flatShading: true,
    });
    const bermBoulderInst = new THREE.InstancedMesh(bermBoulderGeo, bermBoulderMat, bermBoulderCount);
    bermBoulderInst.castShadow = true;
    bermBoulderInst.receiveShadow = true;
    const dummyBoulder = new THREE.Object3D();
    for (let i = 0; i < bermBoulderCount; i++) {
      const isMain = i < 64;
      const curveRef = isMain ? routeEX2 : routeDetour;
      const u = isMain ? (i + 0.5) / 64 : (i - 64 + 0.5) / 32;
      const p = curveRef.getPointAt(u);
      const tang = curveRef.getTangentAt(u).normalize();
      const norm = new THREE.Vector3().crossVectors(tang, new THREE.Vector3(0, 1, 0)).normalize();
      const lateralOffset = (isMain ? 5.7 : 5.1) + 1.1 + ((i * 7) % 5) * 0.12;
      dummyBoulder.position.copy(p).addScaledVector(norm, lateralOffset);
      dummyBoulder.position.y += 2.12;
      const s = 0.6 + ((i * 13) % 9) * 0.1; // 0.6m to 1.4m scale
      dummyBoulder.scale.set(s * 1.15, s * 0.78, s * 0.95);
      dummyBoulder.rotation.set(i * 0.7, i * 1.3, i * 0.5);
      dummyBoulder.updateMatrix();
      bermBoulderInst.setMatrixAt(i, dummyBoulder.matrix);
    }
    bermBoulderInst.computeBoundingSphere();
    scene.add(bermBoulderInst);

    // Smart Haul Road LEDs: Outer Safety Berm Cyan Delineators (#00e5ff) & Inner Rock-Side Amber LEDs (#ffaa00)
    const postCount = 48;
    const postGeo = new THREE.CylinderGeometry(0.14, 0.14, 1.3, 8);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x00e5ff,
      emissiveIntensity: 2.2,
      toneMapped: false,
      roughness: 0.3,
    });
    const postInstanced = new THREE.InstancedMesh(postGeo, postMat, postCount);
    const dummyPost = new THREE.Object3D();
    for (let i = 0; i < postCount; i++) {
      const u = (i + 0.5) / postCount;
      const p = routeEX2.getPointAt(u);
      const tang = routeEX2.getTangentAt(u).normalize();
      const norm = new THREE.Vector3().crossVectors(tang, new THREE.Vector3(0, 1, 0)).normalize();
      dummyPost.position.copy(p).addScaledVector(norm, 6.25);
      dummyPost.position.y += 2.52;
      dummyPost.updateMatrix();
      postInstanced.setMatrixAt(i, dummyPost.matrix);
    }
    postInstanced.computeBoundingSphere();
    scene.add(postInstanced);

    const innerLedGeo = new THREE.BoxGeometry(0.24, 0.42, 0.24);
    const innerLedMat = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      emissive: 0xffaa00,
      emissiveIntensity: 2.0,
      toneMapped: false,
      roughness: 0.3,
    });
    const innerLedInstanced = new THREE.InstancedMesh(innerLedGeo, innerLedMat, postCount);
    for (let i = 0; i < postCount; i++) {
      const u = (i + 0.5) / postCount;
      const p = routeEX2.getPointAt(u);
      const tang = routeEX2.getTangentAt(u).normalize();
      const norm = new THREE.Vector3().crossVectors(tang, new THREE.Vector3(0, 1, 0)).normalize();
      dummyPost.position.copy(p).addScaledVector(norm, -5.55);
      dummyPost.position.y += 0.72;
      dummyPost.updateMatrix();
      innerLedInstanced.setMatrixAt(i, dummyPost.matrix);
    }
    innerLedInstanced.computeBoundingSphere();
    scene.add(innerLedInstanced);


    // Overburden Waste Dump Terraced Mound at (-138, 35, -134) + CAT D11T Dozer
    const wasteDumpGroup = new THREE.Group();
    wasteDumpGroup.position.set(-138, 35, -134);
    wasteDumpGroup.userData = { assetId: 'waste-dump' as MiningAssetId };

    const wasteConeGeo = new THREE.ConeGeometry(28, 12, 32, 3);
    const wPos = wasteConeGeo.attributes.position;
    for (let i = 0; i < wPos.count; i++) {
      const wy = wPos.getY(i);
      if (wy > 2.5) wPos.setY(i, 2.5 + (wy - 2.5) * 0.2);
    }
    wasteConeGeo.computeVertexNormals();
    const wasteDumpMesh = new THREE.Mesh(wasteConeGeo, ridgeMat);
    wasteDumpMesh.position.y = 4.5;
    wasteDumpMesh.castShadow = true;
    wasteDumpMesh.receiveShadow = true;
    wasteDumpGroup.add(wasteDumpMesh);

    // Small CAT D11T Track Dozer working on top of the waste dump terrace
    const dozerBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 1.8, 4.2),
      new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.45, metalness: 0.25 })
    );
    dozerBody.position.set(4, 8.2, 4);
    wasteDumpGroup.add(dozerBody);
    const dozerBlade = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 1.5, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.4 })
    );
    dozerBlade.position.set(4, 7.9, 6.4);
    wasteDumpGroup.add(dozerBlade);

    scene.add(wasteDumpGroup);

    // Note: Dynamic What-If 3D scenario effects (rockslide cascade, barriers, EX-01 smoke/sparks/perimeter,
    // and Crusher dilution hologram) are encapsulated inside `whatIfEffectsGroup` in Section 8B below.

    // --- 5. PRIMARY GYRATORY CRUSHER ККД-1 (METSO SUPERIOR 60-89) & OVERLAND CONVEYOR BRIDGE ---
    // Offset radially on +35m rim terrace (R=174.0) so haul road ptsEX2[28] (R=152.0) passes cleanly in front without collision
    const crusherRimPos = getBermWorldPoint(174.0, -1.02, 35.0);
    const crusherGroup = new THREE.Group();
    crusherGroup.position.copy(crusherRimPos);
    crusherGroup.userData = { assetId: 'crusher' as MiningAssetId };

    const concMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      bumpMap: overburdenTex.bumpMap,
      bumpScale: 0.35,
      roughness: 0.88,
      metalness: 0.08,
    });

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.68,
      roughness: 0.36,
    });

    const structuralSteelMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.76,
      roughness: 0.32,
    });

    const roofTrimMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      metalness: 0.42,
      roughness: 0.34,
    });

    // Procedural Vertical Corrugated Steel Cladding Texture for Crusher House (#1e293b / #334155)
    const corrCan = document.createElement('canvas');
    corrCan.width = 512;
    corrCan.height = 512;
    const cCtx = corrCan.getContext('2d')!;
    cCtx.fillStyle = '#1e293b';
    cCtx.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 16) {
      cCtx.fillStyle = '#334155';
      cCtx.fillRect(x, 0, 7, 512);
      cCtx.fillStyle = '#0f172a';
      cCtx.fillRect(x + 7, 0, 3, 512);
      cCtx.fillStyle = '#263449';
      cCtx.fillRect(x + 10, 0, 6, 512);
    }
    cCtx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    for (let y = 0; y < 512; y += 128) {
      cCtx.fillRect(0, y, 512, 4);
    }
    const corrTex = new THREE.CanvasTexture(corrCan);
    corrTex.colorSpace = THREE.SRGBColorSpace;
    corrTex.wrapS = THREE.RepeatWrapping;
    corrTex.wrapT = THREE.RepeatWrapping;
    corrTex.repeat.set(3, 2);
    corrTex.anisotropy = maxAniso;

    const crusherCladdingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: corrTex,
      bumpMap: corrTex,
      bumpScale: 0.22,
      metalness: 0.62,
      roughness: 0.42,
    });

    // Procedural Diagonal Yellow-Black Hazard Stripe Texture for Wheel Stop Bumper (#eab308 & #18181b)
    const bumperCan = document.createElement('canvas');
    bumperCan.width = 512;
    bumperCan.height = 128;
    const bmpCtx = bumperCan.getContext('2d')!;
    bmpCtx.fillStyle = '#eab308';
    bmpCtx.fillRect(0, 0, 512, 128);
    bmpCtx.fillStyle = '#18181b';
    for (let sx = -128; sx < 640; sx += 64) {
      bmpCtx.beginPath();
      bmpCtx.moveTo(sx, 0);
      bmpCtx.lineTo(sx + 32, 0);
      bmpCtx.lineTo(sx - 32, 128);
      bmpCtx.lineTo(sx - 64, 128);
      bmpCtx.closePath();
      bmpCtx.fill();
    }
    const wheelStopTex = new THREE.CanvasTexture(bumperCan);
    wheelStopTex.colorSpace = THREE.SRGBColorSpace;
    wheelStopTex.wrapS = THREE.RepeatWrapping;
    wheelStopTex.wrapT = THREE.RepeatWrapping;
    wheelStopTex.anisotropy = maxAniso;

    const wheelStopMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: wheelStopTex,
      roughness: 0.48,
      metalness: 0.22,
    });

    // 1. Adaptive Stepped Reinforced Concrete Foundation & Lateral Counterfort Buttresses (Zero Road Collision)
    const cPlinthLower = new THREE.Mesh(new THREE.BoxGeometry(22.5, 4.2, 18.5), concMat);
    cPlinthLower.position.set(0, 2.1, -0.4);
    cPlinthLower.castShadow = true;
    cPlinthLower.receiveShadow = true;
    crusherGroup.add(cPlinthLower);

    const cPlinthMid = new THREE.Mesh(new THREE.BoxGeometry(19.8, 3.8, 16.4), concMat);
    cPlinthMid.position.set(0, 6.1, -0.2);
    cPlinthMid.castShadow = true;
    cPlinthMid.receiveShadow = true;
    crusherGroup.add(cPlinthMid);

    // Rear foundation support under Crusher House (local y = 8.0..11.0, z = -8.4..-0.6)
    const cRearDeck = new THREE.Mesh(new THREE.BoxGeometry(17.6, 3.0, 9.2), concMat);
    cRearDeck.position.set(0, 9.5, -4.0);
    cRearDeck.castShadow = true;
    cRearDeck.receiveShadow = true;
    crusherGroup.add(cRearDeck);

    // Front Dump Apron Beam under Wheel Stop Bumper (local y = 8.0..11.0, z = 7.4..9.6)
    const cFrontApronWall = new THREE.Mesh(new THREE.BoxGeometry(16.8, 3.0, 2.2), concMat);
    cFrontApronWall.position.set(0, 9.5, 8.5);
    cFrontApronWall.castShadow = true;
    cFrontApronWall.receiveShadow = true;
    crusherGroup.add(cFrontApronWall);

    // Left & Right Dump Deck Side Beams framing the open receiving pocket (local z = 0.6..8.5)
    const cSideDeckL = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.0, 9.0), concMat);
    cSideDeckL.position.set(-6.9, 9.5, 4.5);
    cSideDeckL.castShadow = true;
    cSideDeckL.receiveShadow = true;
    crusherGroup.add(cSideDeckL);

    const cSideDeckR = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.0, 9.0), concMat);
    cSideDeckR.position.set(6.9, 9.5, 4.5);
    cSideDeckR.castShadow = true;
    cSideDeckR.receiveShadow = true;
    crusherGroup.add(cSideDeckR);

    // Sloped Lateral Counterfort Buttresses anchoring into pit rim slope
    for (const sideSign of [-1, 1]) {
      for (const zPos of [-5.8, -0.5, 4.8]) {
        const buttress = new THREE.Mesh(new THREE.BoxGeometry(1.8, 9.6, 2.2), concMat);
        buttress.position.set(sideSign * 9.8, 4.6, zPos);
        buttress.rotation.z = sideSign * 0.22;
        buttress.castShadow = true;
        buttress.receiveShadow = true;
        crusherGroup.add(buttress);
      }
    }

    // Flared Retaining Wing Walls guiding haul trucks into the dump bay
    const wingWallL = new THREE.Mesh(new THREE.BoxGeometry(1.8, 4.6, 6.2), concMat);
    wingWallL.position.set(-7.2, 10.3, 6.4);
    wingWallL.rotation.y = 0.14;
    wingWallL.castShadow = true;
    crusherGroup.add(wingWallL);

    const wingWallR = new THREE.Mesh(new THREE.BoxGeometry(1.8, 4.6, 6.2), concMat);
    wingWallR.position.set(7.2, 10.3, 6.4);
    wingWallR.rotation.y = -0.14;
    wingWallR.castShadow = true;
    crusherGroup.add(wingWallR);

    // Wheel Stop Bumper (BoxGeometry(11.5, 1.2, 1.4)) with diagonal yellow-black hazard markings
    const wheelStopBumper = new THREE.Mesh(
      new THREE.BoxGeometry(11.5, 1.2, 1.4),
      wheelStopMat
    );
    wheelStopBumper.position.set(0, 11.6, 9.0);
    wheelStopBumper.castShadow = true;
    wheelStopBumper.receiveShadow = true;
    crusherGroup.add(wheelStopBumper);

    // Two Corner Safety Yellow Guardrail Assemblies on the Unloading Pad
    function createCornerSafetyGuardrail(sideSign: number): THREE.Group {
      const rg = new THREE.Group();
      const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.35, 8);
      const corners = [
        [sideSign * 5.9, 9.1],
        [sideSign * 7.8, 9.1],
        [sideSign * 7.8, 5.4],
      ];
      corners.forEach(([px, pz]) => {
        const post = new THREE.Mesh(postGeo, roofTrimMat);
        post.position.set(px, 11.68, pz);
        rg.add(post);
      });
      // Front rail segments (top & mid)
      for (const ry of [12.25, 11.72]) {
        const frontBar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.09, 0.09), roofTrimMat);
        frontBar.position.set(sideSign * 6.85, ry, 9.1);
        rg.add(frontBar);
        const sideBar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 3.8), roofTrimMat);
        sideBar.position.set(sideSign * 7.8, ry, 7.25);
        rg.add(sideBar);
      }
      return rg;
    }
    crusherGroup.add(createCornerSafetyGuardrail(-1));
    crusherGroup.add(createCornerSafetyGuardrail(1));

    // 2. Internal Gyratory Crusher Core (Metso Superior 60-89: 45° Wear Liners, Spider & Mantle Cone)
    const wearLinerMat = new THREE.MeshStandardMaterial({
      color: 0x7c2d12,
      metalness: 0.62,
      roughness: 0.42,
    });

    // 45-degree sloped wear liner plates lining the receiving pocket (center at x=0, z=4.6)
    const linerFront = new THREE.Mesh(new THREE.BoxGeometry(10.2, 3.8, 0.45), wearLinerMat);
    linerFront.position.set(0, 9.6, 7.2);
    linerFront.rotation.x = -Math.PI / 4;
    crusherGroup.add(linerFront);

    const linerRear = new THREE.Mesh(new THREE.BoxGeometry(10.2, 3.8, 0.45), wearLinerMat);
    linerRear.position.set(0, 9.6, 2.0);
    linerRear.rotation.x = Math.PI / 4;
    crusherGroup.add(linerRear);

    const linerLeft = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.8, 6.8), wearLinerMat);
    linerLeft.position.set(-4.6, 9.6, 4.6);
    linerLeft.rotation.z = -Math.PI / 4;
    crusherGroup.add(linerLeft);

    const linerRight = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.8, 6.8), wearLinerMat);
    linerRight.position.set(4.6, 9.6, 4.6);
    linerRight.rotation.z = Math.PI / 4;
    crusherGroup.add(linerRight);

    // Cast Two-Arm Crusher Spider (#334155) with Central Main-Shaft Bearing Hub
    const spiderBeam = new THREE.Mesh(
      new THREE.BoxGeometry(10.4, 1.35, 1.85),
      structuralSteelMat
    );
    spiderBeam.position.set(0, 10.55, 4.6);
    spiderBeam.castShadow = true;
    crusherGroup.add(spiderBeam);

    const spiderRimRing = new THREE.Mesh(
      new THREE.CylinderGeometry(4.6, 4.2, 1.1, 16, 1, true),
      structuralSteelMat
    );
    spiderRimRing.position.set(0, 10.4, 4.6);
    crusherGroup.add(spiderRimRing);

    const spiderHub = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.58, 2.35, 20),
      structuralSteelMat
    );
    spiderHub.position.set(0, 11.15, 4.6);
    spiderHub.castShadow = true;
    crusherGroup.add(spiderHub);

    const spiderCapDome = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.35, 0.55, 16),
      roofTrimMat
    );
    spiderCapDome.position.set(0, 12.55, 4.6);
    crusherGroup.add(spiderCapDome);

    // Ribbed Conical Crushing Mantle (Mantle Cone) beneath the Spider
    const mantleConeMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      bumpMap: corrTex,
      bumpScale: 0.35,
      metalness: 0.85,
      roughness: 0.3,
    });
    const mantleCone = new THREE.Mesh(
      new THREE.ConeGeometry(2.65, 3.4, 20),
      mantleConeMat
    );
    mantleCone.position.set(0, 8.65, 4.6);
    crusherGroup.add(mantleCone);

    // 3. Industrial Crusher House Architecture, I-Beam Columns, Gantry Crane, Stairs & Floodlights
    const cHouse = new THREE.Mesh(
      new THREE.BoxGeometry(16.4, 13.2, 11.8),
      crusherCladdingMat
    );
    cHouse.position.set(0, 17.6, -2.6);
    cHouse.castShadow = true;
    cHouse.receiveShadow = true;
    crusherGroup.add(cHouse);

    // Structural Steel I-Beam Columns framing corners and flanks of Crusher House
    for (const cx of [-8.25, 0, 8.25]) {
      for (const cz of [-8.55, -2.6, 3.35]) {
        if (cx === 0 && cz === -2.6) continue;
        const colWeb = new THREE.Mesh(
          new THREE.BoxGeometry(0.58, 13.5, 0.58),
          structuralSteelMat
        );
        colWeb.position.set(cx, 17.65, cz);
        colWeb.castShadow = true;
        crusherGroup.add(colWeb);
      }
    }

    // Horizontal perimeter structural steel girts on Crusher House
    for (const gy of [14.5, 19.2]) {
      const girtBand = new THREE.Mesh(
        new THREE.BoxGeometry(16.75, 0.36, 12.15),
        structuralSteelMat
      );
      girtBand.position.set(0, gy, -2.6);
      crusherGroup.add(girtBand);
    }

    // Contrasting Safety Yellow Roof Cornice Band (#eab308) around Roof Perimeter
    const roofCap = new THREE.Mesh(new THREE.BoxGeometry(17.2, 1.15, 12.6), roofTrimMat);
    roofCap.position.set(0, 24.45, -2.6);
    roofCap.castShadow = true;
    crusherGroup.add(roofCap);

    const roofDeck = new THREE.Mesh(new THREE.BoxGeometry(16.2, 0.45, 11.6), steelMat);
    roofDeck.position.set(0, 25.15, -2.6);
    crusherGroup.add(roofDeck);

    // Protective Hopper Canopy Hood at y = 16.0m above the receiving pocket (scanCone sits beneath at y = 15.5m..8.5m)
    const hopperCanopy = new THREE.Mesh(
      new THREE.BoxGeometry(13.2, 0.85, 5.4),
      structuralSteelMat
    );
    hopperCanopy.position.set(0, 16.1, 4.4);
    hopperCanopy.castShadow = true;
    crusherGroup.add(hopperCanopy);

    const hopperCanopyTrim = new THREE.Mesh(
      new THREE.BoxGeometry(13.5, 0.32, 5.65),
      roofTrimMat
    );
    hopperCanopyTrim.position.set(0, 16.45, 4.4);
    crusherGroup.add(hopperCanopyTrim);

    // Cantilevered Maintenance Gantry Crane (6.5m Safety Yellow I-Beam + Trolley + Cable + Hook)
    const craneGroup = new THREE.Group();
    const craneBeamWeb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.88, 6.5), roofTrimMat);
    craneBeamWeb.position.set(0, 22.8, 4.8);
    craneBeamWeb.castShadow = true;
    craneGroup.add(craneBeamWeb);

    const craneFlangeTop = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.18, 6.5), roofTrimMat);
    craneFlangeTop.position.set(0, 23.28, 4.8);
    craneGroup.add(craneFlangeTop);

    const craneFlangeBot = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.18, 6.5), roofTrimMat);
    craneFlangeBot.position.set(0, 22.32, 4.8);
    craneGroup.add(craneFlangeBot);

    // Diagonal steel tie rods bracing the 6.5m cantilever beam back to the upper facade
    for (const sideX of [-0.55, 0.55]) {
      const tieBrace = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 5.6, 8),
        structuralSteelMat
      );
      tieBrace.position.set(sideX, 23.85, 4.6);
      tieBrace.rotation.x = 1.18;
      craneGroup.add(tieBrace);
    }

    // Movable Telpher Hoist Trolley Carriage
    const telpherCarriage = new THREE.Mesh(
      new THREE.BoxGeometry(1.45, 0.82, 1.65),
      structuralSteelMat
    );
    telpherCarriage.position.set(0, 21.85, 4.6);
    telpherCarriage.castShadow = true;
    craneGroup.add(telpherCarriage);

    // Dual Hoist Wire Ropes & Heavy Hook Block over Crusher Spider
    for (const ropeX of [-0.24, 0.24]) {
      const hoistRope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 4.2, 8),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.25 })
      );
      hoistRope.position.set(ropeX, 19.45, 4.6);
      craneGroup.add(hoistRope);
    }

    const hookSheaveBlock = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.95, 0.52),
      wheelStopMat
    );
    hookSheaveBlock.position.set(0, 17.25, 4.6);
    craneGroup.add(hookSheaveBlock);

    const craneHook = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.1, 10, 18, Math.PI * 1.45),
      roofTrimMat
    );
    craneHook.position.set(0, 16.5, 4.6);
    craneHook.rotation.z = Math.PI * 0.8;
    craneGroup.add(craneHook);

    crusherGroup.add(craneGroup);

    // External Industrial Stairways, Intermediate Landings & Safety Yellow Handrails on Left Flank
    const stairSystemGroup = new THREE.Group();
    const landingCoords = [
      { y: 15.2, z: -5.8 },
      { y: 19.6, z: 0.2 },
      { y: 24.0, z: -5.8 },
    ];
    landingCoords.forEach((ld) => {
      const platform = new THREE.Mesh(
        new THREE.BoxGeometry(1.85, 0.24, 2.8),
        structuralSteelMat
      );
      platform.position.set(-9.25, ld.y, ld.z);
      platform.castShadow = true;
      stairSystemGroup.add(platform);

      const railOuter = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.8), roofTrimMat);
      railOuter.position.set(-10.1, ld.y + 1.05, ld.z);
      stairSystemGroup.add(railOuter);

      for (const rz of [-1.3, 1.3]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), roofTrimMat);
        post.position.set(-10.1, ld.y + 0.55, ld.z + rz);
        stairSystemGroup.add(post);
      }
    });

    const flightConfigs = [
      { yMid: 13.1, zMid: -2.6, rotX: -0.62, len: 6.8 },
      { yMid: 17.4, zMid: -2.8, rotX: 0.62, len: 6.8 },
      { yMid: 21.8, zMid: -2.8, rotX: -0.62, len: 6.8 },
    ];
    flightConfigs.forEach((fl) => {
      const flightGroup = new THREE.Group();
      flightGroup.position.set(-9.25, fl.yMid, fl.zMid);
      flightGroup.rotation.x = fl.rotX;

      for (const sx of [-0.65, 0.65]) {
        const stringer = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.28, fl.len),
          structuralSteelMat
        );
        stringer.position.x = sx;
        flightGroup.add(stringer);

        const handrail = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.08, fl.len),
          roofTrimMat
        );
        handrail.position.set(sx, 0.98, 0);
        flightGroup.add(handrail);
      }
      for (let s = -2.6; s <= 2.6; s += 0.65) {
        const stepTread = new THREE.Mesh(
          new THREE.BoxGeometry(1.2, 0.08, 0.28),
          structuralSteelMat
        );
        stepTread.position.set(0, 0.06, s);
        stepTread.rotation.x = -fl.rotX;
        flightGroup.add(stepTread);
      }
      stairSystemGroup.add(flightGroup);
    });
    crusherGroup.add(stairSystemGroup);

    // Custom Fresnel Volumetric Light Shader Factory (Zero hard cone edges, smooth Fresnel + vertical fade)
    const volumetricBeamMaterials: THREE.ShaderMaterial[] = [];
    const volumetricBeamMeshes: THREE.Mesh[] = [];
    const groundLightPoolMeshes: THREE.Mesh[] = [];
    const nightPointLights: Array<{ light: THREE.PointLight; nightIntensity: number; sunsetIntensity: number }> = [];

    function createVolumetricBeamMaterial(colorHex: number, initialOpacity = 0.65): THREE.ShaderMaterial {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(colorHex) },
          uOpacity: { value: initialOpacity },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: `
          varying vec3 vLocalPos;
          varying vec3 vWorldPos;
          varying vec2 vUv;
          varying mat3 vModelMat3;
          void main() {
            vUv = uv;
            vLocalPos = position;
            vModelMat3 = mat3(modelMatrix);
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying vec3 vLocalPos;
          varying vec3 vWorldPos;
          varying vec2 vUv;
          varying mat3 vModelMat3;
          void main() {
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            // Analytical per-pixel cylinder radial normal eliminates polygon facet banding completely
            vec3 localRadial = normalize(vec3(vLocalPos.x, 0.0, vLocalPos.z));
            vec3 worldNormal = normalize(vModelMat3 * localRadial);
            float fresnel = pow(abs(dot(viewDir, worldNormal)), 2.2);
            float vFade = smoothstep(0.0, 0.28, vUv.y) * pow(vUv.y, 1.15);
            float alpha = fresnel * vFade * uOpacity;
            gl_FragColor = vec4(uColor, alpha);
          }
        `,
      });
      volumetricBeamMaterials.push(mat);
      return mat;
    }

    const softPoolTex = createSoftParticleTexture();
    function createGroundLightPool(radius: number, colorHex: number): THREE.Mesh {
      const poolMat = new THREE.MeshBasicMaterial({
        map: softPoolTex,
        color: colorHex,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const poolMesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), poolMat);
      poolMesh.rotation.x = -Math.PI / 2;
      ssaoExcludedObjects.push(poolMesh);
      groundLightPoolMeshes.push(poolMesh);
      return poolMesh;
    }

    // Shared 1Hz Red Aviation Obstacle Strobe Material (for ККД-1 Gantry, Roof, Drills & Radar)
    const aviationBeaconMat = new THREE.MeshBasicMaterial({
      color: 0xff1133,
      toneMapped: false,
    });

    // Warm Industrial Amber Hopper Light inside ККД-1 Receiving Pocket
    const crusherHopperLight = new THREE.PointLight(0xff8c1a, 5.5, 38, 1.5);
    crusherHopperLight.position.set(0, 12.8, 4.6);
    crusherGroup.add(crusherHopperLight);
    nightPointLights.push({ light: crusherHopperLight, nightIntensity: 5.5, sunsetIntensity: 2.0 });

    // Aviation Red Obstacle Beacons on ККД-1 Roof & Cantilevered Gantry Crane Tip
    for (const [bx, by, bz] of [
      [0, 25.65, -2.6],
      [0, 23.65, 8.0],
    ]) {
      const avBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 12), aviationBeaconMat);
      avBeacon.position.set(bx, by, bz);
      crusherGroup.add(avBeacon);
    }

    // 2 Corner Floodlight Masts illuminating the Dump Pocket with Fresnel Volumetric Beams
    const crusherFloodEmissiveMat = new THREE.MeshStandardMaterial({
      color: 0xfff8dc,
      emissive: 0xfff0aa,
      emissiveIntensity: 3.2,
      toneMapped: false,
      roughness: 0.2,
    });
    const crusherBeamGeo = new THREE.CylinderGeometry(0.32, 4.2, 10.5, 64, 12, true);
    for (const sideSign of [-1, 1]) {
      const floodMastGroup = new THREE.Group();
      floodMastGroup.position.set(sideSign * 7.8, 11.0, 8.8);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.14, 4.8, 10),
        structuralSteelMat
      );
      pole.position.y = 2.4;
      pole.castShadow = true;
      floodMastGroup.add(pole);

      const crossArm = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 0.12, 0.12),
        structuralSteelMat
      );
      crossArm.position.y = 4.8;
      floodMastGroup.add(crossArm);

      for (const lx of [-0.4, 0.4]) {
        const fixture = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 0.28, 0.24),
          crusherFloodEmissiveMat
        );
        fixture.position.set(lx, 4.92, -0.1);
        fixture.rotation.y = sideSign * 0.45;
        fixture.rotation.x = 0.38;
        floodMastGroup.add(fixture);
      }

      const cBeam = new THREE.Mesh(
        crusherBeamGeo,
        createVolumetricBeamMaterial(0xfff2c2, 0.65)
      );
      cBeam.position.set(-sideSign * 2.2, 0.2, -1.8);
      cBeam.rotation.z = -sideSign * 0.38;
      cBeam.rotation.x = 0.32;
      floodMastGroup.add(cBeam);
      ssaoExcludedObjects.push(cBeam);
      volumetricBeamMeshes.push(cBeam);

      crusherGroup.add(floodMastGroup);
    }

    const bollardLamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x10b981, toneMapped: false })
    );
    bollardLamp.position.set(-7.8, 13.3, 9.1);
    crusherGroup.add(bollardLamp);

    scene.add(crusherGroup);

    // 4. Overland Spatial Steel Truss Conveyor Gallery & Two A-Frame Tubular Support Bents
    const convStart = new THREE.Vector3(
      crusherRimPos.x + 6,
      45,
      crusherRimPos.z - 2
    );
    const convEnd = new THREE.Vector3(
      crusherRimPos.x + 42,
      55.5,
      crusherRimPos.z - 10
    );
    const convDir = new THREE.Vector3().subVectors(convEnd, convStart);
    const convLen = convDir.length();
    const convMid = new THREE.Vector3().addVectors(convStart, convEnd).multiplyScalar(0.5);

    const trussGroup = new THREE.Group();
    trussGroup.position.copy(convMid);
    trussGroup.lookAt(convEnd);
    trussGroup.userData = { assetId: 'crusher' as MiningAssetId };

    // Invisible raycast proxy box so clicking anywhere on the open lattice bridge selects 'crusher'
    const trussHitProxy = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.6, convLen),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    trussGroup.add(trussHitProxy);

    const trussSteelMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.72,
      roughness: 0.34,
    });
    const galvanizedHoodMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.78,
      roughness: 0.28,
      side: THREE.DoubleSide,
    });

    // 4 Longitudinal Chord Beams of Spatial Truss (#475569)
    const chordGeo = new THREE.BoxGeometry(0.24, 0.24, convLen);
    for (const cx of [-1.45, 1.45]) {
      for (const cy of [-0.95, 1.15]) {
        const chord = new THREE.Mesh(chordGeo, trussSteelMat);
        chord.position.set(cx, cy, 0);
        chord.castShadow = true;
        trussGroup.add(chord);
      }
    }

    // Open Diagonal Lattice Bracing, Vertical Posts & Transverse Portal Frames along 12 Bays
    const bayCount = 12;
    const bayLen = convLen / bayCount;
    const diagLen = Math.hypot(bayLen, 2.1);
    const diagAngle = Math.atan2(bayLen, 2.1);
    const trussPostGeo = new THREE.BoxGeometry(0.18, 2.1, 0.18);
    const crossBeamGeo = new THREE.BoxGeometry(2.9, 0.18, 0.18);
    const diagBraceGeo = new THREE.BoxGeometry(0.14, diagLen, 0.14);

    for (let b = 0; b <= bayCount; b++) {
      const zBay = -convLen / 2 + b * bayLen;
      for (const sx of [-1.45, 1.45]) {
        const vPost = new THREE.Mesh(trussPostGeo, trussSteelMat);
        vPost.position.set(sx, 0.1, zBay);
        trussGroup.add(vPost);
      }
      const topStrut = new THREE.Mesh(crossBeamGeo, trussSteelMat);
      topStrut.position.set(0, 1.15, zBay);
      trussGroup.add(topStrut);

      const botStrut = new THREE.Mesh(crossBeamGeo, trussSteelMat);
      botStrut.position.set(0, -0.95, zBay);
      trussGroup.add(botStrut);

      if (b < bayCount) {
        const zMidBay = zBay + bayLen * 0.5;
        const tiltSign = b % 2 === 0 ? 1 : -1;
        for (const sx of [-1.45, 1.45]) {
          const diag = new THREE.Mesh(diagBraceGeo, trussSteelMat);
          diag.position.set(sx, 0.1, zMidBay);
          diag.rotation.x = tiltSign * diagAngle;
          trussGroup.add(diag);
        }
      }
    }

    // Troughed Conveyor Belt & Side Maintenance Walkway with Yellow Handrail
    const beltMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.45, 0.22, convLen),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
    );
    beltMesh.position.set(0.2, -0.52, 0);
    trussGroup.add(beltMesh);

    const walkwayDeck = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.1, convLen),
      structuralSteelMat
    );
    walkwayDeck.position.set(-1.02, -0.78, 0);
    trussGroup.add(walkwayDeck);

    const walkwayHandrail = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, convLen),
      roofTrimMat
    );
    walkwayHandrail.position.set(-1.32, 0.18, 0);
    trussGroup.add(walkwayHandrail);

    // Semi-Cylindrical Galvanized Arched Dust & Wind Hoods over Conveyor Belt
    const hoodArcGeo = new THREE.CylinderGeometry(
      0.88,
      0.88,
      bayLen * 0.72,
      14,
      1,
      true,
      -Math.PI * 0.5,
      Math.PI
    );
    hoodArcGeo.rotateX(Math.PI / 2);
    hoodArcGeo.rotateZ(Math.PI / 2);
    for (let b = 0; b < bayCount; b++) {
      const zMidBay = -convLen / 2 + (b + 0.5) * bayLen;
      const hood = new THREE.Mesh(hoodArcGeo, galvanizedHoodMat);
      hood.position.set(0.2, -0.25, zMidBay);
      hood.castShadow = true;
      trussGroup.add(hood);
    }

    // Two Rigid A-Frame Tubular Support Bents grounded on Concrete Footing Pads
    const convHorizAngle = Math.atan2(convEnd.x - convStart.x, convEnd.z - convStart.z);
    for (const frac of [0.34, 0.70]) {
      const bentTopWorld = new THREE.Vector3().lerpVectors(convStart, convEnd, frac);
      const groundY = 35.0;
      const topY = bentTopWorld.y - 0.95;
      const bentH = Math.max(4.0, topY - groundY);

      const bentGroup = new THREE.Group();
      bentGroup.position.set(bentTopWorld.x, groundY, bentTopWorld.z);
      bentGroup.rotation.y = convHorizAngle;
      bentGroup.userData = { assetId: 'crusher' as MiningAssetId };

      const legSpreadBottom = 2.65;
      const legSpreadTop = 1.25;
      const legDx = legSpreadBottom - legSpreadTop;
      const legLen = Math.hypot(bentH, legDx);
      const legTilt = Math.atan2(legDx, bentH);

      for (const sideSign of [-1, 1]) {
        // Concrete footing pad on +35m horizon
        const footingPad = new THREE.Mesh(
          new THREE.BoxGeometry(2.3, 1.3, 2.3),
          concMat
        );
        footingPad.position.set(sideSign * legSpreadBottom, 0.65, 0);
        footingPad.castShadow = true;
        footingPad.receiveShadow = true;
        bentGroup.add(footingPad);

        // Inclined tubular steel A-frame leg
        const tubeLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.36, legLen, 12),
          trussSteelMat
        );
        tubeLeg.position.set(
          sideSign * ((legSpreadBottom + legSpreadTop) * 0.5),
          bentH * 0.5 + 0.4,
          0
        );
        tubeLeg.rotation.z = sideSign * legTilt;
        tubeLeg.castShadow = true;
        bentGroup.add(tubeLeg);
      }

      // Horizontal and K-brace cross struts on A-frame bent
      const midTie = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, (legSpreadBottom + legSpreadTop) * 0.95, 10),
        trussSteelMat
      );
      midTie.rotation.z = Math.PI / 2;
      midTie.position.set(0, bentH * 0.52, 0);
      bentGroup.add(midTie);

      const capBeam = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.42, 0.85),
        trussSteelMat
      );
      capBeam.position.set(0, bentH + 0.1, 0);
      bentGroup.add(capBeam);

      scene.add(bentGroup);
    }

    // Neon Cyan Signal Light Strips along the Conveyor Gallery Truss
    const convSignalMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 2.4,
      toneMapped: false,
      roughness: 0.2,
    });
    const signalStripGeo = new THREE.BoxGeometry(0.1, 0.1, 0.75);
    for (let b = 0; b < bayCount; b++) {
      const zMidBay = -convLen / 2 + (b + 0.5) * bayLen;
      for (const sx of [-1.48, 1.48]) {
        const sigLamp = new THREE.Mesh(signalStripGeo, convSignalMat);
        sigLamp.position.set(sx, 1.22, zMidBay);
        trussGroup.add(sigLamp);
      }
    }

    const convOreLumps: THREE.Mesh[] = [];
    const lumpGeo = new THREE.DodecahedronGeometry(0.55, 0);
    const lumpMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.65,
      roughness: 0.75,
      flatShading: true,
    });
    for (let i = 0; i < 12; i++) {
      const lump = new THREE.Mesh(lumpGeo, lumpMat);
      trussGroup.add(lump);
      convOreLumps.push(lump);
    }
    scene.add(trussGroup);

    const spHeadhouse = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3.8, 4.4), roofTrimMat);
    spHeadhouse.position.copy(convEnd);
    spHeadhouse.castShadow = true;
    scene.add(spHeadhouse);

    const spMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: porphyryBenchTex.map,
      bumpMap: porphyryBenchTex.bumpMap,
      bumpScale: 0.9,
      roughness: 0.9,
      metalness: 0.15,
    });
    const stockpile = new THREE.Mesh(new THREE.ConeGeometry(24, 18.5, 36), spMat);
    stockpile.position.set(convEnd.x, 35 + 9.25, convEnd.z);
    stockpile.castShadow = true;
    stockpile.receiveShadow = true;
    stockpile.userData = { assetId: 'crusher' as MiningAssetId };
    scene.add(stockpile);

    // --- 5B. INDUSTRIAL HORIZON: SOF CONCENTRATOR PLANT, 28m POWER PYLONS (ЛЭП) & LIT STEPPE HIGHWAYS (r > 190m) ---
    const horizonIndustryGroup = new THREE.Group();
    const plantSteelMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.58,
      metalness: 0.64,
    });
    const plantRoofMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.65,
      metalness: 0.48,
    });

    // 1. SOF Concentrator Plant (Обогатительная фабрика Актогай — 460m..640m NE in continuation of conveyor)
    const sofPlantGroup = new THREE.Group();
    const plantBuildings = [
      // Main Grinding & Flotation Hall (Главный корпус измельчения и флотации)
      { x: 305, z: -415, w: 94, h: 32, d: 44, rotY: -0.58, hasMonitor: true },
      // Secondary Mill & Reagent Bay (Корпус реагентов и додрабливания)
      { x: 222, z: -448, w: 64, h: 24, d: 34, rotY: -0.58, hasMonitor: true },
    ];
    plantBuildings.forEach((b) => {
      const gy = 35.0 + getSteppeElevation(b.x, b.z);
      const bGroup = new THREE.Group();
      bGroup.position.set(b.x, gy, b.z);
      bGroup.rotation.y = b.rotY;

      const mainBox = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), plantSteelMat);
      mainBox.position.y = b.h * 0.5;
      mainBox.castShadow = true;
      mainBox.receiveShadow = true;
      bGroup.add(mainBox);

      if (b.hasMonitor) {
        const monitorRoof = new THREE.Mesh(
          new THREE.BoxGeometry(b.w * 0.82, 7.5, b.d * 0.48),
          plantRoofMat
        );
        monitorRoof.position.y = b.h + 3.75;
        bGroup.add(monitorRoof);
      }

      const yellowCornice = new THREE.Mesh(
        new THREE.BoxGeometry(b.w + 0.8, 1.2, b.d + 0.8),
        roofTrimMat
      );
      yellowCornice.position.y = b.h - 0.6;
      bGroup.add(yellowCornice);

      sofPlantGroup.add(bGroup);
    });

    // Radial Thickener Complex (Корпус сгустителей — 2 large cylindrical thickeners)
    for (const [tx, tz, rad] of [
      [388, -382, 26],
      [442, -412, 24],
    ]) {
      const gy = 35.0 + getSteppeElevation(tx, tz);
      const tGroup = new THREE.Group();
      tGroup.position.set(tx, gy, tz);
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(rad, rad, 8.5, 32),
        plantSteelMat
      );
      tank.position.y = 4.25;
      tGroup.add(tank);
      const coneCap = new THREE.Mesh(
        new THREE.ConeGeometry(rad + 0.8, 5.5, 32),
        plantRoofMat
      );
      coneCap.position.y = 11.25;
      tGroup.add(coneCap);
      const rakeBridge = new THREE.Mesh(
        new THREE.BoxGeometry(rad * 2.05, 1.8, 2.4),
        roofTrimMat
      );
      rakeBridge.position.y = 12.2;
      tGroup.add(rakeBridge);
      sofPlantGroup.add(tGroup);
    }

    // Concentrate Loadout Silos (4 cylindrical silos) & 2 Tall Exhaust Stacks with 1Hz Red Aviation Beacons
    const siloClusterCenter = { x: 255, z: -368 };
    const siloGy = 35.0 + getSteppeElevation(siloClusterCenter.x, siloClusterCenter.z);
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const sx = siloClusterCenter.x + (sIdx - 1.5) * 14.5;
      const sz = siloClusterCenter.z - (sIdx - 1.5) * 9.5;
      const silo = new THREE.Mesh(
        new THREE.CylinderGeometry(6.2, 6.2, 34, 20),
        plantSteelMat
      );
      silo.position.set(sx, siloGy + 17.0, sz);
      sofPlantGroup.add(silo);
    }
    for (const [stX, stZ, stH] of [
      [278, -445, 58],
      [338, -432, 52],
    ]) {
      const stGy = 35.0 + getSteppeElevation(stX, stZ);
      const stackMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.8, 3.2, stH, 16),
        plantSteelMat
      );
      stackMesh.position.set(stX, stGy + stH * 0.5, stZ);
      sofPlantGroup.add(stackMesh);

      const stackBeacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 10, 10),
        aviationBeaconMat
      );
      stackBeacon.position.set(stX, stGy + stH + 1.2, stZ);
      sofPlantGroup.add(stackBeacon);
    }

    // Night Factory Lights Cluster (72 glowing markers via InstancedMesh with AdditiveBlending)
    // 48 warm amber workshop windows (#fbbf24) + 24 white perimeter floodlights (#e0f2fe)
    const plantWindowCount = 48;
    const plantWindowGeo = new THREE.BoxGeometry(3.6, 1.8, 1.2);
    const plantWindowMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const plantWindowInst = new THREE.InstancedMesh(
      plantWindowGeo,
      plantWindowMat,
      plantWindowCount
    );
    const dummyPlantLight = new THREE.Object3D();
    let wIdx = 0;
    plantBuildings.forEach((b, bIdx) => {
      const gy = 35.0 + getSteppeElevation(b.x, b.z);
      const rows = 3;
      const cols = bIdx === 0 ? 10 : 6;
      const cosR = Math.cos(b.rotY);
      const sinR = Math.sin(b.rotY);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (wIdx >= plantWindowCount) break;
          const localX = ((c + 0.5) / cols - 0.5) * (b.w * 0.86);
          const localY = 7.5 + r * 7.2;
          const localZ = b.d * 0.5 + 0.35;
          const wx = b.x + localX * cosR + localZ * sinR;
          const wz = b.z - localX * sinR + localZ * cosR;
          dummyPlantLight.position.set(wx, gy + localY, wz);
          dummyPlantLight.rotation.set(0, b.rotY, 0);
          dummyPlantLight.updateMatrix();
          plantWindowInst.setMatrixAt(wIdx++, dummyPlantLight.matrix);
        }
      }
    });
    plantWindowInst.computeBoundingSphere();
    sofPlantGroup.add(plantWindowInst);
    ssaoExcludedObjects.push(plantWindowInst);

    const plantFloodCount = 24;
    const plantFloodGeo = new THREE.SphereGeometry(1.15, 10, 10);
    const plantFloodMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const plantFloodInst = new THREE.InstancedMesh(
      plantFloodGeo,
      plantFloodMat,
      plantFloodCount
    );
    for (let f = 0; f < plantFloodCount; f++) {
      const ang = (f / plantFloodCount) * Math.PI * 2;
      const rad = 75 + (f % 3) * 38;
      const fx = 315 + Math.cos(ang) * rad;
      const fz = -410 + Math.sin(ang) * (rad * 0.65);
      const fGy = 35.0 + getSteppeElevation(fx, fz);
      dummyPlantLight.position.set(fx, fGy + 16.0 + (f % 2) * 8.0, fz);
      dummyPlantLight.rotation.set(0, 0, 0);
      dummyPlantLight.updateMatrix();
      plantFloodInst.setMatrixAt(f, dummyPlantLight.matrix);
    }
    plantFloodInst.computeBoundingSphere();
    sofPlantGroup.add(plantFloodInst);
    ssaoExcludedObjects.push(plantFloodInst);

    horizonIndustryGroup.add(sofPlantGroup);

    // 2. High-Voltage Power Transmission Line (Магистральная ЛЭП — 8 lattice pylons, 28m height, r > 220m)
    const pylonCoords: Array<[number, number, number]> = [
      [205, -365, -0.45],
      [118, -322, -0.35],
      [22, -285, -0.25],
      [-72, -256, -0.15],
      [-162, -222, 0.25],
      [-228, -162, 0.65],
      [-268, -75, 1.05],
      [-292, 24, 1.35],
    ];
    const pylonCount = pylonCoords.length;
    const pylonBodyGeo = new THREE.CylinderGeometry(0.45, 2.1, 28.0, 4, 4, true);
    const pylonCrossArmGeo = new THREE.BoxGeometry(9.6, 0.55, 0.55);
    const pylonMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.78,
      roughness: 0.35,
      wireframe: true,
    });
    const pylonSolidMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.75,
      roughness: 0.4,
    });
    const pylonBodyInst = new THREE.InstancedMesh(pylonBodyGeo, pylonMat, pylonCount);
    const pylonArmLowerInst = new THREE.InstancedMesh(pylonCrossArmGeo, pylonSolidMat, pylonCount);
    const pylonArmUpperInst = new THREE.InstancedMesh(pylonCrossArmGeo, pylonSolidMat, pylonCount);
    const pylonBeaconGeo = new THREE.SphereGeometry(0.42, 8, 8);
    const pylonBeaconMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });
    const pylonBeaconInst = new THREE.InstancedMesh(pylonBeaconGeo, pylonBeaconMat, pylonCount);

    const powerLineVerts: number[] = [];
    const pylonTopPoints: Array<{ left: THREE.Vector3; right: THREE.Vector3 }> = [];

    pylonCoords.forEach(([px, pz, rotY], idx) => {
      const py = 35.0 + getSteppeElevation(px, pz);
      dummyPlantLight.position.set(px, py + 14.0, pz);
      dummyPlantLight.rotation.set(0, rotY + Math.PI / 4, 0);
      dummyPlantLight.scale.set(1, 1, 1);
      dummyPlantLight.updateMatrix();
      pylonBodyInst.setMatrixAt(idx, dummyPlantLight.matrix);

      dummyPlantLight.position.set(px, py + 21.5, pz);
      dummyPlantLight.rotation.set(0, rotY, 0);
      dummyPlantLight.updateMatrix();
      pylonArmLowerInst.setMatrixAt(idx, dummyPlantLight.matrix);

      dummyPlantLight.position.set(px, py + 25.5, pz);
      dummyPlantLight.rotation.set(0, rotY, 0);
      dummyPlantLight.scale.set(0.75, 1, 1);
      dummyPlantLight.updateMatrix();
      pylonArmUpperInst.setMatrixAt(idx, dummyPlantLight.matrix);

      dummyPlantLight.position.set(px, py + 28.4, pz);
      dummyPlantLight.scale.set(1, 1, 1);
      dummyPlantLight.updateMatrix();
      pylonBeaconInst.setMatrixAt(idx, dummyPlantLight.matrix);

      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const armOffset = 4.4;
      pylonTopPoints.push({
        left: new THREE.Vector3(px - cosY * armOffset, py + 21.5, pz + sinY * armOffset),
        right: new THREE.Vector3(px + cosY * armOffset, py + 21.5, pz - sinY * armOffset),
      });
    });

    // Catenary power conductors linking the 8 lattice pylons
    for (let i = 0; i < pylonTopPoints.length - 1; i++) {
      const pA = pylonTopPoints[i];
      const pB = pylonTopPoints[i + 1];
      for (const side of ['left', 'right'] as const) {
        const vStart = pA[side];
        const vEnd = pB[side];
        const segs = 8;
        for (let s = 0; s < segs; s++) {
          const u0 = s / segs;
          const u1 = (s + 1) / segs;
          const x0 = THREE.MathUtils.lerp(vStart.x, vEnd.x, u0);
          const z0 = THREE.MathUtils.lerp(vStart.z, vEnd.z, u0);
          const y0 = THREE.MathUtils.lerp(vStart.y, vEnd.y, u0) - Math.sin(u0 * Math.PI) * 2.4;
          const x1 = THREE.MathUtils.lerp(vStart.x, vEnd.x, u1);
          const z1 = THREE.MathUtils.lerp(vStart.z, vEnd.z, u1);
          const y1 = THREE.MathUtils.lerp(vStart.y, vEnd.y, u1) - Math.sin(u1 * Math.PI) * 2.4;
          powerLineVerts.push(x0, y0, z0, x1, y1, z1);
        }
      }
    }
    const powerLineGeo = new THREE.BufferGeometry();
    powerLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(powerLineVerts, 3));
    const powerLineSegments = new THREE.LineSegments(
      powerLineGeo,
      new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.55 })
    );
    horizonIndustryGroup.add(
      pylonBodyInst,
      pylonArmLowerInst,
      pylonArmUpperInst,
      pylonBeaconInst,
      powerLineSegments
    );
    ssaoExcludedObjects.push(pylonBeaconInst);

    // 3. Two Lit Steppe Access Highways (600m long, strictly r > 195m) with Warm Orange Streetlights
    const steppeHwyCurveA = new THREE.CatmullRomCurve3([
      new THREE.Vector3(156, 35.0 + getSteppeElevation(156, -162), -162),
      new THREE.Vector3(215, 35.0 + getSteppeElevation(215, -245), -245),
      new THREE.Vector3(275, 35.0 + getSteppeElevation(275, -335), -335),
      new THREE.Vector3(345, 35.0 + getSteppeElevation(345, -430), -430),
      new THREE.Vector3(435, 35.0 + getSteppeElevation(435, -535), -535),
    ]);
    const steppeHwyCurveB = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-158, 35.0 + getSteppeElevation(-158, -142), -142),
      new THREE.Vector3(-235, 35.0 + getSteppeElevation(-235, -210), -210),
      new THREE.Vector3(-325, 35.0 + getSteppeElevation(-325, -285), -285),
      new THREE.Vector3(-425, 35.0 + getSteppeElevation(-425, -355), -355),
      new THREE.Vector3(-535, 35.0 + getSteppeElevation(-535, -430), -430),
    ]);

    for (const hCurve of [steppeHwyCurveA, steppeHwyCurveB]) {
      const hRibbon = createRoadRibbonWithBerm(hCurve, 10.5, 0.42, 64);
      const hMesh = new THREE.Mesh(hRibbon.roadGeo, roadMat);
      hMesh.receiveShadow = true;
      horizonIndustryGroup.add(hMesh);
    }

    const hwyLampCount = 32;
    const hwyPoleGeo = new THREE.CylinderGeometry(0.12, 0.18, 9.5, 6);
    const hwyBulbGeo = new THREE.SphereGeometry(0.55, 8, 8);
    const hwyBulbMat = new THREE.MeshBasicMaterial({
      color: 0xff9e2c,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const hwyPoleInst = new THREE.InstancedMesh(hwyPoleGeo, pylonSolidMat, hwyLampCount);
    const hwyBulbInst = new THREE.InstancedMesh(hwyBulbGeo, hwyBulbMat, hwyLampCount);

    for (let l = 0; l < hwyLampCount; l++) {
      const isRoadA = l < 16;
      const curve = isRoadA ? steppeHwyCurveA : steppeHwyCurveB;
      const u = ((l % 16) + 0.5) / 16;
      const pt = curve.getPointAt(u);
      const tang = curve.getTangentAt(u).normalize();
      const norm = new THREE.Vector3().crossVectors(tang, new THREE.Vector3(0, 1, 0)).normalize();
      const lx = pt.x + norm.x * 6.4;
      const lz = pt.z + norm.z * 6.4;
      const ly = 35.0 + getSteppeElevation(lx, lz);

      dummyPlantLight.position.set(lx, ly + 4.75, lz);
      dummyPlantLight.rotation.set(0, 0, 0);
      dummyPlantLight.scale.set(1, 1, 1);
      dummyPlantLight.updateMatrix();
      hwyPoleInst.setMatrixAt(l, dummyPlantLight.matrix);

      dummyPlantLight.position.set(lx - norm.x * 0.8, ly + 9.6, lz - norm.z * 0.8);
      dummyPlantLight.updateMatrix();
      hwyBulbInst.setMatrixAt(l, dummyPlantLight.matrix);

      const hwyPool = createGroundLightPool(7.2, 0xff9e2c);
      hwyPool.position.set(pt.x, ly + 0.52, pt.z);
      horizonIndustryGroup.add(hwyPool);
    }
    hwyPoleInst.computeBoundingSphere();
    hwyBulbInst.computeBoundingSphere();
    horizonIndustryGroup.add(hwyPoleInst, hwyBulbInst);
    ssaoExcludedObjects.push(hwyBulbInst);

    scene.add(horizonIndustryGroup);

    // Geotechnical Slope Stability Radar (SSR-XT) Station synced to North Rim
    const radarRimPos = getBermWorldPoint(159.0, -Math.PI / 2, 35.0);
    const radarGroup = new THREE.Group();
    radarGroup.position.copy(radarRimPos);
    radarGroup.userData = { assetId: 'radar' as MiningAssetId };

    const radarHitBox = new THREE.Mesh(
      new THREE.BoxGeometry(12, 12, 12),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    radarHitBox.position.y = 5;
    radarGroup.add(radarHitBox);

    const trailerBase = new THREE.Mesh(
      new THREE.BoxGeometry(5.5, 2.2, 4.2),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4, metalness: 0.3 })
    );
    trailerBase.position.y = 1.4;
    trailerBase.castShadow = true;
    radarGroup.add(trailerBase);

    const solarPanel = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 0.15, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.8, roughness: 0.2 })
    );
    solarPanel.position.set(0, 3.2, -1.2);
    solarPanel.rotation.x = -0.35;
    radarGroup.add(solarPanel);

    const radarMast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.65, 5.5, 12),
      steelMat
    );
    radarMast.position.y = 4.8;
    radarGroup.add(radarMast);

    const radarTurret = new THREE.Group();
    radarTurret.position.y = 7.6;
    const dishMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.75,
      roughness: 0.25,
    });
    const dish = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.4, 1.1), dishMat);
    radarTurret.add(dish);

    const beamGeo = new THREE.ConeGeometry(82, 205, 20, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      wireframe: true,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const radarBeam = new THREE.Mesh(beamGeo, beamMat);
    radarBeam.rotation.x = -Math.PI / 2.08;
    radarBeam.position.set(0, 0, 102);
    radarTurret.add(radarBeam);
    // Register radarBeam in ssaoExcludedObjects so SSAO normal pass does not treat the 205m cone as solid geometry
    ssaoExcludedObjects.push(radarBeam);

    radarGroup.add(radarTurret);
    scene.add(radarGroup);

    // --- 6. DETAILED EQUIPMENT BUILDERS & SCALE ANCHORS ---
    const equipTextures = createCatEquipmentTextures(maxAniso);

    const sharedChassisMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.72,
      metalness: 0.55,
    });
    const sharedCatPaintMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: equipTextures.catPaintMap,
      roughnessMap: equipTextures.catRoughnessMap,
      roughness: 0.42,
      metalness: 0.22,
      clearcoat: 0.45,
      clearcoatRoughness: 0.28,
    });
    const sharedChromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.92,
      roughness: 0.14,
    });
    const sharedCabGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      metalness: 0.15,
      roughness: 0.1,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.78,
    });
    const sharedTireMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: equipTextures.tireMap,
      bumpMap: equipTextures.tireBumpMap,
      bumpScale: 0.45,
      roughness: 0.88,
      metalness: 0.05,
    });
    const sharedHubMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.4,
      metalness: 0.45,
    });

    // High-emission xenon headlight material (toneMapped: false for natural UnrealBloomPass glow)
    const sharedHeadlightMat = new THREE.MeshStandardMaterial({
      color: 0xe0f7ff,
      emissive: 0xccf2ff,
      emissiveIntensity: 3.6,
      toneMapped: false,
      roughness: 0.2,
    });

    // Warm operator cab interior illumination material
    const sharedCabInteriorMat = new THREE.MeshStandardMaterial({
      color: 0xffdcb0,
      emissive: 0xffa733,
      emissiveIntensity: 1.5,
      toneMapped: false,
      roughness: 0.3,
    });

    // Roof amber safety beacon material on CAT 793F cabs
    const sharedTruckBeaconMat = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      emissive: 0xff8800,
      emissiveIntensity: 2.6,
      toneMapped: false,
      roughness: 0.2,
    });

    interface TruckVisualRefs {
      root: THREE.Group;
      dumpBody: THREE.Group;
      wheels: THREE.Group[];
      oreHeap: THREE.Group;
      oreMeshes: THREE.Mesh[];
      brakeLightMat: THREE.MeshStandardMaterial;
    }

    function createDetailedCat793F(
      assetId: MiningAssetId,
      oreType: 'malachite' | 'sulfide' | 'overburden'
    ): TruckVisualRefs {
      const root = new THREE.Group();
      root.userData = { assetId };

      // No primitive shadowDisc — SSAOPass + PCFSoftShadowMap create natural contact occlusion under tires

      const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.05, 7.6), sharedChassisMat);
      chassis.position.set(0, 1.65, 0);
      chassis.castShadow = true;
      chassis.receiveShadow = true;
      root.add(chassis);

      const rearAxleBox = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 1.4), sharedChassisMat);
      rearAxleBox.position.set(0, 1.45, -2.0);
      rearAxleBox.castShadow = true;
      root.add(rearAxleBox);

      const tankL = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 12), sharedChassisMat);
      tankL.rotation.x = Math.PI / 2;
      tankL.position.set(-1.95, 1.55, 0.2);
      root.add(tankL);

      const tankR = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.0, 2.1), sharedChassisMat);
      tankR.position.set(1.95, 1.55, 0.2);
      root.add(tankR);

      const frontHood = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.65, 1.8), sharedCatPaintMat);
      frontHood.position.set(0, 2.55, 2.95);
      frontHood.castShadow = true;
      frontHood.receiveShadow = true;
      root.add(frontHood);

      const grille = new THREE.Mesh(
        new THREE.BoxGeometry(2.3, 1.35, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.75, roughness: 0.35 })
      );
      grille.position.set(0, 2.55, 3.82);
      root.add(grille);

      const stairs = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 0.18, 0.45),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.5 })
      );
      stairs.position.set(0.2, 2.35, 4.02);
      stairs.rotation.z = 0.42;
      root.add(stairs);

      const handrail = new THREE.Mesh(
        new THREE.BoxGeometry(2.85, 0.08, 0.08),
        sharedHubMat
      );
      handrail.position.set(0.2, 2.85, 4.18);
      handrail.rotation.z = 0.42;
      root.add(handrail);

      const headlightGeo = new THREE.BoxGeometry(0.45, 0.28, 0.15);
      const hlLeft = new THREE.Mesh(headlightGeo, sharedHeadlightMat);
      hlLeft.position.set(-1.75, 2.15, 3.85);
      root.add(hlLeft);
      const hlRight = new THREE.Mesh(headlightGeo, sharedHeadlightMat);
      hlRight.position.set(1.75, 2.15, 3.85);
      root.add(hlRight);

      // 1. Bright Circular Headlight Lens Halo Sprites (THREE.Sprite with soft white-blue halo #e2f1ff)
      const hlHaloMat = new THREE.SpriteMaterial({
        map: softPoolTex,
        color: 0xe2f1ff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      for (const hx of [-1.75, 1.75]) {
        const hlSprite = new THREE.Sprite(hlHaloMat);
        hlSprite.position.set(hx, 2.15, 3.98);
        hlSprite.scale.set(1.65, 1.65, 1.0);
        root.add(hlSprite);
        ssaoExcludedObjects.push(hlSprite);
      }

      // 2. Projected Ground Headlight Pool (PlaneGeometry(7.5, 16.0) at y = 0.14, z = +8.5m ahead of truck)
      const truckPoolMat = new THREE.MeshBasicMaterial({
        map: softPoolTex,
        color: 0xe2f1ff,
        transparent: true,
        opacity: 0.52,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const truckGroundPool = new THREE.Mesh(
        new THREE.PlaneGeometry(7.5, 16.0),
        truckPoolMat
      );
      truckGroundPool.rotation.x = -Math.PI / 2;
      truckGroundPool.position.set(0, 0.14, 8.5);
      root.add(truckGroundPool);
      ssaoExcludedObjects.push(truckGroundPool);
      groundLightPoolMeshes.push(truckGroundPool);

      // Rear LED Tail / Brake Lights (#ff1133) with dynamic 3x brake flare when stopped/loading/dumping
      const brakeLightMat = new THREE.MeshStandardMaterial({
        color: 0xff1133,
        emissive: 0xff1133,
        emissiveIntensity: 1.2,
        toneMapped: false,
        roughness: 0.2,
      });
      const tailLightGeo = new THREE.BoxGeometry(0.52, 0.24, 0.14);
      for (const tx of [-1.45, 1.45]) {
        const tailLamp = new THREE.Mesh(tailLightGeo, brakeLightMat);
        tailLamp.position.set(tx, 1.88, -3.82);
        root.add(tailLamp);
      }

      const cabShell = new THREE.Mesh(new THREE.BoxGeometry(1.65, 1.65, 1.95), sharedCatPaintMat);
      cabShell.position.set(-1.35, 3.75, 2.35);
      cabShell.castShadow = true;
      root.add(cabShell);

      // Warm Operator Cab Interior Dashboard Glow visible through tinted cab glass
      const cabInterior = new THREE.Mesh(
        new THREE.BoxGeometry(1.38, 0.72, 1.52),
        sharedCabInteriorMat
      );
      cabInterior.position.set(-1.35, 3.92, 2.4);
      root.add(cabInterior);

      const cabWindows = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.92, 1.78), sharedCabGlassMat);
      cabWindows.position.set(-1.35, 3.92, 2.4);
      root.add(cabWindows);

      // Flashing Roof Beacon on Operator Cab
      const cabBeacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 10),
        sharedTruckBeaconMat
      );
      cabBeacon.position.set(-1.35, 4.72, 2.35);
      root.add(cabBeacon);

      const deckRight = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.35, 2.1), sharedCatPaintMat);
      deckRight.position.set(0.85, 3.45, 2.35);
      root.add(deckRight);

      const exhaustStack = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.9, 10), sharedChromeMat);
      exhaustStack.position.set(1.45, 4.2, 1.65);
      root.add(exhaustStack);

      const cylGeo = new THREE.CylinderGeometry(0.22, 0.26, 2.4, 12);
      const cylL = new THREE.Mesh(cylGeo, sharedChromeMat);
      cylL.position.set(-0.95, 2.55, 0.85);
      cylL.rotation.x = -0.25;
      root.add(cylL);

      const cylR = new THREE.Mesh(cylGeo, sharedChromeMat);
      cylR.position.set(0.95, 2.55, 0.85);
      cylR.rotation.x = -0.25;
      root.add(cylR);

      // Dump body group with rear hinge pivot at (0, 2.85, -3.2) for hydraulic dump animation
      const dumpBodyGroup = new THREE.Group();
      dumpBodyGroup.position.set(0, 2.85, -3.2);

      const bedMain = new THREE.Mesh(new THREE.BoxGeometry(5.1, 2.15, 6.2), sharedCatPaintMat);
      bedMain.position.set(0, 0.60, 2.65);
      bedMain.rotation.x = 0.05;
      bedMain.castShadow = true;
      bedMain.receiveShadow = true;
      dumpBodyGroup.add(bedMain);

      const tailChute = new THREE.Mesh(new THREE.BoxGeometry(4.9, 1.25, 1.1), sharedCatPaintMat);
      tailChute.position.set(0, 0.70, -0.50);
      tailChute.rotation.x = 0.35;
      dumpBodyGroup.add(tailChute);

      const canopyVisor = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.28, 2.35), sharedCatPaintMat);
      canopyVisor.position.set(0, 1.80, 5.95);
      canopyVisor.rotation.x = -0.08;
      canopyVisor.castShadow = true;
      dumpBodyGroup.add(canopyVisor);

      const oreHeap = new THREE.Group();
      // Place oreHeap origin on the dump bed floor inside dumpBodyGroup so vertical fill scaling grows from bed floor
      oreHeap.position.set(0, 0.60, 2.65);
      const oreMeshes: THREE.Mesh[] = [];
      const oreColorHex =
        oreType === 'malachite' ? 0x10b981 : oreType === 'sulfide' ? 0xd97706 : 0x78716c;
      const oreEmissiveHex =
        oreType === 'malachite' ? 0x00f5d4 : oreType === 'sulfide' ? 0xff6b00 : 0x1e293b;
      const oreTex =
        oreType === 'malachite'
          ? malachiteBenchTex
          : oreType === 'sulfide'
          ? porphyryBenchTex
          : overburdenTex;

      const oreMat = new THREE.MeshStandardMaterial({
        color: oreColorHex,
        map: oreTex.map,
        bumpMap: oreTex.bumpMap,
        bumpScale: 0.85,
        emissive: oreEmissiveHex,
        emissiveIntensity: oreType === 'overburden' ? 0.08 : 0.32,
        roughness: 0.78,
        metalness: oreType === 'overburden' ? 0.05 : 0.22,
        flatShading: true,
      });

      const heapMain = new THREE.Mesh(new THREE.DodecahedronGeometry(1.95, 1), oreMat);
      heapMain.scale.set(1.2, 0.75, 1.55);
      heapMain.position.set(0, 1.20, 0.0);
      heapMain.castShadow = true;
      oreHeap.add(heapMain);
      oreMeshes.push(heapMain);

      const heapFront = new THREE.Mesh(new THREE.DodecahedronGeometry(1.45, 1), oreMat);
      heapFront.scale.set(1.15, 0.7, 1.1);
      heapFront.position.set(0.15, 1.05, 1.30);
      oreHeap.add(heapFront);
      oreMeshes.push(heapFront);

      const heapRear = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4, 1), oreMat);
      heapRear.scale.set(1.1, 0.65, 1.15);
      heapRear.position.set(-0.15, 1.00, -1.30);
      oreHeap.add(heapRear);
      oreMeshes.push(heapRear);

      dumpBodyGroup.add(oreHeap);
      root.add(dumpBodyGroup);

      const wheels: THREE.Group[] = [];
      const wheelConfigs: Array<{ x: number; y: number; z: number; dual: boolean }> = [
        { x: -2.15, y: 1.48, z: 2.35, dual: false },
        { x: 2.15, y: 1.48, z: 2.35, dual: false },
        { x: -2.1, y: 1.48, z: -2.0, dual: true },
        { x: 2.1, y: 1.48, z: -2.0, dual: true },
      ];

      const singleTireGeo = new THREE.CylinderGeometry(1.48, 1.48, 0.92, 24);
      const dualTireGeo = new THREE.CylinderGeometry(1.48, 1.48, 1.85, 24);
      const hubGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.98, 16);
      const dualHubGeo = new THREE.CylinderGeometry(0.68, 0.68, 1.92, 16);
      const capBoltGeo = new THREE.BoxGeometry(0.95, 0.22, 0.22);

      wheelConfigs.forEach((wc) => {
        const wGroup = new THREE.Group();
        wGroup.position.set(wc.x, wc.y, wc.z);

        const tire = new THREE.Mesh(wc.dual ? dualTireGeo : singleTireGeo, sharedTireMat);
        tire.rotation.z = Math.PI / 2;
        tire.castShadow = true;
        tire.receiveShadow = true;
        wGroup.add(tire);

        const hub = new THREE.Mesh(wc.dual ? dualHubGeo : hubGeo, sharedHubMat);
        hub.rotation.z = Math.PI / 2;
        wGroup.add(hub);

        const axleBar = new THREE.Mesh(capBoltGeo, sharedChassisMat);
        axleBar.position.x = wc.x > 0 ? (wc.dual ? 0.94 : 0.48) : (wc.dual ? -0.94 : -0.48);
        axleBar.rotation.z = Math.PI / 2;
        wGroup.add(axleBar);

        root.add(wGroup);
        wheels.push(wGroup);
      });

      return { root, dumpBody: dumpBodyGroup, wheels, oreHeap, oreMeshes, brakeLightMat };
    }

    interface ShovelVisualRefs {
      root: THREE.Group;
      revolvingGroup: THREE.Group;
      houseMesh: THREE.Mesh;
      stickGroup: THREE.Group;
      bucketGroup: THREE.Group;
      hoistCables: THREE.LineSegments;
      beaconMesh: THREE.Mesh;
    }

    function createDetailedCat7495Shovel(
      assetId: MiningAssetId,
      accentHex = 0xdc2626
    ): ShovelVisualRefs {
      const root = new THREE.Group();
      root.userData = { assetId };

      const crawlerMat = new THREE.MeshStandardMaterial({
        color: 0x18181b,
        bumpMap: equipTextures.tireBumpMap,
        bumpScale: 0.5,
        roughness: 0.88,
        metalness: 0.35,
      });

      const leftTrack = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.2, 9.6), crawlerMat);
      leftTrack.position.set(-2.7, 1.1, 0);
      leftTrack.castShadow = true;
      leftTrack.receiveShadow = true;
      root.add(leftTrack);

      const rightTrack = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.2, 9.6), crawlerMat);
      rightTrack.position.set(2.7, 1.1, 0);
      rightTrack.castShadow = true;
      rightTrack.receiveShadow = true;
      root.add(rightTrack);

      const carbody = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.4, 5.4), sharedChassisMat);
      carbody.position.set(0, 2.1, 0);
      root.add(carbody);

      const revolvingGroup = new THREE.Group();
      revolvingGroup.position.set(0, 2.8, 0);

      const isRed = accentHex === 0xdc2626;
      const houseMat = new THREE.MeshPhysicalMaterial({
        color: isRed || accentHex === 0x2563eb ? 0xffffff : accentHex,
        map: isRed
          ? steppeAndBermTex.shovelRedMap
          : accentHex === 0x2563eb
          ? steppeAndBermTex.shovelBlueMap
          : equipTextures.catPaintMap,
        roughness: 0.45,
        metalness: 0.25,
        clearcoat: 0.3,
      });
      const houseMesh = new THREE.Mesh(new THREE.BoxGeometry(6.6, 4.4, 7.6), houseMat);
      houseMesh.position.set(0, 2.2, -0.8);
      houseMesh.castShadow = true;
      houseMesh.receiveShadow = true;
      revolvingGroup.add(houseMesh);

      const counterweight = new THREE.Mesh(
        new THREE.BoxGeometry(6.8, 2.8, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.75, metalness: 0.4 })
      );
      counterweight.position.set(0, 1.5, -5.2);
      counterweight.castShadow = true;
      revolvingGroup.add(counterweight);

      const opCab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.5, 2.4), houseMat);
      opCab.position.set(2.6, 3.2, 2.2);
      opCab.castShadow = true;
      revolvingGroup.add(opCab);

      const opGlass = new THREE.Mesh(new THREE.BoxGeometry(2.18, 1.45, 2.2), sharedCabGlassMat);
      opGlass.position.set(2.6, 3.45, 2.35);
      revolvingGroup.add(opGlass);

      const hvac = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.85, 2.8),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 })
      );
      hvac.position.set(-0.6, 4.8, -1.5);
      revolvingGroup.add(hvac);

      const beaconMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xf59e0b })
      );
      beaconMesh.position.set(0, 5.5, -0.5);
      revolvingGroup.add(beaconMesh);

      const boomMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        metalness: 0.38,
        roughness: 0.42,
      });

      const gantryLegL = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 6.8, 8), boomMat);
      gantryLegL.position.set(-2.1, 6.6, -1.2);
      gantryLegL.rotation.x = 0.22;
      revolvingGroup.add(gantryLegL);

      const gantryLegR = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 6.8, 8), boomMat);
      gantryLegR.position.set(2.1, 6.6, -1.2);
      gantryLegR.rotation.x = 0.22;
      revolvingGroup.add(gantryLegR);

      const gantryCross = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 4.6, 8), boomMat);
      gantryCross.rotation.z = Math.PI / 2;
      gantryCross.position.set(0, 9.6, -1.9);
      revolvingGroup.add(gantryCross);

      const boomGroup = new THREE.Group();
      boomGroup.position.set(0, 2.2, 2.6);
      boomGroup.rotation.x = -0.76;

      const boomChordL = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.85, 14.5), boomMat);
      boomChordL.position.set(-0.95, 0, 7.0);
      boomChordL.castShadow = true;
      boomGroup.add(boomChordL);

      const boomChordR = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.85, 14.5), boomMat);
      boomChordR.position.set(0.95, 0, 7.0);
      boomChordR.castShadow = true;
      boomGroup.add(boomChordR);

      const sheaveGeo = new THREE.CylinderGeometry(1.15, 1.15, 0.45, 20);
      const sheaveL = new THREE.Mesh(sheaveGeo, sharedChassisMat);
      sheaveL.rotation.z = Math.PI / 2;
      sheaveL.position.set(-0.95, 0.2, 14.2);
      boomGroup.add(sheaveL);

      const sheaveR = new THREE.Mesh(sheaveGeo, sharedChassisMat);
      sheaveR.rotation.z = Math.PI / 2;
      sheaveR.position.set(0.95, 0.2, 14.2);
      boomGroup.add(sheaveR);

      revolvingGroup.add(boomGroup);

      const stickGroup = new THREE.Group();
      stickGroup.position.set(0, 7.2, 7.4);

      const dipperStick = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.85, 9.8),
        sharedChassisMat
      );
      dipperStick.position.set(0, 0, 1.8);
      dipperStick.castShadow = true;
      stickGroup.add(dipperStick);

      const bucketGroup = new THREE.Group();
      bucketGroup.position.set(0, -0.4, 6.6);

      const bucketShell = new THREE.Mesh(
        new THREE.BoxGeometry(3.1, 2.4, 2.8),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.45 })
      );
      bucketShell.castShadow = true;
      bucketGroup.add(bucketShell);

      const toothGeo = new THREE.ConeGeometry(0.22, 0.85, 4);
      for (let t = -2; t <= 2; t++) {
        const tooth = new THREE.Mesh(toothGeo, sharedHubMat);
        tooth.rotation.x = Math.PI / 2;
        tooth.position.set(t * 0.62, -0.85, 1.65);
        bucketGroup.add(tooth);
      }

      const bucketOre = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.35, 1),
        new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.8, flatShading: true })
      );
      bucketOre.scale.set(1.05, 0.7, 0.95);
      bucketOre.position.set(0, 0.85, 0.1);
      bucketGroup.add(bucketOre);

      stickGroup.add(bucketGroup);
      revolvingGroup.add(stickGroup);

      const cablePositions = new Float32Array(4 * 2 * 3);
      const cableGeo = new THREE.BufferGeometry();
      cableGeo.setAttribute('position', new THREE.BufferAttribute(cablePositions, 3));
      const cableMat = new THREE.LineBasicMaterial({ color: 0xcbd5e1 });
      const hoistCables = new THREE.LineSegments(cableGeo, cableMat);
      revolvingGroup.add(hoistCables);

      root.add(revolvingGroup);

      return {
        root,
        revolvingGroup,
        houseMesh,
        stickGroup,
        bucketGroup,
        hoistCables,
        beaconMesh,
      };
    }

    // Place Shovels in Dedicated Loading Bays (18m-radius horizontal rock shelves off the 11.4m haul road)
    const ex1BermPos = getBermWorldPoint(114.0, 0.72, 19.0);
    const ex1PadMat = new THREE.MeshStandardMaterial({
      color: 0x6b7c73,
      map: steppeAndBermTex.bermMap,
      bumpMap: malachiteBenchTex.bumpMap,
      bumpScale: 0.65,
      roughness: 0.92,
      metalness: 0.08,
    });
    const ex1PadMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(13.5, 15.5, 4.0, 36),
      ex1PadMat
    );
    const ex1PadCenter = getBermWorldPoint(115.5, 0.72, 19.0);
    ex1PadMesh.position.set(ex1PadCenter.x, 19.0 - 2.02, ex1PadCenter.z);
    ex1PadMesh.receiveShadow = true;
    ex1PadMesh.castShadow = true;
    scene.add(ex1PadMesh);

    const ex1Refs = createDetailedCat7495Shovel('ex-01', 0xdc2626);
    ex1Refs.root.position.copy(ex1BermPos);
    ex1Refs.root.rotation.y = Math.atan2(ex1BermPos.x, ex1BermPos.z) + Math.PI * 0.75;
    scene.add(ex1Refs.root);

    const ex2BermPos = getBermWorldPoint(24.0, 2.25, 3.0);
    const ex2PadMat = new THREE.MeshStandardMaterial({
      color: 0x646e78,
      map: steppeAndBermTex.bermMap,
      bumpMap: porphyryBenchTex.bumpMap,
      bumpScale: 0.65,
      roughness: 0.92,
      metalness: 0.08,
    });
    const ex2PadMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(18.0, 22.5, 5.2, 36),
      ex2PadMat
    );
    ex2PadMesh.position.set(ex2BermPos.x, 3.0 - 2.62, ex2BermPos.z);
    ex2PadMesh.receiveShadow = true;
    ex2PadMesh.castShadow = true;
    scene.add(ex2PadMesh);

    const ex2Refs = createDetailedCat7495Shovel('ex-02', 0x2563eb);
    ex2Refs.root.position.copy(ex2BermPos);
    ex2Refs.root.rotation.y = Math.atan2(ex2BermPos.x, ex2BermPos.z) + Math.PI * 0.65;
    scene.add(ex2Refs.root);

    const ex3BermPos = ex3StartPos.clone();
    const ex3Refs = createDetailedCat7495Shovel('ex-03', 0xd97706);
    ex3Refs.root.position.copy(ex3BermPos);
    ex3Refs.root.rotation.y = Math.atan2(ex3BermPos.x, ex3BermPos.z);
    scene.add(ex3Refs.root);

    // CAT MD6250 / СБШ Blast-Hole Drill Rigs (True 8.8m mast scale relative to 8m bench)
    function createDrillRig(assetId: MiningAssetId): THREE.Group {
      const dg = new THREE.Group();
      dg.userData = { assetId };

      const trackL = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.0, 6.2), sharedChassisMat);
      trackL.position.set(-1.35, 0.5, 0);
      trackL.castShadow = true;
      dg.add(trackL);
      const trackR = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.0, 6.2), sharedChassisMat);
      trackR.position.set(1.35, 0.5, 0);
      trackR.castShadow = true;
      dg.add(trackR);

      // Platform corrected to (3.4, 1.8, 7.2)
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.8, 7.2), sharedCatPaintMat);
      body.position.y = 1.75;
      body.castShadow = true;
      body.receiveShadow = true;
      dg.add(body);

      // Operator cab corrected to (1.4, 1.5, 1.6)
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.6), sharedCabGlassMat);
      cab.position.set(-1.1, 2.85, 2.35);
      dg.add(cab);

      // Mast height corrected from 13.5m to 8.8m
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.88, 8.8, 0.88), sharedCatPaintMat);
      mast.position.set(0, 5.4, 2.65);
      mast.castShadow = true;
      dg.add(mast);

      // Red Aviation Warning Strobe Beacon atop 8.8m Drill Mast
      const mastBeacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 10, 10),
        aviationBeaconMat
      );
      mastBeacon.position.set(0, 9.95, 2.65);
      dg.add(mastBeacon);

      // Drill pipe matched to 8.8m mast
      const drillPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 9.2, 10), sharedChromeMat);
      drillPipe.position.set(0, 4.9, 2.8);
      dg.add(drillPipe);

      // Dust shroud skirt at blast-hole collar
      const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 0.7, 12), sharedChassisMat);
      shroud.position.set(0, 0.35, 2.8);
      dg.add(shroud);

      return dg;
    }

    const drill1Pos = getBermWorldPoint(97.5, 1.48, 19.0);
    const drill1 = createDrillRig('drill-01');
    drill1.position.copy(drill1Pos);
    drill1.rotation.y = 0.6;
    scene.add(drill1);

    const drill2Pos = getBermWorldPoint(68.5, 2.52, 11.0);
    const drill2 = createDrillRig('drill-02');
    drill2.position.copy(drill2Pos);
    drill2.rotation.y = -1.1;
    scene.add(drill2);

    // --- 6B. INDUSTRIAL SCALE ANCHORS: LIGHT TOWERS, 6.6kV SUBSTATIONS, SIGNBOARDS & FOREMAN CABIN ---

    const lightTowerFloodMat = new THREE.MeshStandardMaterial({
      color: 0xfff8dc,
      emissive: 0xfff0aa,
      emissiveIntensity: 3.4,
      toneMapped: false,
      roughness: 0.2,
    });

    const lightTowerBeamGeo = new THREE.CylinderGeometry(0.55, 5.2, 11.0, 64, 12, true);

    function createLightTower(): THREE.Group {
      const lt = new THREE.Group();

      // Single-axle generator trailer chassis
      const trailer = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.1, 2.4),
        new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.45, metalness: 0.25 })
      );
      trailer.position.y = 0.9;
      trailer.castShadow = true;
      lt.add(trailer);

      const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 12);
      const wL = new THREE.Mesh(wheelGeo, sharedTireMat);
      wL.rotation.z = Math.PI / 2;
      wL.position.set(-0.9, 0.42, 0);
      lt.add(wL);
      const wR = new THREE.Mesh(wheelGeo, sharedTireMat);
      wR.rotation.z = Math.PI / 2;
      wR.position.set(0.9, 0.42, 0);
      lt.add(wR);

      // Outrigger jacks
      const jackBar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.14), sharedChassisMat);
      jackBar.position.set(0, 0.45, -1.0);
      lt.add(jackBar);

      // 8.5m telescopic mast
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 8.5, 8), sharedChromeMat);
      mast.position.set(0, 4.75, 0.6);
      mast.castShadow = true;
      lt.add(mast);

      // Crossbar with 4 LED floodlight fixtures
      const crossBar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.12), sharedChassisMat);
      crossBar.position.set(0, 8.95, 0.6);
      lt.add(crossBar);

      for (let i = -1.5; i <= 1.5; i += 1.0) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.26, 0.22), lightTowerFloodMat);
        lamp.position.set(i * 0.48, 9.12, 0.68);
        lamp.rotation.x = 0.35;
        lt.add(lamp);
      }

      // Open-ended CylinderGeometry with Fresnel Volumetric Light Shader aligned directly to crossbar lamps
      const floodCone = new THREE.Mesh(
        lightTowerBeamGeo,
        createVolumetricBeamMaterial(0xfff2c2, 0.65)
      );
      floodCone.position.set(0, 4.15, 3.02);
      floodCone.rotation.x = -0.44;
      lt.add(floodCone);
      ssaoExcludedObjects.push(floodCone);
      volumetricBeamMeshes.push(floodCone);

      // Horizontal soft light pool on the ground beneath the floodlight beam
      const groundPool = createGroundLightPool(9.5, 0xffe89e);
      groundPool.position.set(0, 0.14, 5.0);
      lt.add(groundPool);

      // Real PointLight illuminating nearby benches, shovels, and haul trucks
      const towerPointLight = new THREE.PointLight(0xfff1b8, 3.6, 52, 1.6);
      towerPointLight.position.set(0, 8.8, 2.5);
      lt.add(towerPointLight);
      nightPointLights.push({ light: towerPointLight, nightIntensity: 3.6, sunsetIntensity: 1.2 });

      return lt;
    }

    // Place 6 Mobile Pit Light Towers at key operational zones
    const lightTowerPlacements = [
      { pos: getBermWorldPoint(111.5, 0.86, 19.0), rotY: -1.1 }, // EX-01 loading bay face
      { pos: getBermWorldPoint(26.5, 2.02, 3.0), rotY: -2.2 },  // EX-02 loading bay face
      { pos: getBermWorldPoint(127.0, -2.22, 28.0), rotY: 0.8 }, // EX-03 face
      { pos: getBermWorldPoint(72.0, 2.15, 11.0), rotY: 1.4 },   // Mid-bench +250m turnout
      { pos: getBermWorldPoint(98.5, 1.36, 19.0), rotY: -0.6 }, // Drill-01 pattern
      { pos: new THREE.Vector3(crusherRimPos.x - 16, 35.0, crusherRimPos.z + 14), rotY: 0.4 }, // Crusher pad
    ];
    lightTowerPlacements.forEach((ltCfg) => {
      const tower = createLightTower();
      tower.position.copy(ltCfg.pos);
      tower.rotation.y = ltCfg.rotY;
      scene.add(tower);
    });

    // 6.6 kV Skid-Mounted Transformer Substation (КТПП), Cable Reel & Road Cable Crossover Bridge for Electric Shovels
    function createShovelPowerInfrastructure(
      subPos: THREE.Vector3,
      shovelPos: THREE.Vector3
    ): THREE.Group {
      const pGroup = new THREE.Group();

      // Skid-mounted 6.6kV mobile substation (КТПП)
      const skid = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.25, 5.2), sharedChassisMat);
      skid.position.copy(subPos).add(new THREE.Vector3(0, 0.12, 0));
      pGroup.add(skid);

      const transformerBody = new THREE.Mesh(
        new THREE.BoxGeometry(3.1, 2.7, 4.4),
        new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.48, metalness: 0.45 })
      );
      transformerBody.position.copy(subPos).add(new THREE.Vector3(0, 1.55, 0));
      transformerBody.castShadow = true;
      transformerBody.receiveShadow = true;
      pGroup.add(transformerBody);

      // High-voltage ceramic bushings on roof
      for (let b = -1; b <= 1; b++) {
        const bushing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.16, 0.85, 8),
          new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.3 })
        );
        bushing.position.copy(subPos).add(new THREE.Vector3(b * 0.65, 3.3, -1.2));
        pGroup.add(bushing);
      }

      // Trailing cable drum stand midway
      const midPos = new THREE.Vector3().lerpVectors(subPos, shovelPos, 0.38);
      const reelDrum = new THREE.Mesh(
        new THREE.CylinderGeometry(1.15, 1.15, 1.4, 16),
        new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5, metalness: 0.3 })
      );
      reelDrum.rotation.z = Math.PI / 2;
      reelDrum.position.copy(midPos).add(new THREE.Vector3(0, 1.2, 0));
      reelDrum.castShadow = true;
      pGroup.add(reelDrum);

      // Protective yellow-black rubber cable crossover ramp across haul access
      const bridgePos = new THREE.Vector3().lerpVectors(subPos, shovelPos, 0.68);
      const cableBridge = new THREE.Mesh(
        new THREE.BoxGeometry(6.2, 0.28, 1.35),
        new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.75 })
      );
      cableBridge.position.copy(bridgePos).add(new THREE.Vector3(0, 0.16, 0));
      cableBridge.rotation.y = Math.atan2(shovelPos.x - subPos.x, shovelPos.z - subPos.z);
      cableBridge.receiveShadow = true;
      pGroup.add(cableBridge);

      // Flexible armored 6.6kV trailing power cable
      const cableCurve = new THREE.CatmullRomCurve3([
        subPos.clone().add(new THREE.Vector3(0, 0.6, 0)),
        midPos.clone().add(new THREE.Vector3(0, 0.35, 0)),
        bridgePos.clone().add(new THREE.Vector3(0, 0.22, 0)),
        shovelPos.clone().add(new THREE.Vector3(0, 0.8, 0)),
      ]);
      const cableTube = new THREE.Mesh(
        new THREE.TubeGeometry(cableCurve, 28, 0.11, 8, false),
        new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85 })
      );
      pGroup.add(cableTube);

      return pGroup;
    }

    scene.add(
      createShovelPowerInfrastructure(
        getBermWorldPoint(108.5, 0.94, 19.0),
        ex1BermPos
      )
    );
    scene.add(
      createShovelPowerInfrastructure(
        getBermWorldPoint(31.5, 1.92, 3.0),
        ex2BermPos
      )
    );

    // Procedural Mining Horizon Signboards & Warning Pickets
    function createMineSignboard(
      titleText: string,
      subText: string,
      bgHex: string,
      borderHex: string
    ): THREE.Group {
      const sg = new THREE.Group();
      const can = document.createElement('canvas');
      can.width = 256;
      can.height = 128;
      const ctx = can.getContext('2d')!;
      ctx.fillStyle = bgHex;
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = borderHex;
      ctx.lineWidth = 8;
      ctx.strokeRect(6, 6, 244, 116);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(titleText, 128, 56);
      ctx.fillStyle = borderHex;
      ctx.font = 'bold 18px monospace';
      ctx.fillText(subText, 128, 94);

      const tex = new THREE.CanvasTexture(can);
      tex.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 1.65, 0.14),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 })
      );
      board.position.y = 2.6;
      board.castShadow = true;
      sg.add(board);

      const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 8), sharedChassisMat);
      postL.position.set(-1.2, 1.3, 0);
      sg.add(postL);
      const postR = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 8), sharedChassisMat);
      postR.position.set(1.2, 1.3, 0);
      sg.add(postR);

      return sg;
    }

    const signConfigs = [
      {
        pos: getBermWorldPoint(108.5, 0.60, 19.0),
        rotY: -0.8,
        title: 'ГОРИЗОНТ +280м',
        sub: 'МАЛАХИТ · СЛЕПАЯ ЗОНА 15М',
        bg: '#0f172a',
        border: '#10b981',
      },
      {
        pos: getBermWorldPoint(31.5, 2.52, 3.0),
        rotY: -1.8,
        title: 'ГОРИЗОНТ +220м',
        sub: 'СУЛЬФИДЫ · СЛЕПАЯ ЗОНА 15М',
        bg: '#0f172a',
        border: '#f59e0b',
      },
      {
        pos: getBermWorldPoint(125.0, -2.48, 28.0),
        rotY: 0.7,
        title: 'ГОРИЗОНТ +310м',
        sub: 'ВСКРЫША · ПРОЕЗД К ОТВАЛУ',
        bg: '#0f172a',
        border: '#eab308',
      },
      {
        pos: getBermWorldPoint(73.5, 1.85, 11.0),
        rotY: -1.2,
        title: 'УКЛОН 8% · РАЗЪЕЗД',
        sub: 'ДИСТАНЦИЯ МЕЖДУ CAT 28М',
        bg: '#1e1b4b',
        border: '#38bdf8',
      },
    ];
    signConfigs.forEach((sc) => {
      const sign = createMineSignboard(sc.title, sc.sub, sc.bg, sc.border);
      sign.position.copy(sc.pos);
      sign.rotation.y = sc.rotY;
      scene.add(sign);
    });

    // Modular Shift Foreman Cabin (Бытовка горного мастера) on +280m safety berm
    function createForemanCabin(): THREE.Group {
      const fg = new THREE.Group();
      const containerBox = new THREE.Mesh(
        new THREE.BoxGeometry(6.2, 2.7, 2.9),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.55, metalness: 0.25 })
      );
      containerBox.position.y = 1.45;
      containerBox.castShadow = true;
      containerBox.receiveShadow = true;
      fg.add(containerBox);

      const roofTrim = new THREE.Mesh(
        new THREE.BoxGeometry(6.35, 0.22, 3.05),
        new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 })
      );
      roofTrim.position.y = 2.85;
      fg.add(roofTrim);

      const win = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.95, 0.1), sharedCabGlassMat);
      win.position.set(-1.2, 1.65, 1.45);
      fg.add(win);

      // Split AC outdoor unit
      const acUnit = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.62, 0.38),
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.5 })
      );
      acUnit.position.set(1.8, 2.1, 1.6);
      fg.add(acUnit);

      // VHF / Mesh Radio Telemetry Mast
      const radioMast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.09, 6.8, 8),
        sharedChromeMat
      );
      radioMast.position.set(2.8, 4.4, -1.2);
      fg.add(radioMast);

      return fg;
    }

    const foremanCabin = createForemanCabin();
    foremanCabin.position.copy(getBermWorldPoint(98.0, 1.12, 19.0));
    foremanCabin.rotation.y = -0.9;
    scene.add(foremanCabin);

    // Haul Truck Fleet & 4-Phase Round-Trip Finite State Machine (FSM)
    interface TruckKinematicsState {
      curve: THREE.CatmullRomCurve3;
      progress: number; // 0.0 (забой/экскаватор) ... 1.0 (ККД-1 / отвал)
      phase: TruckFsmPhase;
      phaseTimer: number;
      speed: number;
      totalKm: number;
      wheelAngle: number;
      bedAngle: number;
      dumpedBurstDone?: boolean;
    }

    const truckVisuals: Record<string, TruckVisualRefs> = {};
    const truckKinematics: Record<string, TruckKinematicsState> = {
      'truck-01': {
        curve: routeEX1,
        progress: 0.62,
        phase: 'HAULING_UP',
        phaseTimer: 0.0,
        speed: 14.5,
        totalKm: 3.6,
        wheelAngle: 0,
        bedAngle: 0,
      },
      'truck-02': {
        curve: routeEX1,
        progress: 0.0,
        phase: 'LOADING',
        phaseTimer: 1.2,
        speed: 0.0,
        totalKm: 3.6,
        wheelAngle: 0,
        bedAngle: 0,
      },
      'truck-03': {
        curve: routeEX2,
        progress: 1.0,
        phase: 'DUMPING',
        phaseTimer: 0.8,
        speed: 0.0,
        totalKm: 4.2,
        wheelAngle: 0,
        bedAngle: 0.33,
        dumpedBurstDone: false,
      },
      'truck-04': {
        curve: routeEX2,
        progress: 0.48,
        phase: 'RETURNING_EMPTY',
        phaseTimer: 0.0,
        speed: 28.0,
        totalKm: 4.2,
        wheelAngle: 0,
        bedAngle: 0,
      },
      'truck-05': {
        curve: routeEX3,
        progress: 0.28,
        phase: 'HAULING_UP',
        phaseTimer: 0.0,
        speed: 14.5,
        totalKm: 2.8,
        wheelAngle: 0,
        bedAngle: 0,
      },
    };

    INITIAL_TRUCKS.forEach((tInfo) => {
      const vRef = createDetailedCat793F(tInfo.id, tInfo.oreType);
      const initTk = truckKinematics[tInfo.id];
      vRef.oreHeap.visible = initTk ? initTk.phase !== 'RETURNING_EMPTY' : true;
      truckVisuals[tInfo.id] = vRef;
      scene.add(vRef.root);
    });

    // Collect all selectable asset roots for high-performance Raycasting
    const selectableRoots: THREE.Object3D[] = [
      ...Object.values(truckVisuals).map((v) => v.root),
      ex1Refs.root,
      ex2Refs.root,
      ex3Refs.root,
      drill1,
      drill2,
      crusherGroup,
      trussGroup,
      stockpile,
      radarGroup,
      wasteDumpGroup,
    ];

    // --- 7. RAYCASTING WITH DRAG PROTECTION (< 5px) & POINTER HOVER ---
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let isPointerDown = false;
    let lastHoverCheckMs = 0;

    function resolveAssetIdFromObject(obj: THREE.Object3D | null): MiningAssetId | null {
      let curr: THREE.Object3D | null = obj;
      while (curr) {
        if (curr.userData && curr.userData.assetId) {
          return curr.userData.assetId as MiningAssetId;
        }
        curr = curr.parent;
      }
      return null;
    }

    function updatePointerNdc(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    }

    function onPointerDown(e: PointerEvent) {
      isPointerDown = true;
      downX = e.clientX;
      downY = e.clientY;
    }

    function onPointerMove(e: PointerEvent) {
      const now = performance.now();
      if (isPointerDown || now - lastHoverCheckMs < 55) return;
      lastHoverCheckMs = now;

      updatePointerNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(selectableRoots, true);
      const hitAsset = hits.length > 0 ? resolveAssetIdFromObject(hits[0].object) : null;
      renderer.domElement.style.cursor = hitAsset ? 'pointer' : 'grab';
    }

    function onPointerUp(e: PointerEvent) {
      if (!isPointerDown) return;
      isPointerDown = false;

      // Drag Guard: ignore click if mouse/touch moved >= 5 pixels during OrbitControls drag
      const moveDist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moveDist >= 5) return;

      updatePointerNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(selectableRoots, true);
      if (hits.length > 0) {
        const hitAsset = resolveAssetIdFromObject(hits[0].object);
        if (hitAsset) {
          threeActionsRef.current.selectAsset(hitAsset);
        }
      }
    }

    const domElem = renderer.domElement;
    domElem.addEventListener('pointerdown', onPointerDown);
    domElem.addEventListener('pointermove', onPointerMove);
    domElem.addEventListener('pointerup', onPointerUp);

    // --- 8. DYNAMIC EXPANDING 1000-PARTICLE DUST SYSTEM (TIRES, SHOVELS, DRILLS, CRUSHER) ---
    const DUST_COUNT = 1000;
    const dustPositions = new Float32Array(DUST_COUNT * 3);
    const dustLives = new Float32Array(DUST_COUNT);
    const dustScales = new Float32Array(DUST_COUNT);

    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    dustGeo.setAttribute('aLife', new THREE.BufferAttribute(dustLives, 1));
    dustGeo.setAttribute('aScale', new THREE.BufferAttribute(dustScales, 1));

    const dustSpriteTex = createSoftParticleTexture();
    const dustMat = new THREE.PointsMaterial({
      color: 0xd4c4b0,
      map: dustSpriteTex,
      size: 4.8,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });

    dustMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           attribute float aLife;
           attribute float aScale;
           varying float vLife;`
        )
        .replace(
          'gl_PointSize = size;',
          `vLife = clamp(aLife, 0.0, 1.0);
           float scale = aScale * mix(1.0, 3.8, 1.0 - vLife);
           gl_PointSize = size * scale;`
        )
        .replace(
          'gl_PointSize *= ( scale / - mvPosition.z );',
          'gl_PointSize = size * aScale * mix(1.0, 3.8, 1.0 - clamp(aLife, 0.0, 1.0)) * (300.0 / max(1.0, -mvPosition.z));'
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying float vLife;`
        )
        .replace(
          '#include <premultiplied_alpha_fragment>',
          `gl_FragColor.a *= clamp(vLife, 0.0, 1.0);
           #include <premultiplied_alpha_fragment>`
        );
    };

    const dustPoints = new THREE.Points(dustGeo, dustMat);
    dustPoints.frustumCulled = false;
    scene.add(dustPoints);

    const dustParticles: Array<{
      active: boolean;
      life: number;
      decay: number;
      scale: number;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
    }> = [];
    for (let p = 0; p < DUST_COUNT; p++) {
      dustParticles.push({
        active: false,
        life: 0,
        decay: 0.65,
        scale: 1.0,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 1.2,
        vz: 0,
      });
    }
    let dustPoolIdx = 0;

    function spawnDustPuff(
      x: number,
      y: number,
      z: number,
      vx: number,
      vy: number,
      vz: number,
      scale = 1.0,
      decay = 0.65
    ) {
      const p = dustParticles[dustPoolIdx];
      p.active = true;
      p.life = 1.0;
      p.decay = decay;
      p.scale = scale;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = vx;
      p.vy = vy;
      p.vz = vz;
      dustPoolIdx = (dustPoolIdx + 1) % DUST_COUNT;
    }

    const _sheaveTipL = new THREE.Vector3(-0.95, 12.6, 12.2);
    const _sheaveTipR = new THREE.Vector3(0.95, 12.6, 12.2);
    const _gantryTopL = new THREE.Vector3(-1.8, 9.6, -1.9);
    const _gantryTopR = new THREE.Vector3(1.8, 9.6, -1.9);
    const _bucketAnchorL = new THREE.Vector3();
    const _bucketAnchorR = new THREE.Vector3();
    const _bucketWorldPos = new THREE.Vector3();

    function updateShovelAnimation(sRef: ShovelVisualRefs, timeSec: number, phase: number, halted: boolean) {
      const pose = computeShovelKinematics(timeSec, phase, halted);
      sRef.revolvingGroup.rotation.y = pose.swingAngle;
      sRef.stickGroup.rotation.x = -0.35 + pose.stickExtension * 0.42;
      sRef.stickGroup.position.z = 7.4 + pose.stickExtension * 1.1;
      sRef.bucketGroup.rotation.x = pose.bucketCurl;

      _bucketAnchorL.set(-0.9, 1.1, 0.2);
      _bucketAnchorR.set(0.9, 1.1, 0.2);
      sRef.bucketGroup.updateMatrix();
      sRef.stickGroup.updateMatrix();
      _bucketAnchorL.applyMatrix4(sRef.bucketGroup.matrix).applyMatrix4(sRef.stickGroup.matrix);
      _bucketAnchorR.applyMatrix4(sRef.bucketGroup.matrix).applyMatrix4(sRef.stickGroup.matrix);

      const cAttr = sRef.hoistCables.geometry.attributes.position as THREE.BufferAttribute;
      cAttr.setXYZ(0, _gantryTopL.x, _gantryTopL.y, _gantryTopL.z);
      cAttr.setXYZ(1, _sheaveTipL.x, _sheaveTipL.y, _sheaveTipL.z);
      cAttr.setXYZ(2, _gantryTopR.x, _gantryTopR.y, _gantryTopR.z);
      cAttr.setXYZ(3, _sheaveTipR.x, _sheaveTipR.y, _sheaveTipR.z);
      cAttr.setXYZ(4, _sheaveTipL.x, _sheaveTipL.y, _sheaveTipL.z);
      cAttr.setXYZ(5, _bucketAnchorL.x, _bucketAnchorL.y, _bucketAnchorL.z);
      cAttr.setXYZ(6, _sheaveTipR.x, _sheaveTipR.y, _sheaveTipR.z);
      cAttr.setXYZ(7, _bucketAnchorR.x, _bucketAnchorR.y, _bucketAnchorR.z);
      cAttr.needsUpdate = true;

      if (halted) {
        (sRef.beaconMesh.material as THREE.MeshBasicMaterial).color.setHex(
          Math.sin(timeSec * 10) > 0 ? 0xef4444 : 0x450a0a
        );
      } else {
        (sRef.beaconMesh.material as THREE.MeshBasicMaterial).color.setHex(0xf59e0b);
        // Emit digging dust at rock face (cycle < 0.32) and dump puff over haul truck (0.58 <= cycle < 0.72)
        const cycle = (((timeSec * 0.12 + phase) % 1) + 1) % 1;
        if (cycle < 0.32 && Math.random() < 0.38) {
          sRef.bucketGroup.getWorldPosition(_bucketWorldPos);
          spawnDustPuff(
            _bucketWorldPos.x + (Math.random() - 0.5) * 2.2,
            _bucketWorldPos.y - 0.5,
            _bucketWorldPos.z + (Math.random() - 0.5) * 2.2,
            (Math.random() - 0.5) * 1.4,
            1.2 + Math.random() * 0.8,
            (Math.random() - 0.5) * 1.4,
            1.15,
            0.6
          );
        } else if (cycle >= 0.58 && cycle < 0.72 && Math.random() < 0.52) {
          sRef.bucketGroup.getWorldPosition(_bucketWorldPos);
          spawnDustPuff(
            _bucketWorldPos.x + (Math.random() - 0.5) * 2.6,
            _bucketWorldPos.y - 0.8,
            _bucketWorldPos.z + (Math.random() - 0.5) * 2.6,
            (Math.random() - 0.5) * 2.2,
            1.6 + Math.random() * 1.1,
            (Math.random() - 0.5) * 2.2,
            1.45,
            0.55
          );
        }
      }
    }

    // --- 8B. ISOLATED CINEMATIC WHAT-IF SIMULATION ENGINE (`whatIfEffectsGroup`) ---
    const whatIfEffectsGroup = new THREE.Group();
    scene.add(whatIfEffectsGroup);

    // ============================================================================
    // SCENARIO A (`roadBlock`): 32 Ballistic Boulders, Dust Avalanche & 3Hz Barriers
    // ============================================================================
    const roadBlockFxGroup = new THREE.Group();
    roadBlockFxGroup.visible = false;
    whatIfEffectsGroup.add(roadBlockFxGroup);

    const slideCenter = ptsEX2[8].clone();
    const slideRadialDir = new THREE.Vector3(slideCenter.x, 0, slideCenter.z).normalize();
    const slideTangentDir = new THREE.Vector3().subVectors(ptsEX2[9], ptsEX2[7]).normalize();

    const boulderCascadeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: sulfideBenchTex.map,
      bumpMap: sulfideBenchTex.bumpMap,
      bumpScale: 1.35,
      roughness: 0.9,
      flatShading: true,
    });

    interface CascadingBoulder {
      mesh: THREE.Mesh;
      startPos: THREE.Vector3;
      endPos: THREE.Vector3;
      delay: number;
      duration: number;
      arcHeight: number;
      rotVel: THREE.Vector3;
      baseRadius: number;
    }

    const cascadingBoulders: CascadingBoulder[] = [];
    for (let b = 0; b < 32; b++) {
      const r = 0.75 + (b % 5) * 0.42;
      const bGeo = new THREE.DodecahedronGeometry(r, 1);
      const bMesh = new THREE.Mesh(bGeo, boulderCascadeMat);
      bMesh.castShadow = true;
      bMesh.receiveShadow = true;

      const alongSpread = ((b * 7) % 13 - 6) * 1.15;
      const radialStartOut = 9.5 + (b % 6) * 1.8;
      const startPos = slideCenter
        .clone()
        .addScaledVector(slideTangentDir, alongSpread * 0.85)
        .addScaledVector(slideRadialDir, radialStartOut);
      startPos.y = slideCenter.y + 13.5 + (b % 4) * 2.2;

      const radialEndSpread = ((b * 11) % 9 - 4) * 0.72;
      const pileLayerY = (b < 18 ? 0 : b < 27 ? 1.35 : 2.55) + r * 0.58 + 0.55;
      const endPos = slideCenter
        .clone()
        .addScaledVector(slideTangentDir, alongSpread * 0.65)
        .addScaledVector(slideRadialDir, radialEndSpread);
      endPos.y = slideCenter.y + pileLayerY;

      bMesh.position.copy(endPos);
      bMesh.scale.set(1.15, 0.82, 0.96);
      roadBlockFxGroup.add(bMesh);

      cascadingBoulders.push({
        mesh: bMesh,
        startPos,
        endPos,
        delay: (b % 10) * 0.085,
        duration: 1.15 + (b % 5) * 0.18,
        arcHeight: 3.8 + (b % 4) * 1.2,
        rotVel: new THREE.Vector3(
          (b % 2 === 0 ? 1 : -1) * (3.2 + (b % 3)),
          2.5 + (b % 4),
          (b % 2 === 1 ? 1 : -1) * (2.8 + (b % 3))
        ),
        baseRadius: r,
      });
    }

    // Avalanche Dust Emitter (96 billowing soft particles sliding down slope over 4s)
    const AVALANCHE_DUST_COUNT = 96;
    const avDustPos = new Float32Array(AVALANCHE_DUST_COUNT * 3);
    const avDustGeo = new THREE.BufferGeometry();
    avDustGeo.setAttribute('position', new THREE.BufferAttribute(avDustPos, 3));
    const avDustMat = new THREE.PointsMaterial({
      color: 0xa8947e,
      map: dustSpriteTex,
      size: 9.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const avalancheDustPoints = new THREE.Points(avDustGeo, avDustMat);
    avalancheDustPoints.frustumCulled = false;
    roadBlockFxGroup.add(avalancheDustPoints);

    const avDustState = Array.from({ length: AVALANCHE_DUST_COUNT }, (_, i) => ({
      offsetAlong: ((i * 5) % 15 - 7) * 0.95,
      offsetRadial: ((i * 9) % 11 - 5) * 0.6,
      speedFactor: 0.75 + (i % 7) * 0.12,
      phaseOffset: (i / AVALANCHE_DUST_COUNT) * 1.8,
    }));

    // Reflective Red-and-White Road Barriers (~25m before and after rockslide) with 3Hz Red Strobes
    const barrierStripeCanvas = document.createElement('canvas');
    barrierStripeCanvas.width = 256;
    barrierStripeCanvas.height = 64;
    const bCtx = barrierStripeCanvas.getContext('2d')!;
    bCtx.fillStyle = '#f8fafc';
    bCtx.fillRect(0, 0, 256, 64);
    bCtx.fillStyle = '#dc2626';
    for (let sx = -64; sx < 320; sx += 48) {
      bCtx.beginPath();
      bCtx.moveTo(sx, 0);
      bCtx.lineTo(sx + 24, 0);
      bCtx.lineTo(sx - 8, 64);
      bCtx.lineTo(sx - 32, 64);
      bCtx.closePath();
      bCtx.fill();
    }
    const barrierStripeTex = new THREE.CanvasTexture(barrierStripeCanvas);
    barrierStripeTex.colorSpace = THREE.SRGBColorSpace;
    const barrierRailMat = new THREE.MeshStandardMaterial({
      map: barrierStripeTex,
      roughness: 0.35,
      metalness: 0.2,
    });
    const barrierStrobeMat = new THREE.MeshBasicMaterial({ color: 0xff1e1e });

    function createEmergencyRoadBarrier(pos: THREE.Vector3, lookDir: THREE.Vector3): THREE.Group {
      const bg = new THREE.Group();
      bg.position.copy(pos);
      bg.position.y += 0.55;
      bg.lookAt(pos.clone().add(lookDir));

      const railTop = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.42, 0.18), barrierRailMat);
      railTop.position.y = 1.35;
      railTop.castShadow = true;
      bg.add(railTop);

      const railBot = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.32, 0.18), barrierRailMat);
      railBot.position.y = 0.72;
      bg.add(railBot);

      const legGeo = new THREE.BoxGeometry(0.18, 1.5, 0.9);
      const legL = new THREE.Mesh(legGeo, sharedChassisMat);
      legL.position.set(-2.2, 0.75, 0);
      bg.add(legL);
      const legR = new THREE.Mesh(legGeo, sharedChassisMat);
      legR.position.set(2.2, 0.75, 0);
      bg.add(legR);

      const strobeGeo = new THREE.SphereGeometry(0.24, 12, 12);
      const strobeL = new THREE.Mesh(strobeGeo, barrierStrobeMat);
      strobeL.position.set(-1.8, 1.72, 0);
      bg.add(strobeL);
      const strobeR = new THREE.Mesh(strobeGeo, barrierStrobeMat);
      strobeR.position.set(1.8, 1.72, 0);
      bg.add(strobeR);

      return bg;
    }

    const barrierBeforeDir = new THREE.Vector3().subVectors(ptsEX2[7], ptsEX2[5]).normalize();
    const barrierAfterDir = new THREE.Vector3().subVectors(ptsEX2[11], ptsEX2[9]).normalize();
    roadBlockFxGroup.add(createEmergencyRoadBarrier(ptsEX2[6], barrierBeforeDir));
    roadBlockFxGroup.add(createEmergencyRoadBarrier(ptsEX2[10], barrierAfterDir));

    const roadBlockStrobeLight = new THREE.PointLight(0xef4444, 18, 38);
    roadBlockStrobeLight.position.set(slideCenter.x, slideCenter.y + 4.5, slideCenter.z);
    roadBlockFxGroup.add(roadBlockStrobeLight);

    let roadBlockAnimElapsed = 0;

    // ============================================================================
    // SCENARIO B (`ex1Fail`): 4Hz Roof Strobe, Smoke Column, Sparks & 15m Hologram
    // ============================================================================
    const ex1FailFxGroup = new THREE.Group();
    ex1FailFxGroup.visible = false;
    whatIfEffectsGroup.add(ex1FailFxGroup);

    let ex1FrozenTimeSec: number | null = null;

    // 1. 4Hz Emergency Roof Strobe PointLight + Additive Halo Sprite
    const ex1StrobeLight = new THREE.PointLight(0xff3b00, 24, 48);
    ex1StrobeLight.position.set(
      ex1BermPos.x,
      ex1BermPos.y + 9.2,
      ex1BermPos.z
    );
    ex1FailFxGroup.add(ex1StrobeLight);

    const ex1StrobeHaloMat = new THREE.SpriteMaterial({
      map: dustSpriteTex,
      color: 0xff4500,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ex1StrobeHalo = new THREE.Sprite(ex1StrobeHaloMat);
    ex1StrobeHalo.position.copy(ex1StrobeLight.position);
    ex1StrobeHalo.scale.set(7.5, 7.5, 1);
    ex1FailFxGroup.add(ex1StrobeHalo);

    // 2. Rising Black Smoke Column (90 particles, vy = 3.5 m/s + steppe wind drift)
    const EX1_SMOKE_COUNT = 90;
    const ex1SmokePos = new Float32Array(EX1_SMOKE_COUNT * 3);
    const ex1SmokeGeo = new THREE.BufferGeometry();
    ex1SmokeGeo.setAttribute('position', new THREE.BufferAttribute(ex1SmokePos, 3));
    const ex1SmokeMat = new THREE.PointsMaterial({
      color: 0x181c24,
      map: dustSpriteTex,
      size: 8.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const ex1SmokePoints = new THREE.Points(ex1SmokeGeo, ex1SmokeMat);
    ex1SmokePoints.frustumCulled = false;
    ex1FailFxGroup.add(ex1SmokePoints);

    const ex1SmokeState = Array.from({ length: EX1_SMOKE_COUNT }, (_, i) => ({
      age: (i / EX1_SMOKE_COUNT) * 5.0,
      lifeSpan: 4.5 + (i % 5) * 0.4,
      jitterX: ((i * 7) % 11 - 5) * 0.25,
      jitterZ: ((i * 13) % 11 - 5) * 0.25,
    }));

    // 3. Orange Electrical Sparks Emitter (40 particles with ballistic gravity)
    const EX1_SPARK_COUNT = 40;
    const ex1SparkPos = new Float32Array(EX1_SPARK_COUNT * 3);
    const ex1SparkGeo = new THREE.BufferGeometry();
    ex1SparkGeo.setAttribute('position', new THREE.BufferAttribute(ex1SparkPos, 3));
    const ex1SparkMat = new THREE.PointsMaterial({
      color: 0xffa822,
      size: 1.9,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ex1SparkPoints = new THREE.Points(ex1SparkGeo, ex1SparkMat);
    ex1SparkPoints.frustumCulled = false;
    ex1FailFxGroup.add(ex1SparkPoints);

    const ex1SparkState = Array.from({ length: EX1_SPARK_COUNT }, (_, i) => {
      const ang = (i / EX1_SPARK_COUNT) * Math.PI * 2 + (i % 3) * 0.4;
      const spd = 2.5 + (i % 6) * 0.95;
      return {
        age: (i / EX1_SPARK_COUNT) * 1.1,
        period: 0.85 + (i % 4) * 0.18,
        vx: Math.cos(ang) * spd,
        vy0: 4.8 + (i % 5) * 1.1,
        vz: Math.sin(ang) * spd,
      };
    });

    // 4. 15m Holographic Danger Perimeter Ring on Horizontal Berm around EX-01
    const holoRingMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const holoPerimeterRing = new THREE.Mesh(new THREE.RingGeometry(14, 15, 64), holoRingMat);
    holoPerimeterRing.rotation.x = -Math.PI / 2;
    holoPerimeterRing.position.set(ex1BermPos.x, ex1BermPos.y + 0.35, ex1BermPos.z);
    ex1FailFxGroup.add(holoPerimeterRing);
    ssaoExcludedObjects.push(holoPerimeterRing);

    const holoInnerRingMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const holoInnerRing = new THREE.Mesh(new THREE.RingGeometry(11.5, 13.8, 64), holoInnerRingMat);
    holoInnerRing.rotation.x = -Math.PI / 2;
    holoInnerRing.position.set(ex1BermPos.x, ex1BermPos.y + 0.32, ex1BermPos.z);
    ex1FailFxGroup.add(holoInnerRing);
    ssaoExcludedObjects.push(holoInnerRing);

    // ============================================================================
    // SCENARIO C (`dilution`): Separated AR HUD Sign above Roof & Hopper Scan Cone
    // ============================================================================
    const dilutionFxGroup = new THREE.Group();
    // Anchor dilutionFxGroup Y to the +35m horizon (crusherGroup.position.y) so local heights
    // (y = 31.5m above roof ridge, y = 15.5m..8.5m inside hopper bowl) match crusherGroup 1:1
    dilutionFxGroup.position.set(0, crusherGroup.position.y, 0);
    dilutionFxGroup.visible = false;
    whatIfEffectsGroup.add(dilutionFxGroup);

    // 1. 3D AR HUD Badge strictly ABOVE the Crusher House roof ridge (y = 31.5m)
    const holoSignCenter = new THREE.Vector3();
    holoSignCenter.set(crusherGroup.position.x, 31.5, crusherGroup.position.z);

    // Compact, Premium Cyber-Badge (Zero Overlapping Text)
    const holoCanvas = document.createElement('canvas');
    holoCanvas.width = 1024;
    holoCanvas.height = 256;
    const hCtx = holoCanvas.getContext('2d')!;
    hCtx.clearRect(0, 0, 1024, 256);

    // High-contrast cyber-industrial panel background
    hCtx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    hCtx.strokeStyle = '#fbbf24';
    hCtx.lineWidth = 5;
    hCtx.fillRect(16, 16, 992, 224);
    hCtx.strokeRect(16, 16, 992, 224);

    // Subtle top & bottom accent bars
    hCtx.fillStyle = '#a855f7';
    hCtx.fillRect(20, 20, 984, 10);
    hCtx.fillStyle = '#38bdf8';
    hCtx.fillRect(20, 226, 984, 10);

    // Bright Amber Warning Triangle Icon on left
    hCtx.strokeStyle = '#fbbf24';
    hCtx.fillStyle = 'rgba(251, 191, 36, 0.2)';
    hCtx.lineWidth = 6;
    hCtx.beginPath();
    hCtx.moveTo(106, 62);
    hCtx.lineTo(162, 168);
    hCtx.lineTo(50, 168);
    hCtx.closePath();
    hCtx.fill();
    hCtx.stroke();

    hCtx.fillStyle = '#fbbf24';
    hCtx.font = 'bold 52px monospace';
    hCtx.textAlign = 'center';
    hCtx.fillText('!', 106, 154);

    // Top Status Line (bold 32px, #fbbf24)
    hCtx.textAlign = 'left';
    hCtx.fillStyle = '#fbbf24';
    hCtx.font = 'bold 32px monospace';
    hCtx.fillText('[ ! ] ВНИМАНИЕ: СНИЖЕНИЕ СОРТА (0.31% Cu)', 192, 108);

    // Bottom Status Line (bold 22px, #38bdf8)
    hCtx.fillStyle = '#38bdf8';
    hCtx.font = 'bold 22px monospace';
    hCtx.fillText('КОНТРОЛЬ ШИХТЫ ККД-1 · ЗАБОЙ EX-02', 192, 166);

    const holoSignTex = new THREE.CanvasTexture(holoCanvas);
    holoSignTex.colorSpace = THREE.SRGBColorSpace;
    holoSignTex.anisotropy = maxAniso;
    const holoSignMat = new THREE.SpriteMaterial({
      map: holoSignTex,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
    });
    const holoSignSprite = new THREE.Sprite(holoSignMat);
    holoSignSprite.position.copy(holoSignCenter);
    holoSignSprite.scale.set(20, 5.0, 1);
    dilutionFxGroup.add(holoSignSprite);
    ssaoExcludedObjects.push(holoSignSprite);

    // 2. Scanning Light Cone under the Dump Pocket Canopy (y = 15.5m down to y = 8.5m inside Crusher Bowl)
    // Cone height = 7.0m (15.5 - 8.5), center at y = 12.0m, rotated Math.PI so tip points DOWN to y = 8.5m
    const hopperPocketX = crusherGroup.position.x;
    const hopperPocketZ = crusherGroup.position.z + 4.6;
    const scanConeMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const scanConeMesh = new THREE.Mesh(
      new THREE.ConeGeometry(4.4, 7.0, 24, 1, true),
      scanConeMat
    );
    scanConeMesh.rotation.x = Math.PI; // Tip points downward into crusher bowl at y = 8.5m
    scanConeMesh.position.set(hopperPocketX, 12.0, hopperPocketZ);
    dilutionFxGroup.add(scanConeMesh);
    ssaoExcludedObjects.push(scanConeMesh);

    // Animated horizontal laser scan ring descending from y = 15.5m down to y = 8.5m inside hopper
    const scanPulseRingMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const scanPulseRing = new THREE.Mesh(
      new THREE.RingGeometry(3.6, 4.2, 32),
      scanPulseRingMat
    );
    scanPulseRing.rotation.x = -Math.PI / 2;
    scanPulseRing.position.set(hopperPocketX, 15.0, hopperPocketZ);
    dilutionFxGroup.add(scanPulseRing);
    ssaoExcludedObjects.push(scanPulseRing);

    // --- 9. PRE-ALLOCATED SCRATCH VECTORS & SCREEN-SPACE PROJECTION ENGINE ---
    const _pos = new THREE.Vector3();
    const _tangent = new THREE.Vector3();
    const _lookTarget = new THREE.Vector3();
    const _chaseCamPos = new THREE.Vector3();
    const _chaseOffset = new THREE.Vector3(-20, 12, 22);

    const _anchorWorldPos = new THREE.Vector3();
    const _camForward = new THREE.Vector3();
    const _toAnchor = new THREE.Vector3();
    const _projPos = new THREE.Vector3();

    function getAssetWorldAnchor(assetId: MiningAssetId, targetOut: THREE.Vector3): boolean {
      if (assetId.startsWith('truck-')) {
        const tv = truckVisuals[assetId];
        if (!tv) return false;
        targetOut.copy(tv.root.position);
        targetOut.y += 4.8; // Above dump bed canopy
        return true;
      }
      if (assetId === 'ex-01') {
        targetOut.copy(ex1Refs.root.position);
        targetOut.y += 14.0; // Above A-frame gantry
        return true;
      }
      if (assetId === 'ex-02') {
        targetOut.copy(ex2Refs.root.position);
        targetOut.y += 14.0;
        return true;
      }
      if (assetId === 'ex-03') {
        targetOut.copy(ex3Refs.root.position);
        targetOut.y += 14.0;
        return true;
      }
      if (assetId === 'drill-01') {
        targetOut.copy(drill1.position);
        targetOut.y += 9.5; // Top of 8.8m mast
        return true;
      }
      if (assetId === 'drill-02') {
        targetOut.copy(drill2.position);
        targetOut.y += 9.5;
        return true;
      }
      if (assetId === 'crusher') {
        targetOut.copy(crusherGroup.position);
        targetOut.y += 13.0;
        return true;
      }
      if (assetId === 'radar') {
        targetOut.copy(radarGroup.position);
        targetOut.y += 7.0;
        return true;
      }
      if (assetId === 'waste-dump') {
        targetOut.set(-136, 46, -132);
        return true;
      }
      return false;
    }

    let lastTime = performance.now();
    let elapsedSimSec = 0;
    let lastHudSyncSec = 0;
    let frameId = 0;
    let appliedShakeX = 0;
    let appliedShakeY = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function tick() {
      const now = performance.now();
      const rawDt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Restore previous frame's additive camera shake before OrbitControls / camera lerp runs
      if (appliedShakeX !== 0 || appliedShakeY !== 0) {
        camera.position.x -= appliedShakeX;
        camera.position.y -= appliedShakeY;
        appliedShakeX = 0;
        appliedShakeY = 0;
      }

      const dt = rawDt * simStateRef.current.simSpeed;
      elapsedSimSec += dt;

      // Update Night Star Dome twinkling uniform & 1Hz Red Aviation Warning Strobe Beacons
      starUniforms.uTime.value = elapsedSimSec;
      const avPulse = 0.5 + 0.5 * Math.sin(elapsedSimSec * Math.PI * 2.0);
      aviationBeaconMat.color.setHex(avPulse > 0.35 ? 0xff1133 : 0x450a0a);
      sharedTruckBeaconMat.emissiveIntensity = 1.2 + 2.0 * (0.5 + 0.5 * Math.sin(elapsedSimSec * Math.PI * 4.0));

      const activeScen = simStateRef.current.scenarios;

      // 1. SSR Slope Radar sweeping scan OR Crimson Lock-On to Rockslide (ptsEX2[8])
      if (activeScen.roadBlock) {
        const lockAngle = Math.atan2(
          slideCenter.x - radarGroup.position.x,
          slideCenter.z - radarGroup.position.z
        );
        radarTurret.rotation.y = lockAngle;
        const beamMatRef = radarBeam.material as THREE.MeshBasicMaterial;
        beamMatRef.color.setHex(0xef4444);
        beamMatRef.opacity = 0.35 + 0.15 * Math.sin(elapsedSimSec * 8.0);
      } else {
        radarTurret.rotation.y = Math.sin(elapsedSimSec * 0.85) * 0.42;
      }

      // 2. Shovel Digging Kinematics & Excavation Dust Clouds (EX-01 freezes in place on ex1Fail)
      if (activeScen.ex1Fail) {
        if (ex1FrozenTimeSec === null) {
          ex1FrozenTimeSec = elapsedSimSec;
        }
        (ex1Refs.beaconMesh.material as THREE.MeshBasicMaterial).color.setHex(
          Math.sin(elapsedSimSec * Math.PI * 8.0) > 0 ? 0xff2a00 : 0x450a0a
        );
      } else {
        ex1FrozenTimeSec = null;
        updateShovelAnimation(ex1Refs, elapsedSimSec, 0.0, false);
      }
      updateShovelAnimation(ex2Refs, elapsedSimSec, 0.37, false);
      updateShovelAnimation(ex3Refs, elapsedSimSec, 0.68, false);

      // 2B. Update Active What-If 3D Scenario Effects inside `whatIfEffectsGroup`
      if (activeScen.roadBlock && roadBlockFxGroup.visible) {
        roadBlockAnimElapsed += rawDt;

        // Ballistic cascade of 32 boulders down onto ptsEX2[8]
        for (let b = 0; b < cascadingBoulders.length; b++) {
          const cb = cascadingBoulders[b];
          const localT = Math.max(0, roadBlockAnimElapsed - cb.delay);
          const u = Math.min(1.0, localT / cb.duration);
          if (u < 1.0) {
            const ease = u * u * (3 - 2 * u);
            cb.mesh.position.lerpVectors(cb.startPos, cb.endPos, ease);
            const parabola = 4.0 * cb.arcHeight * u * (1.0 - u);
            const bounce = u > 0.82 ? Math.abs(Math.sin((u - 0.82) * 18.0)) * 0.85 * (1.0 - u) * 5.0 : 0;
            cb.mesh.position.y += parabola + bounce;
            cb.mesh.rotation.x = localT * cb.rotVel.x;
            cb.mesh.rotation.y = localT * cb.rotVel.y;
            cb.mesh.rotation.z = localT * cb.rotVel.z;
          } else {
            cb.mesh.position.copy(cb.endPos);
          }
        }

        // Avalanche dust cloud sliding & billowing over 4 seconds
        const avAttr = avDustGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < AVALANCHE_DUST_COUNT; i++) {
          const st = avDustState[i];
          const cycleT = ((roadBlockAnimElapsed * st.speedFactor + st.phaseOffset) % 4.0) / 4.0;
          const curX =
            slideCenter.x +
            slideTangentDir.x * st.offsetAlong +
            slideRadialDir.x * (12.0 * (1.0 - cycleT) + st.offsetRadial);
          const curZ =
            slideCenter.z +
            slideTangentDir.z * st.offsetAlong +
            slideRadialDir.z * (12.0 * (1.0 - cycleT) + st.offsetRadial);
          const curY =
            slideCenter.y + 13.0 * (1.0 - cycleT) + Math.sin(cycleT * Math.PI) * 4.5 + 1.2;
          avAttr.setXYZ(i, curX, curY, curZ);
        }
        avAttr.needsUpdate = true;
        avDustMat.opacity = roadBlockAnimElapsed < 4.0 ? 0.62 : 0.36 + 0.1 * Math.sin(elapsedSimSec * 2.5);

        // 3 Hz red strobe beacons on emergency road barriers
        const strobeOn = Math.sin(elapsedSimSec * Math.PI * 6.0) > 0;
        barrierStrobeMat.color.setHex(strobeOn ? 0xff1e1e : 0x3b0707);
        roadBlockStrobeLight.intensity = strobeOn ? 22 : 2;
      }

      if (activeScen.ex1Fail && ex1FailFxGroup.visible) {
        // 4 Hz emergency strobe light + halo sprite on EX-01 cab roof
        const pulse4Hz = 0.5 + 0.5 * Math.sin(elapsedSimSec * Math.PI * 8.0);
        ex1StrobeLight.intensity = 6 + pulse4Hz * 28;
        ex1StrobeHaloMat.opacity = 0.25 + pulse4Hz * 0.75;
        const haloScale = 5.5 + pulse4Hz * 4.0;
        ex1StrobeHalo.scale.set(haloScale, haloScale, 1);

        // Rising black smoke column (vy = 3.5 m/s + steppe wind drift)
        const smAttr = ex1SmokeGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < EX1_SMOKE_COUNT; i++) {
          const st = ex1SmokeState[i];
          st.age = (st.age + rawDt) % st.lifeSpan;
          const h = st.age * 3.5;
          const windX = st.age * 1.55 + Math.sin(elapsedSimSec * 2.0 + i) * 0.45;
          const windZ = st.age * 0.75 + Math.cos(elapsedSimSec * 1.7 + i) * 0.45;
          smAttr.setXYZ(
            i,
            ex1BermPos.x + st.jitterX + windX,
            ex1BermPos.y + 6.8 + h,
            ex1BermPos.z + st.jitterZ + windZ
          );
        }
        smAttr.needsUpdate = true;

        // Orange electrical sparks bursting from EX-01 engine room
        const spAttr = ex1SparkGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < EX1_SPARK_COUNT; i++) {
          const sp = ex1SparkState[i];
          sp.age = (sp.age + rawDt) % sp.period;
          const t = sp.age;
          const sx = ex1BermPos.x + sp.vx * t;
          const sy = Math.max(ex1BermPos.y + 0.5, ex1BermPos.y + 6.2 + sp.vy0 * t - 0.5 * 14.0 * t * t);
          const sz = ex1BermPos.z + sp.vz * t;
          spAttr.setXYZ(i, sx, sy, sz);
        }
        spAttr.needsUpdate = true;

        // Pulsing 15m red holographic danger perimeter ring
        holoRingMat.opacity = 0.55 + 0.38 * Math.sin(elapsedSimSec * 6.0);
        holoInnerRingMat.opacity = 0.14 + 0.12 * Math.sin(elapsedSimSec * 6.0);
        holoPerimeterRing.rotation.z = elapsedSimSec * 0.4;
      }

      // Smoothly transition EX-02 bench mineralization (tiers 2 & 3) and animate Crusher hologram in `dilution`
      const targetDilutionFactor = activeScen.dilution ? 0.04 : 1.0;
      [2, 3].forEach((tierIdx) => {
        const bRef = benchStrataUniforms[tierIdx];
        if (bRef) {
          const desiredVal = bRef.baseStrength * targetDilutionFactor;
          bRef.uniforms.uMineralStrength.value +=
            (desiredVal - bRef.uniforms.uMineralStrength.value) * Math.min(1, rawDt * 3.5);
          const targetTint = activeScen.dilution ? 0x857f78 : 0xffffff;
          bRef.faceMat.color.lerp(new THREE.Color(targetTint), Math.min(1, rawDt * 3.0));
        }
      });

      if (activeScen.dilution && dilutionFxGroup.visible) {
        // HUD Occlusion Guard: dim 3D AR billboard when 2D Crusher Telemetry Card is open
        holoSignSprite.material.opacity =
          simStateRef.current.selectedAsset === 'crusher' ? 0.15 : 0.96;
        holoSignSprite.position.y = holoSignCenter.y + Math.sin(elapsedSimSec * 3.2) * 0.45;
        scanConeMat.opacity = 0.22 + 0.1 * Math.sin(elapsedSimSec * 5.0);

        // Scan ring descends from y = 15.5m (under canopy) to y = 8.5m (crusher bowl)
        const scanProgress = (elapsedSimSec * 0.85) % 1.0;
        scanPulseRing.position.y = 15.5 - scanProgress * 7.0;
        const ringScale = Math.max(0.18, 1.0 - scanProgress * 0.82);
        scanPulseRing.scale.set(ringScale, ringScale, 1);
      }

      // 3. Crusher Conveyor Ore Movement, Crusher Plume & Drill Rig Compressed-Air Dust Fountain
      convOreLumps.forEach((lump, idx) => {
        const u = (((elapsedSimSec * 0.18 + idx / convOreLumps.length) % 1) + 1) % 1;
        lump.position.set(0.2, -0.15, (u - 0.5) * convLen);
        lump.rotation.x = elapsedSimSec * 1.5 + idx;
      });
      if (Math.random() < 0.28) {
        spawnDustPuff(
          crusherGroup.position.x + (Math.random() - 0.5) * 4,
          46.5,
          crusherGroup.position.z + 4.6 + (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 0.9,
          1.7,
          (Math.random() - 0.5) * 0.9,
          1.2,
          0.55
        );
      }
      // Continuous vertical compressed-air bailing dust jet at CAT MD6250 drill collars
      if (Math.random() < 0.65) {
        [drill1, drill2].forEach((dRig) => {
          const forwardX = Math.sin(dRig.rotation.y) * 2.8;
          const forwardZ = Math.cos(dRig.rotation.y) * 2.8;
          spawnDustPuff(
            dRig.position.x + forwardX + (Math.random() - 0.5) * 0.45,
            dRig.position.y + 0.5,
            dRig.position.z + forwardZ + (Math.random() - 0.5) * 0.45,
            (Math.random() - 0.5) * 0.55,
            2.6 + Math.random() * 1.1,
            (Math.random() - 0.5) * 0.55,
            0.58,
            0.95
          );
        });
      }

      // 4. Advance CAT 793F Haul Fleet via 4-Phase Round-Trip FSM, Dump Bed Hydraulics & Right-Hand Two-Lane Motion
      const tkEntries = Object.entries(truckKinematics);
      tkEntries.forEach(([id, tk]) => {
        const vRef = truckVisuals[id];
        if (!vRef || !tk.curve) return;

        if (tk.phase === 'LOADING') {
          tk.progress = 0.0;
          tk.speed = 0.0;
          tk.bedAngle = 0.0;
          vRef.oreHeap.visible = true;
          tk.phaseTimer += dt;
          const fill = Math.min(1.0, tk.phaseTimer / 2.6);
          vRef.oreHeap.scale.set(1.0, 0.1 + 0.9 * fill, 1.0);

          if (tk.phaseTimer >= 3.2) {
            tk.phase = 'HAULING_UP';
            tk.phaseTimer = 0.0;
            tk.speed = 14.5;
            vRef.oreHeap.scale.set(1.0, 1.0, 1.0);
          }
        } else if (tk.phase === 'HAULING_UP') {
          tk.bedAngle = 0.0;
          vRef.oreHeap.visible = true;
          vRef.oreHeap.scale.set(1.0, 1.0, 1.0);

          let targetSpeed = 14.5;
          const minSafeGap = 0.072; // ~28m normalized headway along route
          for (const [otherId, tkOther] of tkEntries) {
            if (otherId === id) continue;
            const otherIsClimbingOrDumping =
              tkOther.phase === 'HAULING_UP' || tkOther.phase === 'DUMPING';
            if (!otherIsClimbingOrDumping) continue;

            if (tkOther.curve === tk.curve) {
              const deltaAhead = tkOther.progress - tk.progress;
              if (deltaAhead > 0.0001 && deltaAhead < minSafeGap) {
                const factor = Math.max(0.0, (deltaAhead - 0.018) / (minSafeGap - 0.018));
                targetSpeed = Math.min(targetSpeed, Math.max(tkOther.speed, 14.5 * factor));
                if (deltaAhead < 0.022 && tkOther.speed < 0.5) {
                  targetSpeed = 0.0;
                }
              }
            } else if (
              (tk.curve === routeEX1 && tkOther.curve === routeEX2) ||
              (tk.curve === routeEX2 && tkOther.curve === routeEX1)
            ) {
              // Check world-space headway < 28m where routeEX1 and routeEX2 share the upper ramp
              const otherRef = truckVisuals[otherId];
              if (otherRef && tkOther.progress > tk.progress) {
                const dist = vRef.root.position.distanceTo(otherRef.root.position);
                if (dist > 0.1 && dist < 28.0) {
                  const factor = Math.max(0.0, (dist - 12.0) / 16.0);
                  targetSpeed = Math.min(targetSpeed, Math.max(tkOther.speed, 14.5 * factor));
                }
              }
            }
          }

          tk.speed = targetSpeed;
          const speedKms = tk.speed / 3600;
          const deltaProg = (speedKms * dt * 5.0) / tk.totalKm;
          tk.progress = Math.min(1.0, tk.progress + deltaProg);

          if (tk.progress >= 0.995) {
            tk.phase = 'DUMPING';
            tk.progress = 1.0;
            tk.phaseTimer = 0.0;
            tk.speed = 0.0;
            tk.dumpedBurstDone = false;
          }
        } else if (tk.phase === 'DUMPING') {
          tk.progress = 1.0;
          tk.speed = 0.0;
          tk.phaseTimer += dt;
          const t = tk.phaseTimer;

          if (t < 1.6) {
            tk.bedAngle = (t / 1.6) * 0.66;
            vRef.oreHeap.visible = true;
            vRef.oreHeap.scale.set(1.0, 1.0, 1.0);
          } else {
            if (!tk.dumpedBurstDone) {
              tk.dumpedBurstDone = true;
              vRef.oreHeap.visible = false;
              // Dense billowing dust cloud from dump hopper / waste dump edge at apex of dump
              for (let b = 0; b < 14; b++) {
                spawnDustPuff(
                  vRef.root.position.x + (Math.random() - 0.5) * 4.2,
                  vRef.root.position.y + 1.8 + Math.random() * 1.4,
                  vRef.root.position.z + (Math.random() - 0.5) * 4.2,
                  (Math.random() - 0.5) * 2.6,
                  1.9 + Math.random() * 1.6,
                  (Math.random() - 0.5) * 2.6,
                  1.55,
                  0.45
                );
              }
            }
            if (t < 3.0) {
              tk.bedAngle = Math.max(0.0, (1.0 - (t - 1.6) / 1.4) * 0.66);
            } else {
              tk.bedAngle = 0.0;
            }
          }

          if (tk.phaseTimer >= 3.8) {
            tk.phase = 'RETURNING_EMPTY';
            tk.phaseTimer = 0.0;
            tk.bedAngle = 0.0;
            tk.speed = 28.0;
            vRef.oreHeap.visible = false;
          }
        } else {
          // RETURNING_EMPTY: fast empty descent (progress 1.0 -> 0.0) on opposite right-hand lane
          tk.bedAngle = 0.0;
          vRef.oreHeap.visible = false;

          let targetSpeed = 28.0;
          const minSafeGap = 0.072; // ~28m normalized headway
          for (const [otherId, tkOther] of tkEntries) {
            if (otherId === id || tkOther.curve !== tk.curve) continue;
            if (tkOther.phase === 'RETURNING_EMPTY') {
              const deltaAhead = tk.progress - tkOther.progress;
              if (deltaAhead > 0.0001 && deltaAhead < minSafeGap) {
                const factor = Math.max(0.25, deltaAhead / minSafeGap);
                targetSpeed = Math.min(targetSpeed, tkOther.speed * factor);
              }
            }
          }

          tk.speed = targetSpeed;
          const speedKms = tk.speed / 3600;
          const deltaProg = (speedKms * dt * 5.0) / tk.totalKm;
          tk.progress = Math.max(0.0, tk.progress - deltaProg);

          if (tk.progress <= 0.005) {
            tk.phase = 'LOADING';
            tk.progress = 0.0;
            tk.phaseTimer = 0.0;
            tk.speed = 0.0;
            vRef.oreHeap.visible = true;
            vRef.oreHeap.scale.set(1.0, 0.1, 1.0);
          }
        }

        // Automatic Right-Hand Two-Lane Positioning & Dump Bed Hydraulic Rotation
        tk.curve.getPointAt(tk.progress, _pos);
        tk.curve.getTangentAt(tk.progress, _tangent).normalize();

        const isReturning = tk.phase === 'RETURNING_EMPTY';
        const horiz = Math.hypot(_tangent.x, _tangent.z) || 1;
        const rightX = (isReturning ? _tangent.z : -_tangent.z) / horiz;
        const rightZ = (isReturning ? -_tangent.x : _tangent.x) / horiz;

        if (isReturning) {
          _tangent.negate();
        }

        vRef.root.position.set(
          _pos.x + rightX * 2.85,
          _pos.y + 0.55,
          _pos.z + rightZ * 2.85
        );
        _lookTarget.copy(vRef.root.position).add(_tangent);
        vRef.root.lookAt(_lookTarget);
        vRef.dumpBody.rotation.x = -tk.bedAngle;

        // Dynamic Rear Brake Light Flare (#ff1133): 3x+ brighter when stopped in LOADING / DUMPING or braking (< 1.0 km/h)
        const isBraking =
          tk.phase === 'LOADING' || tk.phase === 'DUMPING' || tk.speed < 1.0;
        vRef.brakeLightMat.emissiveIntensity = isBraking ? 4.2 : 1.1;

        const wheelSpin = (tk.speed * dt) / 1.48;
        tk.wheelAngle += wheelSpin;
        vRef.wheels.forEach((w) => {
          w.rotation.x = tk.wheelAngle;
        });

        // Speed-dependent tire plume from outer edges of rear dual 40.00R57 tires (only when moving)
        if (tk.speed > 1.0) {
          const isFastEmpty = tk.speed > 20;
          const spawnProb = isFastEmpty ? 0.88 : 0.58;
          if (Math.random() < spawnProb) {
            const tireRightX = -_tangent.z;
            const tireRightZ = _tangent.x;
            for (const sideSign of [-1, 1]) {
              if (!isFastEmpty && Math.random() < 0.35) continue;
              const emitX =
                vRef.root.position.x - _tangent.x * 2.3 + tireRightX * sideSign * 2.25;
              const emitZ =
                vRef.root.position.z - _tangent.z * 2.3 + tireRightZ * sideSign * 2.25;
              const trailSpeed = isFastEmpty ? 2.4 : 1.05;
              spawnDustPuff(
                emitX + (Math.random() - 0.5) * 0.4,
                vRef.root.position.y + 0.35,
                emitZ + (Math.random() - 0.5) * 0.4,
                -_tangent.x * trailSpeed + tireRightX * sideSign * 0.45 + (Math.random() - 0.5) * 0.7,
                (isFastEmpty ? 1.55 : 0.95) + Math.random() * 0.55,
                -_tangent.z * trailSpeed + tireRightZ * sideSign * 0.45 + (Math.random() - 0.5) * 0.7,
                isFastEmpty ? 1.28 : 0.88,
                isFastEmpty ? 0.52 : 0.68
              );
            }
          }
        }
      });

      // 5. Update 1000 Expanding Dust Particles (position + aLife + aScale attributes)
      const posAttr = dustGeo.attributes.position as THREE.BufferAttribute;
      const lifeAttr = dustGeo.attributes.aLife as THREE.BufferAttribute;
      const scaleAttr = dustGeo.attributes.aScale as THREE.BufferAttribute;
      for (let idx = 0; idx < DUST_COUNT; idx++) {
        const p = dustParticles[idx];
        if (p.active) {
          p.life -= rawDt * p.decay;
          p.x += p.vx * rawDt;
          p.y += p.vy * rawDt;
          p.z += p.vz * rawDt;
          if (p.life <= 0) {
            p.active = false;
            p.life = 0;
          }
        }
        posAttr.setXYZ(idx, p.x, p.active ? p.y : -999, p.z);
        lifeAttr.setX(idx, p.active ? p.life : 0);
        scaleAttr.setX(idx, p.scale);
      }
      posAttr.needsUpdate = true;
      lifeAttr.needsUpdate = true;
      scaleAttr.needsUpdate = true;

      // 6. Cinematic Camera Director & Decaying Seismic Screen Shake (OrbitControls-safe)
      const dampFactor = 1 - Math.exp(-8.5 * rawDt);
      const currentSelected = simStateRef.current.selectedAsset;

      if (currentSelected && currentSelected.startsWith('truck-') && truckVisuals[currentSelected]) {
        const tMesh = truckVisuals[currentSelected].root;
        controls.target.lerp(tMesh.position, dampFactor);

        if (simStateRef.current.truckInitialFlyIn) {
          _chaseCamPos.copy(tMesh.position).add(_chaseOffset);
          camera.position.lerp(_chaseCamPos, dampFactor);
          if (camera.position.distanceToSquared(_chaseCamPos) < 4.0) {
            simStateRef.current.truckInitialFlyIn = false;
          }
        }
      } else if (simStateRef.current.cameraTransitioning) {
        camera.position.lerp(simStateRef.current.desiredCamPos, dampFactor);
        controls.target.lerp(simStateRef.current.desiredTarget, dampFactor);
        if (
          camera.position.distanceToSquared(simStateRef.current.desiredCamPos) < 0.35 &&
          controls.target.distanceToSquared(simStateRef.current.desiredTarget) < 0.35
        ) {
          simStateRef.current.cameraTransitioning = false;
        }
      }

      controls.update();

      // Apply additive decaying seismic camera shake without corrupting OrbitControls spherical state
      if (simStateRef.current.shakeIntensity > 0.001) {
        const shakeElapsed = simStateRef.current.shakeElapsed;
        const decay = Math.exp(-3.2 * shakeElapsed);
        if (decay < 0.01) {
          simStateRef.current.shakeIntensity = 0;
          simStateRef.current.shakeElapsed = 0;
        } else {
          const sX =
            (Math.sin(shakeElapsed * 48.0) + Math.cos(shakeElapsed * 67.0) * 0.5) *
            simStateRef.current.shakeIntensity *
            decay;
          const sY =
            (Math.cos(shakeElapsed * 52.0) + Math.sin(shakeElapsed * 73.0) * 0.5) *
            simStateRef.current.shakeIntensity *
            decay *
            0.7;
          camera.position.x += sX;
          camera.position.y += sY;
          appliedShakeX = sX;
          appliedShakeY = sY;
          simStateRef.current.shakeElapsed += rawDt;
        }
      }

      // Frame-paced 2.8s countdown for Sci-Fi Emergency Alert Banner
      if (simStateRef.current.alertRemainSec > 0) {
        simStateRef.current.alertRemainSec -= rawDt;
        if (simStateRef.current.alertRemainSec <= 0) {
          simStateRef.current.alertRemainSec = 0;
          setEmergencyAlert(null);
        }
      }

      // 7. Screen-Space 3D Anchor Projection & Anti-Clipping Update (60 FPS via DOM refs)
      if (currentSelected && getAssetWorldAnchor(currentSelected, _anchorWorldPos)) {
        const cWidth = container.clientWidth || window.innerWidth;
        const cHeight = container.clientHeight || window.innerHeight;

        camera.getWorldDirection(_camForward);
        _toAnchor.subVectors(_anchorWorldPos, camera.position);
        const isInFront = _toAnchor.dot(_camForward) > 0;

        _projPos.copy(_anchorWorldPos).project(camera);

        const layout = computeScreenSpaceCalloutLayout({
          ndcX: _projPos.x,
          ndcY: _projPos.y,
          ndcZ: _projPos.z,
          isInFront,
          canvasWidth: cWidth,
          canvasHeight: cHeight,
          cardWidth: 320,
          cardHeight: 242,
        });

        if (calloutWrapperRef.current) {
          calloutWrapperRef.current.style.display = layout.isVisible ? 'block' : 'none';
          calloutWrapperRef.current.style.transform = `translate3d(${layout.cardX.toFixed(1)}px, ${layout.cardY.toFixed(1)}px, 0)`;
        }
        if (svgOverlayRef.current) {
          svgOverlayRef.current.style.display =
            layout.isVisible && !simStateRef.current.isCardMinimized ? 'block' : 'none';
        }
        if (layout.isVisible) {
          if (svgPolylineRef.current) {
            svgPolylineRef.current.setAttribute('points', layout.svgPoints);
          }
          if (svgAnchorDotRef.current) {
            svgAnchorDotRef.current.setAttribute('cx', layout.screenX.toFixed(1));
            svgAnchorDotRef.current.setAttribute('cy', layout.screenY.toFixed(1));
          }
          if (svgAnchorHaloRef.current) {
            svgAnchorHaloRef.current.setAttribute('cx', layout.screenX.toFixed(1));
            svgAnchorHaloRef.current.setAttribute('cy', layout.screenY.toFixed(1));
          }
          if (svgCardDotRef.current) {
            const targetX = layout.placeLeft ? layout.cardX + 320 : layout.cardX;
            const targetY = layout.cardY + 26;
            svgCardDotRef.current.setAttribute('cx', targetX.toFixed(1));
            svgCardDotRef.current.setAttribute('cy', targetY.toFixed(1));
          }
        }
      } else {
        if (calloutWrapperRef.current) calloutWrapperRef.current.style.display = 'none';
        if (svgOverlayRef.current) svgOverlayRef.current.style.display = 'none';
      }

      // Throttle React HUD clock, tonnage, smooth Cu feedGrade interpolation & live FSM truck telemetry
      if (elapsedSimSec - lastHudSyncSec >= 0.35) {
        lastHudSyncSec = elapsedSimSec;
        setTelemetry((prev) => {
          const targetCu = simStateRef.current.targetFeedGradeCu;
          const diffCu = targetCu - prev.feedGradeCu;
          const nextCu =
            Math.abs(diffCu) < 0.002
              ? targetCu
              : +(prev.feedGradeCu + diffCu * 0.38).toFixed(3);

          const syncedTrucks = prev.trucks.map((tr) => {
            const tk = truckKinematics[tr.id];
            if (!tk) return tr;
            const isRerouted =
              ((tr.id === 'truck-01' || tr.id === 'truck-02') &&
                simStateRef.current.scenarios.ex1Fail) ||
              ((tr.id === 'truck-03' || tr.id === 'truck-04') &&
                simStateRef.current.scenarios.roadBlock);

            let livePayload = 227;
            let liveFuel = 328;
            if (tk.phase === 'LOADING') {
              livePayload = Math.round(Math.min(1.0, tk.phaseTimer / 2.6) * 227);
              liveFuel = 45;
            } else if (tk.phase === 'DUMPING') {
              livePayload = tk.phaseTimer < 1.6 ? 227 : 0;
              liveFuel = 60;
            } else if (tk.phase === 'RETURNING_EMPTY') {
              livePayload = 0;
              liveFuel = 88;
            }

            const remainingKm =
              tk.phase === 'HAULING_UP'
                ? (1.0 - tk.progress) * tk.totalKm
                : tk.phase === 'DUMPING'
                ? 0.05
                : tk.totalKm;
            const liveEta = +Math.max(0.1, (remainingKm / 14.5) * 60 * 0.22).toFixed(1);

            return {
              ...tr,
              fsmPhase: tk.phase,
              speed: tk.speed,
              payload: livePayload,
              fuelLph: liveFuel,
              etaMin: liveEta,
              state: isRerouted
                ? 'REROUTED'
                : tk.phase === 'RETURNING_EMPTY'
                ? 'RETURNING'
                : 'HAULING',
            };
          });

          return {
            ...prev,
            feedGradeCu: nextCu,
            trucks: syncedTrucks,
            simTimeMin: prev.simTimeMin + 0.06 * simStateRef.current.simSpeed,
            minedTonnes: Math.round(
              prev.minedTonnes + (prev.crusherTph / 3600) * 2.1 * simStateRef.current.simSpeed
            ),
          };
        });
      }

      if (isSoftwareGl) {
        renderer.render(scene, camera);
        afterDraw(tick);
      } else {
        composer.render();
        frameId = requestAnimationFrame(tick);
      }
    }

    // --- 10. EXPOSE SCENE ACTIONS TO REACT UI ---
    threeActionsRef.current = {
      selectAsset: (assetId: MiningAssetId | null) => {
        simStateRef.current.selectedAsset = assetId;
        setSelectedAsset(assetId);
        if (assetId !== null) {
          simStateRef.current.isCardMinimized = false;
          setIsCardMinimized(false);
        }

        if (assetId === null) {
          // Orbit overview reset
          simStateRef.current.truckInitialFlyIn = false;
          simStateRef.current.cameraTransitioning = true;
          simStateRef.current.desiredCamPos.set(-82, 112, 238);
          simStateRef.current.desiredTarget.set(6, 12, -18);
          return;
        }

        if (assetId.startsWith('truck-')) {
          simStateRef.current.cameraTransitioning = false;
          simStateRef.current.truckInitialFlyIn = true;
          return;
        }

        simStateRef.current.truckInitialFlyIn = false;
        simStateRef.current.cameraTransitioning = true;

        if (assetId === 'crusher') {
          simStateRef.current.desiredCamPos.set(
            crusherGroup.position.x + 36,
            crusherGroup.position.y + 26,
            crusherGroup.position.z + 44
          );
          simStateRef.current.desiredTarget.set(
            crusherGroup.position.x + 4,
            crusherGroup.position.y + 13,
            crusherGroup.position.z + 2
          );
        } else if (assetId === 'ex-01') {
          simStateRef.current.desiredCamPos.set(
            ex1Refs.root.position.x - 28,
            34,
            ex1Refs.root.position.z + 28
          );
          simStateRef.current.desiredTarget.set(
            ex1Refs.root.position.x,
            22.0,
            ex1Refs.root.position.z
          );
        } else if (assetId === 'ex-02') {
          simStateRef.current.desiredCamPos.set(
            ex2Refs.root.position.x + 26,
            19,
            ex2Refs.root.position.z + 26
          );
          simStateRef.current.desiredTarget.set(
            ex2Refs.root.position.x,
            7.0,
            ex2Refs.root.position.z
          );
        } else if (assetId === 'ex-03') {
          simStateRef.current.desiredCamPos.set(
            ex3Refs.root.position.x + 34,
            44,
            ex3Refs.root.position.z + 30
          );
          simStateRef.current.desiredTarget.set(
            ex3Refs.root.position.x,
            31.0,
            ex3Refs.root.position.z
          );
        } else if (assetId === 'radar') {
          simStateRef.current.desiredCamPos.set(
            radarGroup.position.x - 28,
            52,
            radarGroup.position.z + 36
          );
          simStateRef.current.desiredTarget.set(
            radarGroup.position.x,
            38,
            radarGroup.position.z
          );
        } else if (assetId === 'drill-01') {
          simStateRef.current.desiredCamPos.set(
            drill1.position.x - 24,
            33,
            drill1.position.z + 22
          );
          simStateRef.current.desiredTarget.set(
            drill1.position.x,
            23,
            drill1.position.z
          );
        } else if (assetId === 'drill-02') {
          simStateRef.current.desiredCamPos.set(
            drill2.position.x + 26,
            25,
            drill2.position.z + 20
          );
          simStateRef.current.desiredTarget.set(
            drill2.position.x,
            15,
            drill2.position.z
          );
        } else if (assetId === 'waste-dump') {
          simStateRef.current.desiredCamPos.set(-178, 72, -78);
          simStateRef.current.desiredTarget.set(-136, 40.0, -132);
        }
      },

      setLightingMode: (preset: LightingPreset) => {
        simStateRef.current.lightingPreset = preset;
        setLightingPreset(preset);

        const isNight = preset === 'night';
        const isSunset = preset === 'sunset';
        const showBeams = isNight || isSunset;
        const targetBeamOpacity = isNight ? 0.65 : isSunset ? 0.25 : 0.0;

        volumetricBeamMeshes.forEach((bm) => {
          bm.visible = showBeams;
        });
        volumetricBeamMaterials.forEach((mat) => {
          mat.uniforms.uOpacity.value = targetBeamOpacity;
        });
        groundLightPoolMeshes.forEach((pool) => {
          pool.visible = showBeams;
          const isTruckPool =
            (pool.geometry as THREE.PlaneGeometry).parameters?.height === 16;
          (pool.material as THREE.MeshBasicMaterial).opacity = isNight
            ? isTruckPool
              ? 0.52
              : 0.45
            : 0.22;
        });
        nightPointLights.forEach((npl) => {
          npl.light.intensity = isNight
            ? npl.nightIntensity
            : isSunset
            ? npl.sunsetIntensity
            : 0.0;
        });

        starDomePoints.visible = isNight;
        horizonAzimuthGroup.visible = isNight;
        gisHoloGridLines.visible = isNight;
        plantWindowInst.visible = showBeams;
        plantFloodInst.visible = showBeams;
        hwyBulbInst.visible = showBeams;

        // Bioluminescent LIDAR Ore Bench Scan Effect in Night Mode
        benchStrataUniforms.forEach((bRef, tierIdx) => {
          if (isNight) {
            bRef.faceMat.emissiveMap = bRef.faceMat.map;
            if (tierIdx === 1) {
              // Malachite horizon (+280m): vibrant turquoise-emerald glow (#00f5d4)
              bRef.faceMat.emissive.setHex(0x00f5d4);
              bRef.faceMat.emissiveIntensity = 0.35;
            } else if (tierIdx === 2 || tierIdx === 3) {
              // Chalcopyrite / Sulfide horizons (+220m): warm copper-amber glow (#ff6b00)
              bRef.faceMat.emissive.setHex(0xff6b00);
              bRef.faceMat.emissiveIntensity = 0.32;
            } else {
              bRef.faceMat.emissive.setHex(0x082f49);
              bRef.faceMat.emissiveIntensity = 0.12;
            }
          } else {
            bRef.faceMat.emissive.setHex(0x000000);
            bRef.faceMat.emissiveIntensity = 0.0;
          }
          bRef.faceMat.needsUpdate = true;
        });

        // Smart Haul Road LEDs, IBL Environment Intensity & Crusher / Sump Night Accents
        scene.environmentIntensity = isNight ? 0.18 : isSunset ? 0.68 : 1.0;

        if (isNight) {
          terrainMat.color.setHex(0x0e1626);
          terrainMat.emissive.setHex(0x070d19);
          terrainMat.emissiveIntensity = 0.35;
          ridgeMat.color.setHex(0x1e293b);
          windrowBermMat.color.setHex(0x283548);
          roadMat.color.setHex(0x323e52);
          roadMat.emissive.setHex(0x0a1220);
          roadMat.emissiveIntensity = 0.22;
          concMat.color.setHex(0x475569);
          postMat.color.setHex(0x00e5ff);
          postMat.emissive.setHex(0x00e5ff);
          postMat.emissiveIntensity = 2.4;
          innerLedMat.emissiveIntensity = 2.2;
          wearLinerMat.emissive.setHex(0x9a3412);
          wearLinerMat.emissiveIntensity = 0.55;
          convSignalMat.emissiveIntensity = 2.6;
          lumpMat.emissiveIntensity = 0.75;
          sumpMat.color.setHex(0x06b6d4);
          sumpMat.emissive.setHex(0x06b6d4);
          sumpMat.emissiveIntensity = 0.95;
          sumpMat.opacity = 0.78;
          sumpPointLight.intensity = 3.2;
          sharedCabInteriorMat.emissiveIntensity = 1.6;
        } else {
          terrainMat.color.setHex(0xffffff);
          terrainMat.emissive.setHex(0x000000);
          terrainMat.emissiveIntensity = 0.0;
          ridgeMat.color.setHex(0xffffff);
          windrowBermMat.color.setHex(0xffffff);
          roadMat.color.setHex(0xffffff);
          roadMat.emissive.setHex(0x000000);
          roadMat.emissiveIntensity = 0.0;
          concMat.color.setHex(0x64748b);
          postMat.color.setHex(0xf97316);
          postMat.emissive.setHex(0xea580c);
          postMat.emissiveIntensity = isSunset ? 0.85 : 0.35;
          innerLedMat.emissiveIntensity = isSunset ? 0.75 : 0.25;
          wearLinerMat.emissive.setHex(0x000000);
          wearLinerMat.emissiveIntensity = 0.0;
          convSignalMat.emissiveIntensity = isSunset ? 0.9 : 0.2;
          lumpMat.emissiveIntensity = 0.0;
          sumpMat.color.setHex(0xffffff);
          sumpMat.emissive.setHex(0x000000);
          sumpMat.emissiveIntensity = 0.0;
          sumpMat.opacity = 0.95;
          sumpPointLight.intensity = 0.0;
          sharedCabInteriorMat.emissiveIntensity = isSunset ? 0.8 : 0.15;
        }

        if (preset === 'noon') {
          sunLight.position.set(210, 270, 145);
          sunLight.color.setHex(0xfff5e0);
          sunLight.intensity = 2.05;

          hemiLight.color.setHex(0x8ec5fc);
          hemiLight.groundColor.setHex(0x7c6751);
          hemiLight.intensity = 0.72;

          rimLight.color.setHex(0x9bc5f2);
          rimLight.intensity = 0.45;

          scene.background = new THREE.Color(0xb8d5ec);
          (scene.fog as THREE.FogExp2).color.setHex(0xc4d9ec);
          (scene.fog as THREE.FogExp2).density = 0.00058;

          skyUniforms.uTopColor.value.setHex(0x3b7dd8);
          skyUniforms.uHorizonColor.value.setHex(0xc4d9ec);
          skyUniforms.uSunColor.value.setHex(0xfff4d6);
          skyUniforms.uSunDir.value.copy(sunLight.position).normalize();

          // Limestone-grey dust in steppe noon (#d4c4b0)
          dustMat.color.setHex(0xd4c4b0);
          sharedHeadlightMat.emissiveIntensity = 1.2;
          lightTowerFloodMat.emissiveIntensity = 1.2;
          crusherFloodEmissiveMat.emissiveIntensity = 1.2;
          renderer.toneMappingExposure = 1.06;
          bloomPass.strength = 0.24;
        } else if (preset === 'sunset') {
          sunLight.position.set(-250, 92, 165);
          sunLight.color.setHex(0xff9a3c);
          sunLight.intensity = 2.45;

          hemiLight.color.setHex(0xf59e0b);
          hemiLight.groundColor.setHex(0x432818);
          hemiLight.intensity = 0.64;

          rimLight.color.setHex(0xf59e0b);
          rimLight.intensity = 0.52;

          scene.background = new THREE.Color(0xd8966c);
          (scene.fog as THREE.FogExp2).color.setHex(0xd8966c);
          (scene.fog as THREE.FogExp2).density = 0.00068;

          skyUniforms.uTopColor.value.setHex(0x1e294b);
          skyUniforms.uHorizonColor.value.setHex(0xe29568);
          skyUniforms.uSunColor.value.setHex(0xffb74d);
          skyUniforms.uSunDir.value.copy(sunLight.position).normalize();

          // Golden-terracotta dust in sunset (#df9f74) + warm headlights & pit floodlights
          dustMat.color.setHex(0xdf9f74);
          sharedHeadlightMat.emissiveIntensity = 2.8;
          lightTowerFloodMat.emissiveIntensity = 2.8;
          crusherFloodEmissiveMat.emissiveIntensity = 2.8;
          renderer.toneMappingExposure = 1.14;
          bloomPass.strength = 0.34;
        } else {
          // 'night' — Cyberpunk Industrial Night Shift (Default Mode)
          sunLight.position.set(-160, 220, -140);
          sunLight.color.setHex(0x3b629b);
          sunLight.intensity = 0.35;

          hemiLight.color.setHex(0x16243b);
          hemiLight.groundColor.setHex(0x080b10);
          hemiLight.intensity = 0.42;

          rimLight.color.setHex(0x00d2ff);
          rimLight.intensity = 0.38;

          scene.background = new THREE.Color(0x101d30);
          (scene.fog as THREE.FogExp2).color.setHex(0x101d30);
          (scene.fog as THREE.FogExp2).density = 0.00038;

          skyUniforms.uTopColor.value.setHex(0x040711);
          skyUniforms.uHorizonColor.value.setHex(0x121f33);
          skyUniforms.uSunColor.value.setHex(0x6495ed);
          skyUniforms.uSunDir.value.copy(sunLight.position).normalize();

          dustMat.color.setHex(0x385273);
          sharedHeadlightMat.emissiveIntensity = 3.8;
          lightTowerFloodMat.emissiveIntensity = 3.6;
          crusherFloodEmissiveMat.emissiveIntensity = 3.6;
          renderer.toneMappingExposure = 1.08;
          bloomPass.strength = 0.42;
        }
      },

      toggleScenario: (key: keyof ScenarioState) => {
        const nextActive = !simStateRef.current.scenarios[key];
        const newScenarios: ScenarioState = {
          ...simStateRef.current.scenarios,
          [key]: nextActive,
        };
        simStateRef.current.scenarios = newScenarios;

        // Synchronize What-If state with OpenEgiz Python simulator backend if reachable
        const epMap: Record<keyof ScenarioState, string> = {
          ex1Fail: 'ex1-fail',
          roadBlock: 'road-block',
          dilution: 'dilution',
        };
        const ep = epMap[key];
        if (ep && typeof fetch === 'function') {
          fetch(`/api/whatif/${ep}?active=${nextActive}`, { method: 'POST' }).catch(() => {});
        }

        if (emergencyTimerRef.current !== null) {
          window.clearTimeout(emergencyTimerRef.current);
          emergencyTimerRef.current = null;
        }

        if (key === 'roadBlock') {
          roadBlockFxGroup.visible = nextActive;
          if (nextActive) {
            roadBlockAnimElapsed = 0;
            cascadingBoulders.forEach((cb) => {
              cb.mesh.position.copy(cb.startPos);
            });
          } else {
            (radarBeam.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
            (radarBeam.material as THREE.MeshBasicMaterial).opacity = 0.16;
          }
          truckKinematics['truck-03'].curve = nextActive ? routeDetour : routeEX2;
          truckKinematics['truck-04'].curve = nextActive ? routeDetour : routeEX2;
        }

        if (key === 'ex1Fail') {
          ex1FailFxGroup.visible = nextActive;
          (ex1Refs.houseMesh.material as THREE.MeshPhysicalMaterial).color.setHex(
            nextActive ? 0x7f1d1d : 0xffffff
          );
          truckKinematics['truck-01'].curve = nextActive ? routeEX2 : routeEX1;
          truckKinematics['truck-02'].curve = nextActive ? routeEX2 : routeEX1;
        }

        if (key === 'dilution') {
          dilutionFxGroup.visible = nextActive;
        }

        if (key === 'dilution' || key === 'ex1Fail') {
          const dilutedColor = newScenarios.dilution ? 0x857f78 : 0xd97706;
          ['truck-03', 'truck-04'].forEach((tid) => {
            truckVisuals[tid]?.oreMeshes.forEach((m) => {
              (m.material as THREE.MeshStandardMaterial).color.setHex(dilutedColor);
            });
          });
          ['truck-01', 'truck-02'].forEach((tid) => {
            const col = newScenarios.ex1Fail
              ? newScenarios.dilution
                ? 0x857f78
                : 0xd97706
              : newScenarios.dilution
              ? 0x857f78
              : 0x10b981;
            truckVisuals[tid]?.oreMeshes.forEach((m) => {
              (m.material as THREE.MeshStandardMaterial).color.setHex(col);
            });
          });
          convOreLumps.forEach((lump) => {
            (lump.material as THREE.MeshStandardMaterial).color.setHex(
              newScenarios.dilution ? 0x857f78 : 0x10b981
            );
          });
        }

        // Camera Director & Sci-Fi HUD Emergency Alert Trigger
        simStateRef.current.selectedAsset = null;
        setSelectedAsset(null);
        simStateRef.current.truckInitialFlyIn = false;
        simStateRef.current.cameraTransitioning = true;

        if (nextActive) {
          simStateRef.current.shakeIntensity = 1.4;
          simStateRef.current.shakeElapsed = 0;
          simStateRef.current.alertRemainSec = 2.8;

          if (key === 'roadBlock') {
            simStateRef.current.desiredTarget.set(
              ptsEX2[8].x,
              ptsEX2[8].y + 2,
              ptsEX2[8].z
            );
            simStateRef.current.desiredCamPos.set(
              ptsEX2[8].x - 42,
              ptsEX2[8].y + 24,
              ptsEX2[8].z + 45
            );
            setEmergencyAlert({
              key: 'roadBlock',
              badge: '[ ТРЕВОГА ГЕОТЕХНИЧЕСКОГО МОНИТОРИНГА SSR ]',
              title: 'ОПОЛЗЕНЬ РАМПЫ +240М · БЛОКИРОВКА ОСНОВНОГО СЪЕЗДА',
              subtitle: 'АВТОМАТИЧЕСКИЙ ПЕРЕРАСЧЕТ МАРШРУТОВ И БАЛАНСА РУДЫ ДИСПЕТЧЕРОМ КАРЬЕРА',
              tone: 'amber',
            });
          } else if (key === 'ex1Fail') {
            simStateRef.current.desiredTarget.set(
              ex1Refs.root.position.x,
              ex1Refs.root.position.y + 6,
              ex1Refs.root.position.z
            );
            simStateRef.current.desiredCamPos.set(
              ex1Refs.root.position.x - 30,
              ex1Refs.root.position.y + 18,
              ex1Refs.root.position.z + 30
            );
            setEmergencyAlert({
              key: 'ex1Fail',
              badge: '[ АВАРИЙНЫЙ ОТКАЗ ОСНОВНОГО ОБОРУДОВАНИЯ ]',
              title: 'АВАРИЙНАЯ ОСТАНОВКА ЭКСКАВАТОРА CAT 7495 EX-01 (+280М)',
              subtitle: 'АВТОМАТИЧЕСКИЙ ПЕРЕРАСЧЕТ МАРШРУТОВ И БАЛАНСА РУДЫ ДИСПЕТЧЕРОМ КАРЬЕРА',
              tone: 'red',
            });
          } else if (key === 'dilution') {
            simStateRef.current.desiredTarget.set(
              crusherGroup.position.x + 2,
              crusherGroup.position.y + 22.0,
              crusherGroup.position.z + 2
            );
            simStateRef.current.desiredCamPos.set(
              crusherGroup.position.x + 46,
              crusherGroup.position.y + 36,
              crusherGroup.position.z + 58
            );
            setEmergencyAlert({
              key: 'dilution',
              badge: '[ ТЕХНОЛОГИЧЕСКИЙ СБОЙ ШИХТОВКИ ]',
              title: 'РАЗУБОЖИВАНИЕ РУДЫ В ЗАБОЕ EX-02 (+220М) ДО 0.22% Cu',
              subtitle: 'АВТОМАТИЧЕСКИЙ ПЕРЕРАСЧЕТ МАРШРУТОВ И БАЛАНСА РУДЫ ДИСПЕТЧЕРОМ КАРЬЕРА',
              tone: 'purple',
            });
          }
        } else {
          simStateRef.current.alertRemainSec = 0;
          setEmergencyAlert(null);
          simStateRef.current.shakeIntensity = 0;
          simStateRef.current.shakeElapsed = 0;
          simStateRef.current.desiredCamPos.set(-82, 112, 238);
          simStateRef.current.desiredTarget.set(6, 12, -18);
        }

        const computed = computeScenarioMetrics(newScenarios, INITIAL_TRUCKS);
        simStateRef.current.targetFeedGradeCu = computed.feedGradeCu;

        const scenarioTitles: Record<keyof ScenarioState, string> = {
          ex1Fail: 'Авария экскаватора EX-01 (+280м)',
          roadBlock: 'Оползень рампы +240м (SSR Alert)',
          dilution: 'Разубоживание руды в забое EX-02',
        };

        setTelemetry((prev) => {
          const clockStr = formatSimClock(prev.simTimeMin);
          const msg = nextActive
            ? `[Симуляция] Активирован сценарий: ${scenarioTitles[key]}. Пересчет шихты и маршрутов.`
            : `[Штатный режим] Сценарий «${scenarioTitles[key]}» снят. Восстановлен базовый план.`;

          return {
            ...prev,
            activeScenarios: newScenarios,
            feedGradeCu: computed.feedGradeCu,
            crusherTph: computed.crusherTph,
            fleetFuelLph: computed.fleetFuelLph,
            radarStatus: computed.radarStatus,
            radarDispMmDay: computed.radarDispMmDay,
            trucks: computed.trucks,
            logs: [
              { time: clockStr, text: msg, type: nextActive ? 'alert' : 'success' },
              ...prev.logs.slice(0, 8),
            ],
          };
        });
      },
    };

    // Initialize scene in 'night' (Cyberpunk Industrial) mode by default before compiling shaders & starting loop
    threeActionsRef.current.setLightingMode('night');

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    tick();

    function handleResize() {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      ssaoPass.setSize(w, h);
      bloomPass.resolution.set(w, h);
    }
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      if (emergencyTimerRef.current !== null) {
        window.clearTimeout(emergencyTimerRef.current);
      }
      window.removeEventListener('resize', handleResize);
      domElem.removeEventListener('pointerdown', onPointerDown);
      domElem.removeEventListener('pointermove', onPointerMove);
      domElem.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const activeCallout = selectedAsset
    ? getAssetCalloutTelemetry(selectedAsset, telemetry)
    : null;

  const inspectedTruckId =
    selectedAsset && selectedAsset.startsWith('truck-') ? selectedAsset : 'truck-01';
  const selectedTruck =
    telemetry.trucks.find((t) => t.id === inspectedTruckId) || telemetry.trucks[0];

  const gradeDelta = telemetry.feedGradeCu - telemetry.targetGradeCu;
  const gradeInSpec = telemetry.feedGradeCu >= 0.44 && telemetry.feedGradeCu <= 0.52;

  function renderCategoryIcon(category: string) {
    if (category === 'truck') return <Truck className="w-4 h-4 text-amber-400 shrink-0" />;
    if (category === 'shovel') return <Activity className="w-4 h-4 text-sky-400 shrink-0" />;
    if (category === 'crusher') return <Cog className="w-4 h-4 text-emerald-400 shrink-0" />;
    if (category === 'drill') return <Drill className="w-4 h-4 text-sky-400 shrink-0" />;
    if (category === 'radar') return <Radar className="w-4 h-4 text-emerald-400 shrink-0" />;
    return <Mountain className="w-4 h-4 text-amber-400 shrink-0" />;
  }

  return (
    <div
      data-testid="aktogay-twin-root"
      data-lighting={lightingPreset}
      data-selected-asset={selectedAsset || 'orbit'}
      data-radar={telemetry.radarStatus}
      className="relative w-full h-screen overflow-hidden bg-slate-950 text-slate-100 select-none"
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      {/* Dedicated WebGL Canvas Container */}
      <div
        ref={mountRef}
        data-testid="webgl-canvas-container"
        className="w-full h-full"
      />

      {/* Fullscreen Emergency Perimeter Vignette & Top-Center Sci-Fi HUD Alert Banner */}
      {emergencyAlert && (
        <>
          <div
            data-testid="emergency-vignette"
            className="pointer-events-none fixed inset-0 z-30 shadow-[inset_0_0_120px_rgba(239,68,68,0.35)] animate-pulse"
          />
          <div
            data-testid="emergency-sci-fi-banner"
            role="alert"
            className={`pointer-events-none fixed top-16 left-1/2 -translate-x-1/2 z-40 w-[min(680px,92vw)] rounded-xl overflow-hidden bg-slate-950/95 backdrop-blur-md shadow-2xl border animate-hud-callout ${
              emergencyAlert.tone === 'amber'
                ? 'border-amber-500/90 shadow-amber-500/20'
                : emergencyAlert.tone === 'red'
                ? 'border-red-500/90 shadow-red-500/25'
                : 'border-purple-500/90 shadow-purple-500/25'
            }`}
          >
            {/* Top Diagonal Hazard Stripe Edge */}
            <div
              className="h-2.5 w-full"
              style={{
                backgroundImage:
                  emergencyAlert.tone === 'amber'
                    ? 'repeating-linear-gradient(45deg, #f59e0b 0px, #f59e0b 14px, #090d16 14px, #090d16 28px)'
                    : emergencyAlert.tone === 'red'
                    ? 'repeating-linear-gradient(45deg, #ef4444 0px, #ef4444 14px, #090d16 14px, #090d16 28px)'
                    : 'repeating-linear-gradient(45deg, #a855f7 0px, #a855f7 14px, #090d16 14px, #090d16 28px)',
              }}
            />

            <div className="px-6 py-3.5 text-center space-y-1">
              <div
                className={`font-mono text-xs font-bold tracking-widest ${
                  emergencyAlert.tone === 'amber'
                    ? 'text-amber-400'
                    : emergencyAlert.tone === 'red'
                    ? 'text-red-400'
                    : 'text-purple-400'
                }`}
              >
                {emergencyAlert.badge}
              </div>
              <div className="text-sm sm:text-base font-extrabold tracking-wide text-white">
                {emergencyAlert.title}
              </div>
              <div className="font-mono text-[11px] tracking-wider text-slate-300">
                {emergencyAlert.subtitle}
              </div>
            </div>

            {/* Bottom Diagonal Hazard Stripe Edge */}
            <div
              className="h-2.5 w-full"
              style={{
                backgroundImage:
                  emergencyAlert.tone === 'amber'
                    ? 'repeating-linear-gradient(45deg, #f59e0b 0px, #f59e0b 14px, #090d16 14px, #090d16 28px)'
                    : emergencyAlert.tone === 'red'
                    ? 'repeating-linear-gradient(45deg, #ef4444 0px, #ef4444 14px, #090d16 14px, #090d16 28px)'
                    : 'repeating-linear-gradient(45deg, #a855f7 0px, #a855f7 14px, #090d16 14px, #090d16 28px)',
              }}
            />
          </div>
        </>
      )}

      {/* SVG Leader Line Overlay (Cyber-Mining HUD Callout Connector) */}
      <svg
        ref={svgOverlayRef}
        data-testid="asset-leader-svg"
        className="pointer-events-none absolute inset-0 z-20 w-full h-full"
        style={{ display: selectedAsset && !isCardMinimized ? 'block' : 'none' }}
      >
        <defs>
          <filter id="cyber-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <polyline
          ref={svgPolylineRef}
          fill="none"
          stroke="rgba(56, 189, 248, 0.65)"
          strokeWidth="1.75"
          strokeDasharray="4 2"
          filter="url(#cyber-glow)"
          points="0,0 0,0 0,0"
        />
        <circle
          ref={svgAnchorHaloRef}
          cx="0"
          cy="0"
          r="9"
          fill="rgba(56, 189, 248, 0.16)"
          stroke="rgba(56, 189, 248, 0.55)"
          strokeWidth="1.2"
        />
        <circle
          ref={svgAnchorDotRef}
          cx="0"
          cy="0"
          r="4"
          fill="#38bdf8"
          filter="url(#cyber-glow)"
        />
        <circle
          ref={svgCardDotRef}
          cx="0"
          cy="0"
          r="3"
          fill="#38bdf8"
        />
      </svg>

      {/* Screen-Space 3D Floating Telemetry Callout Card (Full Panel or Compact Pill Mode) */}
      <div
        ref={calloutWrapperRef}
        className="pointer-events-none absolute top-0 left-0 z-20 will-change-transform"
        style={{ display: selectedAsset ? 'block' : 'none' }}
      >
        {activeCallout && (
          <div
            key={activeCallout.assetId}
            data-testid="asset-callout-card"
            data-minimized={isCardMinimized ? 'true' : 'false'}
            className={
              isCardMinimized
                ? 'pointer-events-auto animate-hud-callout rounded-full bg-slate-950/88 backdrop-blur-md border border-sky-500/50 px-3.5 py-1.5 flex items-center gap-2.5 shadow-2xl text-xs whitespace-nowrap'
                : 'pointer-events-auto animate-hud-callout bg-slate-950/92 backdrop-blur-md border border-sky-500/40 rounded-xl shadow-2xl p-4 w-80 text-xs'
            }
          >
            {isCardMinimized ? (
              <>
                <span
                  className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${
                    activeCallout.badgeTone === 'red'
                      ? 'bg-red-400 shadow-[0_0_8px_#f87171]'
                      : activeCallout.badgeTone === 'amber'
                      ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                      : 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                  }`}
                />
                <span className="font-bold text-white text-xs">
                  {activeCallout.title}
                </span>
                <span className="font-mono text-[11px] text-sky-400">
                  {activeCallout.badgeText}
                </span>
                <button
                  type="button"
                  data-testid="toggle-minimize-callout"
                  aria-label="Развернуть телеметрию"
                  title="Развернуть телеметрию"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsCardMinimized((prev) => {
                      const next = !prev;
                      simStateRef.current.isCardMinimized = next;
                      return next;
                    });
                  }}
                  className="p-1 rounded-full text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors shrink-0"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Закрыть карточку телеметрии"
                  title="Закрыть карточку телеметрии"
                  onClick={(e) => {
                    e.stopPropagation();
                    threeActionsRef.current.selectAsset(null);
                  }}
                  className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                {/* Card Header with Icon, Title, Minimize Button & Close Button */}
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {renderCategoryIcon(activeCallout.category)}
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-white truncate">
                        {activeCallout.title}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {activeCallout.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      data-testid="toggle-minimize-callout"
                      aria-label="Свернуть панель (сохранить 3D-фокус)"
                      title="Свернуть панель (сохранить 3D-фокус)"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsCardMinimized((prev) => {
                          const next = !prev;
                          simStateRef.current.isCardMinimized = next;
                          return next;
                        });
                      }}
                      className="p-1 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800/80 transition-colors"
                    >
                      <Minimize2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Закрыть карточку телеметрии"
                      title="Закрыть карточку телеметрии"
                      onClick={(e) => {
                        e.stopPropagation();
                        threeActionsRef.current.selectAsset(null);
                      }}
                      className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Status Kicker Line */}
                <div className="flex items-center justify-between py-1.5 px-2.5 mb-3 rounded-lg bg-slate-900/90 border border-slate-800/90 font-mono text-[11px]">
                  <span className="text-slate-400">СТАТУС УЗЛА</span>
                  <span
                    className={`font-semibold ${
                      activeCallout.badgeTone === 'red'
                        ? 'text-red-400'
                        : activeCallout.badgeTone === 'amber'
                        ? 'text-amber-400'
                        : activeCallout.badgeTone === 'emerald'
                        ? 'text-emerald-400'
                        : 'text-sky-400'
                    }`}
                  >
                    {activeCallout.badgeText}
                  </span>
                </div>

                {/* Telemetry Rows */}
                <div
                  className="space-y-2 border-t border-slate-800/80 pt-2.5"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {activeCallout.rows.map((row, idx) => (
                    <div key={idx} className="flex items-baseline justify-between gap-3">
                      <span className="text-slate-400 shrink-0">{row.label}:</span>
                      <span
                        className={`font-mono text-right font-medium ${
                          row.highlight === 'sky'
                            ? 'text-sky-400'
                            : row.highlight === 'emerald'
                            ? 'text-emerald-400'
                            : row.highlight === 'amber'
                            ? 'text-amber-400'
                            : row.highlight === 'red'
                            ? 'text-red-400'
                            : 'text-slate-100'
                        }`}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Top Navigation & Telemetry Header Bar */}
      <header className="absolute top-3 left-4 right-4 z-10 flex items-center justify-between gap-6 px-5 py-2.5 bg-slate-950/90 border border-slate-800/90 rounded-xl shadow-lg">
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm font-bold tracking-tight text-sky-400 whitespace-nowrap">
            AKTOGAY DIGITAL TWIN
          </span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-xs font-medium text-slate-300 whitespace-nowrap">
            KAZ Minerals / OpenEgiz
          </span>
          <span className="hidden md:inline text-slate-600" aria-hidden="true">·</span>
          <span className="hidden md:inline text-xs text-slate-400 whitespace-nowrap">
            Кликните на объект в 3D или выберите в доке
          </span>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div
            role="group"
            aria-label="Режим освещения карьера"
            className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg"
          >
            <button
              type="button"
              onClick={() => threeActionsRef.current.setLightingMode('noon')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                lightingPreset === 'noon'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Степной полдень
            </button>
            <button
              type="button"
              onClick={() => threeActionsRef.current.setLightingMode('sunset')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                lightingPreset === 'sunset'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Золотой закат
            </button>
            <button
              type="button"
              onClick={() => threeActionsRef.current.setLightingMode('night')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap border ${
                lightingPreset === 'night'
                  ? 'border-cyan-400 bg-cyan-950/80 text-cyan-200 shadow-[0_0_14px_rgba(0,240,255,0.45)]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Moon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Ночная смена</span>
            </button>
          </div>

          <div
            role="group"
            aria-label="Скорость симуляции"
            className="hidden sm:flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg"
          >
            {[1, 2, 5].map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => {
                  simStateRef.current.simSpeed = spd;
                  setSimSpeed(spd);
                }}
                className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap ${
                  simSpeed === spd
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs shrink-0">
          <div
            className="hidden lg:flex items-center gap-3 text-slate-300"
            style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}
          >
            <span>Смена: <b className="text-white">{formatSimClock(telemetry.simTimeMin)}</b></span>
            <span className="text-slate-600">·</span>
            <span>Cu: <b className={gradeInSpec ? 'text-emerald-400' : 'text-amber-400'}>{telemetry.feedGradeCu.toFixed(3)}%</b></span>
          </div>

          <button
            type="button"
            onClick={() => setHudCollapsed((prev) => !prev)}
            className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            {hudCollapsed ? 'Показать панели' : 'Чистый обзор 3D'}
          </button>
        </div>
      </header>

      {/* Left Dispatcher Telemetry & Ore Blending Panel */}
      {!hudCollapsed && (
        <aside
          aria-label="Телеметрия шихтовки руды и парка техники"
          className="absolute top-18 left-4 z-10 w-80 bg-slate-950/92 border border-slate-800/90 rounded-xl p-4 shadow-xl"
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold tracking-wider text-slate-400">
              КАЧЕСТВО РУДЫ НА ДРОБИЛКЕ
            </h2>
            <span
              className={`text-xs font-semibold ${
                gradeInSpec ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {gradeInSpec ? 'В НОРМЕ (ШИХТОВКА)' : 'ОТКЛОНЕНИЕ Cu'}
            </span>
          </div>

          <div
            className="flex items-baseline gap-3 mb-1"
            style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}
          >
            <span
              data-testid="feed-grade-value"
              className={`text-3xl font-bold ${
                gradeInSpec ? 'text-sky-400' : 'text-amber-400'
              }`}
            >
              {telemetry.feedGradeCu.toFixed(3)} %
            </span>
            <span className="text-xs text-slate-400">
              {gradeDelta >= 0 ? `+${gradeDelta.toFixed(3)}%` : `${gradeDelta.toFixed(3)}%`} к цели
            </span>
          </div>

          <div className="text-xs text-slate-400 mb-3">
            Цель фабрики: 0.480% Cu · Допуск: 0.440% – 0.520%
          </div>

          <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden mb-4 border border-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                gradeInSpec ? 'bg-sky-500' : 'bg-amber-500'
              }`}
              style={{
                width: `${Math.min(100, Math.max(15, ((telemetry.feedGradeCu - 0.3) / 0.35) * 100))}%`,
              }}
            />
          </div>

          <div
            className="space-y-2 text-xs border-t border-slate-800/90 pt-3 mb-4"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            <div className="flex justify-between">
              <span className="text-slate-400">Добыча горной массы:</span>
              <b className="font-mono text-slate-100">{telemetry.minedTonnes.toLocaleString('ru-RU')} т</b>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Питание ККД (Дробилка):</span>
              <b className="font-mono text-slate-100">{telemetry.crusherTph} т/ч</b>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Расход дизеля (парк CAT):</span>
              <b className="font-mono text-slate-100">{telemetry.fleetFuelLph} л/ч</b>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Георадар откосов SSR-XT:</span>
              <b
                data-testid="radar-status-text"
                className={`font-mono ${
                  telemetry.radarStatus === 'NORMAL' ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {telemetry.radarStatus === 'NORMAL'
                  ? `Стабильно (${telemetry.radarDispMmDay.toFixed(2)} мм)`
                  : `ОПОЛЗЕНЬ (${telemetry.radarDispMmDay.toFixed(2)} мм)`}
              </b>
            </div>
          </div>

          <div className="border-t border-slate-800/90 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400">ТЕЛЕМЕТРИЯ САМОСВАЛА</span>
              <span className="text-xs text-slate-400">{selectedTruck.bench}</span>
            </div>

            <div
              className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2.5 text-xs space-y-1"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              <div className="flex justify-between font-medium">
                <span className="text-amber-400">{selectedTruck.name}</span>
                <span className="font-mono text-slate-300">
                  {selectedTruck.fsmPhase ?? selectedTruck.state}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Забой:</span>
                <span className="text-slate-200">{selectedTruck.shovel}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Груз / Марка Cu:</span>
                <span className="font-mono text-slate-200">
                  {selectedTruck.fsmPhase === 'LOADING'
                    ? `0 -> 227 т (${selectedTruck.payload} т)`
                    : selectedTruck.fsmPhase === 'DUMPING'
                    ? '227 -> 0 т'
                    : selectedTruck.fsmPhase === 'RETURNING_EMPTY'
                    ? '0 т · Порожний'
                    : `${selectedTruck.payload} т · ${selectedTruck.grade.toFixed(2)}% Cu`}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Шины / Индекс:</span>
                <span className="font-mono text-slate-200">
                  {selectedTruck.tirePressureBar.toFixed(1)} bar · {selectedTruck.tkph} TKPH
                </span>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Right What-If Dispatcher Scenarios & Event Log Panel */}
      {!hudCollapsed && (
        <aside
          aria-label="Пульт диспетчера: сценарии Что-Если"
          className="absolute top-18 right-4 z-10 w-86 bg-slate-950/92 border border-slate-800/90 rounded-xl p-4 shadow-xl"
        >
          <div className="text-xs font-semibold tracking-wider text-slate-400 mb-3">
            ПУЛЬТ ДИСПЕТЧЕРА: СЦЕНАРИИ «ЧТО-ЕСЛИ»
          </div>

          <div className="flex flex-col gap-2 mb-4">
            <button
              type="button"
              onClick={() => threeActionsRef.current.toggleScenario('ex1Fail')}
              className={`w-full px-3.5 py-2.5 rounded-lg border text-left transition-colors flex items-center justify-between gap-2 ${
                telemetry.activeScenarios.ex1Fail
                  ? 'bg-red-950/90 border-red-500/80 text-white'
                  : 'bg-slate-900/90 border-slate-800 text-slate-200 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="font-semibold text-xs text-slate-100">
                  Авария экскаватора EX-01 (+280м)
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Остановка богатой малахитовой руды (0.64% Cu)
                </div>
              </div>
              <span
                className={`text-xs font-mono font-semibold shrink-0 ${
                  telemetry.activeScenarios.ex1Fail ? 'text-red-400' : 'text-slate-500'
                }`}
              >
                {telemetry.activeScenarios.ex1Fail ? 'АКТИВЕН' : 'ВЫКЛ'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => threeActionsRef.current.toggleScenario('roadBlock')}
              className={`w-full px-3.5 py-2.5 rounded-lg border text-left transition-colors flex items-center justify-between gap-2 ${
                telemetry.activeScenarios.roadBlock
                  ? 'bg-amber-950/90 border-amber-500/80 text-white'
                  : 'bg-slate-900/90 border-slate-800 text-slate-200 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="font-semibold text-xs text-slate-100">
                  Оползень рампы +240м
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Объезд по резервной трассе (+1.4 км, SSR Alert)
                </div>
              </div>
              <span
                className={`text-xs font-mono font-semibold shrink-0 ${
                  telemetry.activeScenarios.roadBlock ? 'text-amber-400' : 'text-slate-500'
                }`}
              >
                {telemetry.activeScenarios.roadBlock ? 'АКТИВЕН' : 'ВЫКЛ'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => threeActionsRef.current.toggleScenario('dilution')}
              className={`w-full px-3.5 py-2.5 rounded-lg border text-left transition-colors flex items-center justify-between gap-2 ${
                telemetry.activeScenarios.dilution
                  ? 'bg-purple-950/90 border-purple-500/80 text-white'
                  : 'bg-slate-900/90 border-slate-800 text-slate-200 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="font-semibold text-xs text-slate-100">
                  Разубоживание в забое EX-02
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Снижение до 0.22% Cu (адаптация шихты)
                </div>
              </div>
              <span
                className={`text-xs font-mono font-semibold shrink-0 ${
                  telemetry.activeScenarios.dilution ? 'text-purple-400' : 'text-slate-500'
                }`}
              >
                {telemetry.activeScenarios.dilution ? 'АКТИВЕН' : 'ВЫКЛ'}
              </span>
            </button>
          </div>

          <div className="border-t border-slate-800/90 pt-3 mb-3">
            <div className="text-xs font-semibold text-slate-400 mb-2">
              ГЕОЛОГИЯ УСТУПОВ (МИНЕРАЛИЗАЦИЯ)
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 shrink-0" />
                <span className="truncate">Малахит/Азурит (+280м)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 shrink-0" />
                <span className="truncate">Халькопирит (+220м)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-xs bg-stone-500 shrink-0" />
                <span className="truncate">Вскрыша (+350м)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-xs bg-teal-600 shrink-0" />
                <span className="truncate">Водосборник (+150м)</span>
              </div>
            </div>
          </div>

          <div className="text-xs font-semibold text-slate-400 mb-1.5">
            ЖУРНАЛ ДИСПЕТЧЕРА
          </div>
          <div
            data-testid="dispatcher-log"
            className="bg-slate-900/95 border border-slate-800/90 rounded-lg p-2.5 max-h-28 overflow-y-auto text-xs space-y-1.5"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {telemetry.logs.map((log, idx) => (
              <div
                key={idx}
                className={
                  log.type === 'alert'
                    ? 'text-red-400'
                    : log.type === 'success'
                    ? 'text-emerald-400'
                    : 'text-slate-400'
                }
              >
                [{log.time}] {log.text}
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* Redesigned Bottom Segmented Asset Navigation Dock */}
      <nav
        aria-label="Сегментированная панель выбора объектов карьера"
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-wrap xl:flex-nowrap items-center justify-center gap-1.5 bg-slate-950/94 backdrop-blur-md border border-slate-800/90 px-3 py-1.5 rounded-2xl shadow-2xl max-w-[98vw]"
      >
        {/* Overview Reset Button */}
        <button
          type="button"
          data-asset-id="orbit"
          aria-label="Обзор карьера"
          onClick={() => threeActionsRef.current.selectAsset(null)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            selectedAsset === null
              ? 'bg-sky-600 text-white shadow-sm'
              : 'bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Обзор карьера</span>
        </button>

        <div className="h-4 w-px bg-slate-800 hidden sm:block" aria-hidden="true" />

        {/* Segment 1: CAT 793F Haul Trucks */}
        <div
          role="group"
          aria-label="Самосвалы CAT 793F"
          className="flex items-center gap-0.5 bg-slate-900/90 border border-slate-800/90 px-1.5 py-0.5 rounded-xl shrink-0"
        >
          <span className="text-[11px] font-medium text-slate-400 px-1 hidden md:inline whitespace-nowrap">
            CAT 793F:
          </span>
          {(
            [
              { id: 'truck-01', label: '#01' },
              { id: 'truck-02', label: '#02' },
              { id: 'truck-03', label: '#03' },
              { id: 'truck-04', label: '#04' },
              { id: 'truck-05', label: '#05' },
            ] as Array<{ id: MiningAssetId; label: string }>
          ).map((tr) => (
            <button
              key={tr.id}
              type="button"
              data-asset-id={tr.id}
              aria-label={`Самосвал ${tr.label}`}
              onClick={() => threeActionsRef.current.selectAsset(tr.id)}
              className={`px-2 py-1 rounded-lg text-xs font-mono font-semibold transition-colors whitespace-nowrap shrink-0 ${
                selectedAsset === tr.id
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>

        {/* Segment 2: CAT 7495 Rope Shovels */}
        <div
          role="group"
          aria-label="Экскаваторы CAT 7495"
          className="flex items-center gap-0.5 bg-slate-900/90 border border-slate-800/90 px-1.5 py-0.5 rounded-xl shrink-0"
        >
          <span className="text-[11px] font-medium text-slate-400 px-1 hidden lg:inline whitespace-nowrap">
            CAT 7495:
          </span>
          {(
            [
              { id: 'ex-01', label: 'EX-01 (+280м)' },
              { id: 'ex-02', label: 'EX-02 (+220м)' },
              { id: 'ex-03', label: 'EX-03 (+310м)' },
            ] as Array<{ id: MiningAssetId; label: string }>
          ).map((ex) => (
            <button
              key={ex.id}
              type="button"
              data-asset-id={ex.id}
              aria-label={`Экскаватор ${ex.label}`}
              onClick={() => threeActionsRef.current.selectAsset(ex.id)}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                selectedAsset === ex.id
                  ? 'bg-sky-600 text-white font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              {ex.label}
            </button>
          ))}
        </div>

        {/* Segment 3: Infrastructure & Drills */}
        <div
          role="group"
          aria-label="Инфраструктура карьера"
          className="flex items-center gap-0.5 bg-slate-900/90 border border-slate-800/90 px-1.5 py-0.5 rounded-xl shrink-0"
        >
          {(
            [
              { id: 'crusher', label: 'Дробилка ККД' },
              { id: 'radar', label: 'Радар SSR-XT' },
              { id: 'drill-01', label: 'Буровой станок' },
              { id: 'waste-dump', label: 'Отвал' },
            ] as Array<{ id: MiningAssetId; label: string }>
          ).map((inf) => (
            <button
              key={inf.id}
              type="button"
              data-asset-id={inf.id}
              aria-label={inf.label}
              onClick={() => threeActionsRef.current.selectAsset(inf.id)}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                selectedAsset === inf.id || (inf.id === 'drill-01' && selectedAsset === 'drill-02')
                  ? 'bg-emerald-600 text-white font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              {inf.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
