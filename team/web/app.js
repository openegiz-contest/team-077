/**
 * Aktogay Open-Pit Mine 3D Digital Twin Visualizer
 * Team AURA (team-077) for OpenEgiz Contest
 */

let scene, camera, renderer, controls;
let truckMeshes = {};
let shovelMeshes = {};
let pitMesh, rampLine, detourLine;
let radarBeamMesh, rockslideGroup;
let activeCamTarget = null;
let currentCameraMode = "orbit";

// Coordinates for key pit locations
// Ground surface plateau is at elevation Y = 35 (+350m horizon)
// Quarry crater descends down to Y = -12 (+150m horizon pit floor)
const LOCATIONS = {
  crusher: new THREE.Vector3(82, 35, -128),
  stockpile: new THREE.Vector3(124, 35, -138),
  waste_dump: new THREE.Vector3(-125, 35, -120),
  ex1: new THREE.Vector3(72, 19, 65),     // Bench +280m High-grade Cu (0.64%)
  ex2: new THREE.Vector3(-28, 3, 30),     // Bench +220m ROM Porphyry Cu (0.40%)
  ex3: new THREE.Vector3(-85, 28, -85),   // Bench +320m Waste Overburden
  radar: new THREE.Vector3(0, 35, -155),  // North rim Slope Stability Radar (SSR)
};

// Spline Curves for Haul Routes
let routeEX1, routeEX2, routeEX3, routeDetour;

function init() {
  const canvas = document.getElementById("viewport");
  scene = new THREE.Scene();

  // Natural open-pit daylight sky with soft atmospheric horizon haze
  const skyColor = new THREE.Color(0xaec5d8);
  scene.background = skyColor;
  scene.fog = new THREE.FogExp2(0xaec5d8, 0.0006);

  camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 1, 3200);
  camera.position.set(-50, 155, 235);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2.05; // Prevent camera clipping underground
  controls.minDistance = 20;
  controls.maxDistance = 850;
  controls.target.set(10, 8, -15);

  setupLighting();
  buildTerrainAndPit();
  buildRoads();
  buildInfrastructure();
  buildEquipment();

  window.addEventListener("resize", onWindowResize);
  animate();

  // Start polling simulation state
  fetchState();
  setInterval(fetchState, 600);
}

function setupLighting() {
  // Ambient fill light for realistic soft shadows
  const ambientLight = new THREE.AmbientLight(0xdbe6f0, 0.55);
  scene.add(ambientLight);

  // Directional sun light casting soft natural shadows
  const sunLight = new THREE.DirectionalLight(0xfff5ea, 1.35);
  sunLight.position.set(180, 260, 140);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 20;
  sunLight.shadow.camera.far = 900;
  sunLight.shadow.camera.left = -320;
  sunLight.shadow.camera.right = 320;
  sunLight.shadow.camera.top = 320;
  sunLight.shadow.camera.bottom = -320;
  sunLight.shadow.bias = -0.0003;
  scene.add(sunLight);

  // Sky hemisphere bounce light
  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x475569, 0.45);
  scene.add(hemiLight);
}

function buildTerrainAndPit() {
  const pitGroup = new THREE.Group();

  // 1. Expansive Steppe Plateau Landscape extending to R = 1500 (seamlessly fading into horizon fog)
  const rimRadius = 152;
  const outerRadius = 1500;
  const terrainGeo = new THREE.RingGeometry(rimRadius, outerRadius, 64, 8);
  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x746858, // Kazakh steppe earth
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = 35;
  terrain.receiveShadow = true;
  pitGroup.add(terrain);

  // Outer safety perimeter ridge (обваловка / защитный вал по бровке карьера)
  const ridgeGeo = new THREE.TorusGeometry(rimRadius + 2.5, 2.4, 8, 64);
  const ridgeMat = new THREE.MeshStandardMaterial({
    color: 0x615445,
    roughness: 0.96,
    flatShading: true,
  });
  const ridge = new THREE.Mesh(ridgeGeo, ridgeMat);
  ridge.rotation.x = Math.PI / 2;
  ridge.position.y = 36.2;
  ridge.castShadow = true;
  ridge.receiveShadow = true;
  pitGroup.add(ridge);

  // 2. Open-Pit Stepped Benches (Каскад уступов карьера)
  // Modeled as continuous stepped conical benches descending down into the earth
  const benchTiers = [
    {
      // Tier 0: Horizon +350m to +320m (Waste overburden / Наносы и вскрыша)
      yTop: 35, rTop: 152, yBottom: 28, rToe: 136, rBermIn: 122,
      faceColor: 0x6e6152, bermColor: 0x5a4f43
    },
    {
      // Tier 1: Horizon +320m to +280m (High-grade Cu mineralization - Забой EX-01)
      yTop: 28, rTop: 122, yBottom: 19, rToe: 104, rBermIn: 90,
      faceColor: 0x2e5b50, bermColor: 0x3d4e48 // Rich malachite-oxidized copper ore
    },
    {
      // Tier 2: Horizon +280m to +250m (Intermediate transition sulfide horizon)
      yTop: 19, rTop: 90, yBottom: 11, rToe: 74, rBermIn: 62,
      faceColor: 0x6b513d, bermColor: 0x544031 // Mixed sulfide copper ore
    },
    {
      // Tier 3: Horizon +250m to +220m (Primary ROM porphyry Cu - Забой EX-02)
      yTop: 11, rTop: 62, yBottom: 3, rToe: 48, rBermIn: 36,
      faceColor: 0x7d5233, bermColor: 0x5c3d26 // Chalcopyrite bronze tone
    },
    {
      // Tier 4: Horizon +220m to +180m (Deep excavation horizon)
      yTop: 3, rTop: 36, yBottom: -5, rToe: 26, rBermIn: 18,
      faceColor: 0x483a31, bermColor: 0x362c25 // Deep dark intrusive bedrock
    },
    {
      // Tier 5: Horizon +180m to +150m (Pit bottom slope to sump floor)
      yTop: -5, rTop: 18, yBottom: -12, rToe: 14, rBermIn: 0,
      faceColor: 0x30251e, bermColor: 0x261d17
    },
  ];

  benchTiers.forEach((t) => {
    // Face (batter wall)
    const height = t.yTop - t.yBottom;
    const centerY = (t.yTop + t.yBottom) / 2;
    const faceGeo = new THREE.CylinderGeometry(t.rTop, t.rToe, height, 64, 1, true);
    const faceMat = new THREE.MeshStandardMaterial({
      color: t.faceColor,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    const faceMesh = new THREE.Mesh(faceGeo, faceMat);
    faceMesh.position.y = centerY;
    faceMesh.receiveShadow = true;
    faceMesh.castShadow = true;
    pitGroup.add(faceMesh);

    // Horizontal working berm shelf
    if (t.rBermIn > 0) {
      const bermGeo = new THREE.RingGeometry(t.rBermIn, t.rToe, 64);
      const bermMat = new THREE.MeshStandardMaterial({
        color: t.bermColor,
        roughness: 0.94,
        side: THREE.DoubleSide,
      });
      const bermMesh = new THREE.Mesh(bermGeo, bermMat);
      bermMesh.rotation.x = -Math.PI / 2;
      bermMesh.position.y = t.yBottom;
      bermMesh.receiveShadow = true;
      pitGroup.add(bermMesh);
    }
  });

  // Pit Floor (Дно карьера)
  const floorGeo = new THREE.CircleGeometry(14, 64);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x261d17,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -12;
  floorMesh.receiveShadow = true;
  pitGroup.add(floorMesh);

  // Sump Pool (Водоотливной зумпф) - reflective turquoise mine drainage water
  const sumpGeo = new THREE.CircleGeometry(7, 32);
  const sumpMat = new THREE.MeshStandardMaterial({
    color: 0x0e7490,
    roughness: 0.2,
    metalness: 0.8,
    side: THREE.DoubleSide,
  });
  const sumpMesh = new THREE.Mesh(sumpGeo, sumpMat);
  sumpMesh.rotation.x = -Math.PI / 2;
  sumpMesh.position.y = -11.85;
  pitGroup.add(sumpMesh);

  scene.add(pitGroup);
}

// Generate smooth 3D road ribbon along a CatmullRomCurve3
function createRoadRibbon(curve, width = 6.4, yOffset = 0.22, segments = 140) {
  const points = curve.getSpacedPoints(segments);
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const p = points[i];
    const t = Math.min(0.999, Math.max(0.001, i / segments));
    const tangent = curve.getTangentAt(t).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();

    const left = new THREE.Vector3().copy(p).addScaledVector(normal, width / 2);
    const right = new THREE.Vector3().copy(p).addScaledVector(normal, -width / 2);

    left.y += yOffset;
    right.y += yOffset;

    positions.push(left.x, left.y, left.z);
    positions.push(right.x, right.y, right.z);

    const v = i / segments;
    uvs.push(0, v, 1, v);

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildRoads() {
  // 1. Mathematically authentic Spiral Haul Ramp hugging the eastern crater wall:
  // Ascends from Bench +220m (Y=3) near EX-02, wraps around the east perimeter past EX-01 (+280m, Y=19) to Crusher (+350m, Y=35)
  const ptsEX2 = [];
  const steps = 18;
  const startTheta = 2.4; // Near EX-02 (-28, 3, 30)
  const endTheta = -1.0;  // Near Crusher (82, 35, -128)
  const startR = 41.0;
  const endR = 152.0;
  const startY = 3.0;
  const endY = 35.0;

  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const y = startY + (endY - startY) * u;
    const r = startR + (endR - startR) * u;
    const theta = startTheta + (endTheta - startTheta) * u;
    ptsEX2.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
  }
  routeEX2 = new THREE.CatmullRomCurve3(ptsEX2);

  // 2. Route EX-01 (Bench +280m at Y=19) to Crusher (shares the upper half of the spiral)
  const ptsEX1 = [];
  const midIndex = Math.floor(steps * 0.5);
  for (let i = midIndex; i <= steps; i++) {
    ptsEX1.push(ptsEX2[i].clone());
  }
  routeEX1 = new THREE.CatmullRomCurve3(ptsEX1);

  // 3. Route EX-03 to Waste Dump (Waste overburden haulage on +320m to surface)
  const ptsEX3 = [
    LOCATIONS.ex3.clone(),
    new THREE.Vector3(-105, 31, -98),
    new THREE.Vector3(-118, 34, -110),
    LOCATIONS.waste_dump.clone(),
  ];
  routeEX3 = new THREE.CatmullRomCurve3(ptsEX3);

  // 4. Detour bypass road around collapsed ramp section (+1.4 km detour along west/north wall)
  const ptsDetour = [];
  const dSteps = 16;
  const dStartTheta = 2.4;
  const dEndTheta = 5.28; // Winds counter-clockwise along west & north wall to crusher
  for (let i = 0; i <= dSteps; i++) {
    const u = i / dSteps;
    const y = startY + (endY - startY) * u;
    const r = startR + (endR - startR) * u;
    const theta = dStartTheta + (dEndTheta - dStartTheta) * u;
    ptsDetour.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
  }
  routeDetour = new THREE.CatmullRomCurve3(ptsDetour);

  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x3d362e, // Compacted quarry gravel haul road
    roughness: 0.95,
    side: THREE.DoubleSide,
  });

  // Main Ramp Road Mesh
  const roadGeo2 = createRoadRibbon(routeEX2, 6.4, 0.22, 140);
  const roadMesh2 = new THREE.Mesh(roadGeo2, roadMat);
  roadMesh2.receiveShadow = true;
  scene.add(roadMesh2);

  // EX-03 Overburden Road Mesh
  const roadGeo3 = createRoadRibbon(routeEX3, 6.4, 0.22, 50);
  const roadMesh3 = new THREE.Mesh(roadGeo3, roadMat);
  roadMesh3.receiveShadow = true;
  scene.add(roadMesh3);

  // Detour Bypass Road Mesh
  const detourMat = new THREE.MeshStandardMaterial({
    color: 0x473e34,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const detourGeo = createRoadRibbon(routeDetour, 5.8, 0.2, 120);
  const detourMesh = new THREE.Mesh(detourGeo, detourMat);
  detourMesh.receiveShadow = true;
  scene.add(detourMesh);

  // Rockslide hazard cluster on ramp +240m (at index 6 of spiral ramp)
  const slidePos = ptsEX2[6].clone();
  rockslideGroup = new THREE.Group();
  rockslideGroup.position.copy(slidePos);
  const boulderMat = new THREE.MeshStandardMaterial({ color: 0x58483b, roughness: 0.92, flatShading: true });
  for (let b = 0; b < 10; b++) {
    const r = 1.0 + Math.random() * 1.6;
    const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), boulderMat);
    boulder.position.set((Math.random() - 0.5) * 6, r * 0.5, (Math.random() - 0.5) * 5);
    boulder.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    boulder.castShadow = true;
    rockslideGroup.add(boulder);
  }
  // Warning cones
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 });
  for (let c = -3; c <= 3; c += 2) {
    const barrier = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 8), coneMat);
    barrier.position.set(c, 0.75, 3.5);
    rockslideGroup.add(barrier);
  }
  rockslideGroup.visible = false;
  scene.add(rockslideGroup);
}

function buildInfrastructure() {
  // 1. Primary Gyratory Crusher (Корпус крупного дробления) at LOCATIONS.crusher (82, 35, -128)
  // Situated on the north-east surface rim (+350m) overlooking the open pit
  const crusherGroup = new THREE.Group();
  crusherGroup.position.copy(LOCATIONS.crusher);

  // Foundation & lower heavy concrete vault
  const concMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 18), concMat);
  base.position.y = 4;
  base.castShadow = true;
  base.receiveShadow = true;
  crusherGroup.add(base);

  // Industrial steel crusher house (dark industrial slate with yellow framing)
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.45 });
  const house = new THREE.Mesh(new THREE.BoxGeometry(16, 11, 14), steelMat);
  house.position.y = 13.5;
  house.castShadow = true;
  crusherGroup.add(house);

  // Truck tipping pocket / dump hopper facing the incoming ramp
  const hopperMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.3, roughness: 0.5 });
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 3.2, 6, 16), hopperMat);
  hopper.position.set(-6, 9, 2);
  crusherGroup.add(hopper);

  // Safety guide curbs for dumping haul trucks
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 });
  const curbL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 8), curbMat);
  curbL.position.set(-9.5, 8.5, 2);
  const curbR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 8), curbMat);
  curbR.position.set(-2.5, 8.5, 2);
  crusherGroup.add(curbL);
  crusherGroup.add(curbR);

  // Overhead primary conveyor truss to surge stockpile
  const conveyorMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.6, roughness: 0.35 });
  const conveyor = new THREE.Mesh(new THREE.BoxGeometry(45, 2.6, 2.6), conveyorMat);
  conveyor.position.set(22, 14, -5);
  conveyor.rotation.z = -0.16;
  conveyor.rotation.y = -0.24;
  conveyor.castShadow = true;
  crusherGroup.add(conveyor);

  scene.add(crusherGroup);

  // 2. Surge Stockpile at LOCATIONS.stockpile (124, 35, -138)
  const stockpileMat = new THREE.MeshStandardMaterial({ color: 0x6e5844, roughness: 0.95, flatShading: true });
  const stockpile = new THREE.Mesh(new THREE.ConeGeometry(22, 18, 28), stockpileMat);
  stockpile.position.set(LOCATIONS.stockpile.x, LOCATIONS.stockpile.y + 9, LOCATIONS.stockpile.z);
  stockpile.castShadow = true;
  stockpile.receiveShadow = true;
  scene.add(stockpile);

  // 3. Terraced Waste Dump at LOCATIONS.waste_dump (-125, 35, -120)
  const wasteDumpGroup = new THREE.Group();
  wasteDumpGroup.position.copy(LOCATIONS.waste_dump);

  const wasteMatTier1 = new THREE.MeshStandardMaterial({ color: 0x584c40, roughness: 0.95, flatShading: true });
  const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(44, 56, 10, 32), wasteMatTier1);
  tier1.position.y = 5;
  tier1.castShadow = true;
  tier1.receiveShadow = true;
  wasteDumpGroup.add(tier1);

  const wasteMatTier2 = new THREE.MeshStandardMaterial({ color: 0x4c4136, roughness: 0.95, flatShading: true });
  const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(28, 38, 9, 28), wasteMatTier2);
  tier2.position.y = 14.5;
  tier2.castShadow = true;
  tier2.receiveShadow = true;
  wasteDumpGroup.add(tier2);

  scene.add(wasteDumpGroup);

  // 4. Slope Stability Radar (SSR) at LOCATIONS.radar (0, 35, -155)
  const radarGroup = new THREE.Group();
  radarGroup.position.copy(LOCATIONS.radar);

  const radarBase = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 3.0, 7, 6), concMat);
  radarBase.position.y = 3.5;
  radarGroup.add(radarBase);

  const dishMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.4, roughness: 0.4 });
  const dish = new THREE.Mesh(new THREE.SphereGeometry(3.6, 16, 16, 0, Math.PI), dishMat);
  dish.rotation.x = Math.PI / 2;
  dish.position.y = 7.5;
  radarGroup.add(dish);

  // Radar Scan Beam Fan overlooking the active quarry crater
  const beamGeo = new THREE.ConeGeometry(65, 150, 20, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.15,
    wireframe: true,
    side: THREE.DoubleSide,
  });
  radarBeamMesh = new THREE.Mesh(beamGeo, beamMat);
  radarBeamMesh.rotation.x = -Math.PI / 2.15;
  radarBeamMesh.position.set(0, 7.5, 75);
  radarGroup.add(radarBeamMesh);

  scene.add(radarGroup);
}

// Authentic Mining Electric Rope Shovel Model (Bucyrus / CAT 7495 class)
function createShovelMesh(name, houseColor) {
  const shovel = new THREE.Group();

  // Crawler lower works (гусеничная тележка)
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.2 });
  const trackL = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 11), trackMat);
  trackL.position.set(-3.2, 1.1, 0);
  trackL.castShadow = true;
  trackL.receiveShadow = true;
  shovel.add(trackL);

  const trackR = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 11), trackMat);
  trackR.position.set(3.2, 1.1, 0);
  trackR.castShadow = true;
  trackR.receiveShadow = true;
  shovel.add(trackR);

  // Center turntable
  const turn = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 1.0, 16), trackMat);
  turn.position.y = 2.2;
  shovel.add(turn);

  // Upper revolving machinery house (кузов экскаватора)
  const houseMat = new THREE.MeshStandardMaterial({ color: houseColor, metalness: 0.3, roughness: 0.5 });
  const house = new THREE.Mesh(new THREE.BoxGeometry(8, 5.2, 9), houseMat);
  house.position.set(0, 5.2, -1.0);
  house.castShadow = true;
  house.receiveShadow = true;
  shovel.add(house);

  // Heavy counterweight at rear
  const cwMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
  const cw = new THREE.Mesh(new THREE.BoxGeometry(7.8, 4.5, 2.5), cwMat);
  cw.position.set(0, 5.0, -5.2);
  cw.castShadow = true;
  shovel.add(cw);

  // Elevated operator cab with tinted glass
  const cabGlassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.8, roughness: 0.2 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.8), cabGlassMat);
  cab.position.set(3.0, 6.2, 2.4);
  cab.castShadow = true;
  shovel.add(cab);

  // Lattice Boom (стрела) pitched forward toward the rock face
  const boomMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45 });
  const boomL = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 14, 8), boomMat);
  boomL.rotation.x = -Math.PI / 4.2;
  boomL.position.set(-1.8, 8.2, 5.2);
  boomL.castShadow = true;
  shovel.add(boomL);

  const boomR = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 14, 8), boomMat);
  boomR.rotation.x = -Math.PI / 4.2;
  boomR.position.set(1.8, 8.2, 5.2);
  boomR.castShadow = true;
  shovel.add(boomR);

  // Dipper handle & shovel bucket (рукоять и ковш с зубьями)
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.5, roughness: 0.4 });
  const stick = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 9), stickMat);
  stick.position.set(0, 6.2, 6.8);
  stick.rotation.x = 0.15;
  shovel.add(stick);

  // Heavy dipper bucket (ковш) scooping into the rock face
  const bucketMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.35 });
  const bucket = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.2, 3.4), bucketMat);
  bucket.position.set(0, 5.2, 11.2);
  bucket.castShadow = true;
  shovel.add(bucket);

  return shovel;
}

// Authentic CAT 793F 227-Tonne Haul Truck Model
function createTruckMesh() {
  const truck = new THREE.Group();

  // Heavy duty ladder frame chassis
  const chassisMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 });
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.3, 9.2), chassisMat);
  chassis.position.y = 2.0;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  truck.add(chassis);

  // Front radiator grille & access stairs
  const grilleMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 });
  const grille = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.2, 0.8), grilleMat);
  grille.position.set(0, 2.8, 4.4);
  truck.add(grille);

  // Offset CAT Operator Cab on left side
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.9, 2.3), cabMat);
  cab.position.set(-1.1, 3.8, 2.6);
  cab.castShadow = true;
  truck.add(cab);

  // Cab glass windows
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.8, roughness: 0.2 });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.2), glassMat);
  glass.position.set(-1.1, 4.2, 3.2);
  truck.add(glass);

  // Heavy Rock Dump Body (Кузов) with forward canopy over cab
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.4, 6.8), boxMat);
  box.position.set(0, 3.6, -0.8);
  box.castShadow = true;
  box.receiveShadow = true;
  truck.add(box);

  // Rock Canopy (защитный козырек над кабиной)
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.6, 2.8), boxMat);
  canopy.position.set(0, 4.9, 2.6);
  canopy.rotation.x = -0.15;
  canopy.castShadow = true;
  truck.add(canopy);

  // Dynamic Ore in Dump Box (heaped rock pile)
  const oreMat = new THREE.MeshStandardMaterial({ color: 0x3d7068, roughness: 0.9, flatShading: true });
  const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(2.4, 1), oreMat);
  ore.scale.set(1.5, 0.8, 1.8);
  ore.position.set(0, 4.4, -0.8);
  ore.name = "oreLoad";
  truck.add(ore);

  // 6 Massive Haul Tires (CAT 40.00R57) with detailed yellow hubs
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 });
  const tireGeo = new THREE.CylinderGeometry(1.4, 1.4, 0.95, 16);
  tireGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.0, 12);
  hubGeo.rotateZ(Math.PI / 2);

  const wheelPositions = [
    [-2.3, 1.4, 2.8], [2.3, 1.4, 2.8],   // Front steer
    [-2.3, 1.4, -1.8], [2.3, 1.4, -1.8], // Rear outer
    [-2.3, 1.4, -3.2], [2.3, 1.4, -3.2], // Rear inner
  ];

  wheelPositions.forEach(pos => {
    const w = new THREE.Mesh(tireGeo, tireMat);
    w.position.set(...pos);
    w.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    w.add(hub);
    truck.add(w);
  });

  return truck;
}

function buildEquipment() {
  // Excavators on Benches (oriented facing into the rock face)
  shovelMeshes["excavator-01"] = createShovelMesh("EX-01", 0x0284c7); // High-grade bench +280m
  shovelMeshes["excavator-01"].position.copy(LOCATIONS.ex1);
  shovelMeshes["excavator-01"].rotation.y = Math.PI * 0.8; // Digging into south-east wall
  scene.add(shovelMeshes["excavator-01"]);

  shovelMeshes["excavator-02"] = createShovelMesh("EX-02", 0xb91c1c); // ROM bench +220m
  shovelMeshes["excavator-02"].position.copy(LOCATIONS.ex2);
  shovelMeshes["excavator-02"].rotation.y = -Math.PI * 0.4; // Digging into south-west wall
  scene.add(shovelMeshes["excavator-02"]);

  shovelMeshes["excavator-03"] = createShovelMesh("EX-03", 0x475569); // Waste bench +320m
  shovelMeshes["excavator-03"].position.copy(LOCATIONS.ex3);
  shovelMeshes["excavator-03"].rotation.y = -Math.PI * 0.7; // Digging into north-west wall
  scene.add(shovelMeshes["excavator-03"]);

  // 5 Haul Trucks
  for (let i = 1; i <= 5; i++) {
    const id = `truck-0${i}`;
    const mesh = createTruckMesh();
    mesh.name = id;
    truckMeshes[id] = mesh;
    scene.add(mesh);
  }
}

// Fetch live telemetry from Python simulator
async function fetchState() {
  try {
    const res = await fetch("/api/state");
    if (!res.ok) return;
    const data = await res.json();
    updateUI(data);
    update3D(data);
  } catch (err) {
    // Simulator starting or offline
  }
}

function updateUI(data) {
  const twins = data.twins || {};
  const whatif = data.whatif || {};

  // Update sim time
  if (data.sim_time_min !== undefined) {
    document.getElementById("sim-time").innerText = `${data.sim_time_min.toFixed(1)} мин`;
  }

  // Update Crusher & Quality Blending
  const crusher = twins["crusher-01"] || {};
  if (crusher.feed_grade) {
    const grade = crusher.feed_grade.value;
    const el = document.getElementById("val-feed-grade");
    el.innerText = `${grade.toFixed(3)} %`;

    if (grade >= 0.44 && grade <= 0.52) {
      el.style.color = "#38bdf8";
    } else {
      el.style.color = "#f87171";
    }

    const pct = Math.max(0, Math.min(100, ((grade - 0.20) / (0.70 - 0.20)) * 100));
    document.getElementById("grade-bar").style.width = `${pct}%`;
  }

  if (crusher.throughput) {
    document.getElementById("val-crusher-tph").innerText = `${Math.round(crusher.throughput.value)} т/ч`;
  }

  const mine = twins["mine-01"] || {};
  if (mine.tonnes_mined) {
    document.getElementById("val-tonnes-mined").innerText = `${Math.round(mine.tonnes_mined.value).toLocaleString()} т`;
  }

  // Fleet Fuel Rate
  let totalFuelRate = 0;
  if (mine.fuel_rate && mine.fuel_rate.value !== undefined) {
    totalFuelRate = mine.fuel_rate.value;
  } else {
    for (let i = 1; i <= 5; i++) {
      const t = twins[`truck-0${i}`];
      if (t && t.fuel_rate && t.fuel_rate.value !== undefined) {
        totalFuelRate += t.fuel_rate.value;
      }
    }
  }
  const fuelRateEl = document.getElementById("val-fuel-rate");
  if (fuelRateEl) {
    fuelRateEl.innerText = `${Math.round(totalFuelRate)} л/ч`;
  }

  // Radar status
  const radar = twins["slope-radar-01"] || {};
  if (radar.status) {
    const dispVal = radar.displacement_rate_mm_day || radar.displacement_rate_mm;
    const disp = dispVal ? `${dispVal.value.toFixed(2)} мм/сут` : "0.20 мм/сут";
    document.getElementById("val-radar-status").innerText = `${radar.status.value.toUpperCase()} (${disp})`;
  }

  // What-If Button States
  document.getElementById("btn-ex1").classList.toggle("active", !!whatif.ex1_failure);
  document.getElementById("btn-road").classList.toggle("active", !!whatif.road_blocked);
  document.getElementById("btn-dilution").classList.toggle("active", !!whatif.dilution);

  // Trucks list rendering
  const list = document.getElementById("truck-list");
  list.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const id = `truck-0${i}`;
    const t = twins[id] || {};
    const state = t.state ? t.state.value : "idle";
    const payload = t.payload ? t.payload.value : 0;
    const speed = t.speed ? t.speed.value : 0;
    const grade = t.grade_in_box ? t.grade_in_box.value : 0;

    const item = document.createElement("div");
    item.className = "truck-item";
    item.onclick = () => setCameraView(id);
    item.innerHTML = `
      <div>
        <strong style="color: #f8fafc;">${id.toUpperCase()}</strong>
        <span style="color: #94a3b8; font-size: 11px; margin-left: 6px;">${payload} т (${grade.toFixed(2)}% Cu)</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: #cbd5e1; font-size: 11px;">${speed} км/ч</span>
        <span class="truck-state-badge state-${state}">${state}</span>
      </div>
    `;
    list.appendChild(item);
  }
}

function update3D(data) {
  const twins = data.twins || {};
  const whatif = data.whatif || {};

  // Check which shovel is failing
  if (shovelMeshes["excavator-01"]) {
    const house = shovelMeshes["excavator-01"].children[3];
    if (house && house.material) {
      if (whatif.ex1_failure) {
        house.material.color.setHex(0xef4444);
      } else {
        house.material.color.setHex(0x0284c7);
      }
    }
  }

  // Shovel EX-02 dilution indicator
  if (shovelMeshes["excavator-02"]) {
    const house = shovelMeshes["excavator-02"].children[3];
    if (house && house.material) {
      if (whatif.dilution) {
        house.material.color.setHex(0xd97706);
      } else {
        house.material.color.setHex(0xb91c1c);
      }
    }
  }

  // Road Blockage Scenario: toggle rockslide cluster and radar alert beam
  if (rockslideGroup) {
    rockslideGroup.visible = !!whatif.road_blocked;
  }
  if (radarBeamMesh) {
    if (whatif.road_blocked) {
      radarBeamMesh.material.color.setHex(0xef4444);
    } else {
      radarBeamMesh.material.color.setHex(0x10b981);
    }
  }

  // Update truck positions along curves
  for (let i = 1; i <= 5; i++) {
    const id = `truck-0${i}`;
    const t = twins[id];
    const mesh = truckMeshes[id];
    if (!t || !mesh) continue;

    const state = t.state ? t.state.value : "hauling";
    const progress = (t.route_progress_pct ? t.route_progress_pct.value : 0) / 100.0;
    const payload = t.payload ? t.payload.value : 0;
    const grade = t.grade_in_box ? t.grade_in_box.value : 0.40;

    // Show/hide ore in bed based on payload
    const ore = mesh.getObjectByName("oreLoad");
    if (ore) {
      ore.visible = payload > 10;
      if (grade > 0.50) {
        ore.material.color.setHex(0x10b981); // High-grade malachite green
      } else if (grade > 0.20) {
        ore.material.color.setHex(0xd97706); // ROM bronze porphyry
      } else {
        ore.material.color.setHex(0x64748b); // Waste rock
      }
    }

    // Determine route curve
    let curve = routeEX2;
    if (i === 1 || i === 2) curve = whatif.ex1_failure ? routeDetour : routeEX1;
    else if (i === 5) curve = routeEX3;
    else if (whatif.road_blocked) curve = routeDetour;

    let tNorm = Math.max(0.001, Math.min(0.999, progress));
    const isReturning = (state === "returning");
    if (isReturning) {
      tNorm = 1.0 - tNorm;
    }

    const pos = curve.getPointAt(tNorm);
    const tangent = curve.getTangentAt(tNorm).normalize();

    mesh.position.copy(pos);
    mesh.position.y += 0.25; // Tires seated firmly on road surface

    // Ensure truck faces motion direction with vertical UP (0, 1, 0) constraint to eliminate roll
    if (isReturning) {
      tangent.negate();
    }
    const lookTarget = mesh.position.clone().add(tangent);
    mesh.lookAt(lookTarget);
  }
}

// What-If scenario triggers
async function toggleWhatIf(scenario) {
  try {
    const res = await fetch(`/api/whatif/${scenario}`);
    const data = await res.json();
    logEvent(data.message || `Сценарий ${scenario} переключен`, "alert");
    fetchState();
  } catch (err) {
    console.error(err);
  }
}

async function resetWhatIf() {
  try {
    const res = await fetch(`/api/whatif/reset`);
    const data = await res.json();
    logEvent(data.message || "Сценарии сброшены в штатный режим", "success");
    fetchState();
  } catch (err) {
    console.error(err);
  }
}

function logEvent(text, type = "normal") {
  const box = document.getElementById("dispatch-log");
  if (!box) return;
  const time = new Date().toLocaleTimeString("ru-RU", { hour12: false });
  const item = document.createElement("div");
  item.className = `log-item ${type}`;
  item.innerText = `[${time}] ${text}`;
  box.prepend(item);
}

// Camera Presets
function setCameraView(mode) {
  currentCameraMode = mode;
  document.querySelectorAll(".cam-btn").forEach(b => b.classList.remove("active"));

  if (mode === "orbit") {
    camera.position.set(-50, 155, 235);
    controls.target.set(10, 8, -15);
    const b = document.querySelector(".cam-btn:nth-child(1)");
    if (b) b.classList.add("active");
  } else if (mode === "crusher") {
    // Elevated 3/4 view of the crusher dump bay and incoming trucks
    camera.position.set(45, 52, -100);
    controls.target.set(82, 38, -128);
    const b = document.querySelector(".cam-btn:nth-child(2)");
    if (b) b.classList.add("active");
  } else if (mode === "ex1") {
    // Working face view of Shovel EX-01 scooping high-grade copper
    camera.position.set(42, 30, 95);
    controls.target.set(72, 21, 65);
    const b = document.querySelector(".cam-btn:nth-child(3)");
    if (b) b.classList.add("active");
  } else if (mode === "ex2") {
    // Working face view of Shovel EX-02 on bench +220m
    camera.position.set(-6, 16, 54);
    controls.target.set(-28, 5, 30);
    const b = document.querySelector(".cam-btn:nth-child(4)");
    if (b) b.classList.add("active");
  } else if (mode.startsWith("truck")) {
    const mesh = truckMeshes[mode];
    if (mesh) {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      const backward = forward.clone().negate().setY(0).normalize();
      camera.position.copy(mesh.position).addScaledVector(backward, 22).add(new THREE.Vector3(0, 9.5, 0));
      controls.target.copy(mesh.position);
    }
    const b = document.querySelector(".cam-btn:nth-child(5)");
    if (b) b.classList.add("active");
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);

  // Oscillate SSR Radar beam
  if (radarBeamMesh) {
    radarBeamMesh.rotation.y = Math.sin(Date.now() * 0.0014) * 0.42;
  }

  // Smooth real-time chase camera update if following a truck
  if (currentCameraMode.startsWith("truck")) {
    const mesh = truckMeshes[currentCameraMode];
    if (mesh) {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      const backward = forward.clone().negate().setY(0).normalize();
      const idealCam = mesh.position.clone().addScaledVector(backward, 22).add(new THREE.Vector3(0, 9.5, 0));
      camera.position.lerp(idealCam, 0.08);
      controls.target.lerp(mesh.position, 0.08);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener("DOMContentLoaded", init);
