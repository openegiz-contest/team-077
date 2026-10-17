/**
 * Aktogay Open-Pit Mine 3D Digital Twin Visualizer
 * Team AURA (team-077) for OpenEgiz Contest
 *
 * Full 60 FPS kinematics, industrial-grade CAT 793F & CAT 7495 3D equipment models,
 * tire dust particle effects, Kazakh steppe daylight atmosphere, and zero clipping.
 */

let scene, camera, renderer, controls;
let truckMeshes = {};
let shovelMeshes = {};
let truckKinematics = {};
let pitMesh, rampLine, detourLine;
let radarBeamMesh, rockslideGroup;
let activeCamTarget = null;
let currentCameraMode = "orbit";
let lastTimestamp = 0;

// Coordinates for key pit locations
// Ground surface plateau is at elevation Y = 35 (+350m horizon)
// Quarry crater descends down to Y = -12 (+150m horizon pit floor)
// Waste dump tipping pad elevated to Y = 42 for realistic spoil plateau
const LOCATIONS = {
  crusher: new THREE.Vector3(82, 35, -128),
  stockpile: new THREE.Vector3(124, 35, -138),
  waste_dump: new THREE.Vector3(-125, 42.0, -120), // Flat elevated tipping platform
  ex1: new THREE.Vector3(72, 19, 65),              // Bench +280m High-grade Cu (0.64%)
  ex2: new THREE.Vector3(-28, 3, 30),              // Bench +220m ROM Porphyry Cu (0.40%)
  ex3: new THREE.Vector3(-85, 28, -85),            // Bench +320m Waste Overburden
  radar: new THREE.Vector3(0, 35, -155),           // North rim Slope Stability Radar (SSR)
};

// Spline Curves for Haul Routes
let routeEX1, routeEX2, routeEX3, routeDetour;

// Tire Dust Particle System
const DUST_COUNT = 240;
let dustGeo, dustMat, dustPoints;
const dustParticles = [];
const dustPositions = new Float32Array(DUST_COUNT * 3);

function init() {
  const canvas = document.getElementById("viewport");
  scene = new THREE.Scene();

  // Kazakh steppe daylight: crisp blue high-altitude sky with soft atmospheric horizon haze
  const skyColor = new THREE.Color(0x8bc4f5);
  scene.background = skyColor;
  scene.fog = new THREE.FogExp2(0x9fc2e6, 0.00048);

  camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 1, 3500);
  camera.position.set(-60, 160, 240);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2.05; // Prevent camera clipping underground
  controls.minDistance = 15;
  controls.maxDistance = 950;
  controls.target.set(10, 8, -15);

  setupLighting();
  buildTerrainAndPit();
  buildRoads();
  buildInfrastructure();
  buildEquipment();
  initDustSystem();

  // Position trucks on frame 0
  for (let i = 1; i <= 5; i++) {
    const id = `truck-0${i}`;
    const tk = truckKinematics[id];
    const mesh = truckMeshes[id];
    if (tk && mesh && tk.curve) {
      const pos = tk.curve.getPointAt(tk.renderProgress);
      const tangent = tk.curve.getTangentAt(tk.renderProgress).normalize();
      mesh.position.copy(pos);
      mesh.position.y += 0.35;
      mesh.lookAt(mesh.position.clone().add(tangent));
    }
  }

  // Handle URL camera view parameter if supplied (e.g. ?cam=crusher, ?cam=ex1, etc.)
  const urlParams = new URLSearchParams(window.location.search);
  const camParam = urlParams.get("cam");
  if (camParam) {
    setCameraView(camParam);
  }

  window.addEventListener("resize", onWindowResize);
  requestAnimationFrame(animate);

  // Start polling simulation state from REST API
  fetchState();
  setInterval(fetchState, 600);
}

function setupLighting() {
  // Ambient fill light for realistic soft ambient illumination
  const ambientLight = new THREE.AmbientLight(0xd9e5f2, 0.42);
  scene.add(ambientLight);

  // Directional sun light casting soft natural shadows across pit benches
  const sunLight = new THREE.DirectionalLight(0xfff7e8, 1.45);
  sunLight.position.set(200, 280, 150);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 20;
  sunLight.shadow.camera.far = 950;
  sunLight.shadow.camera.left = -340;
  sunLight.shadow.camera.right = 340;
  sunLight.shadow.camera.top = 340;
  sunLight.shadow.camera.bottom = -340;
  sunLight.shadow.bias = -0.00025;
  scene.add(sunLight);

  // Sky hemisphere bounce light (rich sky-blue from zenith, warm desert soil bounce from nadir)
  const hemiLight = new THREE.HemisphereLight(0x8bc0f8, 0x6e5d48, 0.58);
  scene.add(hemiLight);
}

function buildTerrainAndPit() {
  const pitGroup = new THREE.Group();

  // 1. Expansive Steppe Plateau Landscape extending to R = 2200 (seamlessly fading into horizon fog)
  const rimRadius = 152;
  const outerRadius = 2200;
  const terrainGeo = new THREE.RingGeometry(rimRadius, outerRadius, 72, 6);
  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x766a59, // Kazakh steppe arid earth
    roughness: 0.94,
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
  const ridgeGeo = new THREE.TorusGeometry(rimRadius + 2.6, 2.6, 8, 72);
  const ridgeMat = new THREE.MeshStandardMaterial({
    color: 0x635646,
    roughness: 0.96,
    flatShading: true,
  });
  const ridge = new THREE.Mesh(ridgeGeo, ridgeMat);
  ridge.rotation.x = Math.PI / 2;
  ridge.position.y = 36.3;
  ridge.castShadow = true;
  ridge.receiveShadow = true;
  pitGroup.add(ridge);

  // 2. Open-Pit Stepped Benches (Каскад уступов карьера)
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
    const faceGeo = new THREE.CylinderGeometry(t.rTop, t.rToe, height, 72, 1, true);
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
      const bermGeo = new THREE.RingGeometry(t.rBermIn, t.rToe, 72);
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

// Generate smooth 3D road ribbon along a CatmullRomCurve3 with zero Z-fighting
function createRoadRibbon(curve, width = 6.6, yOffset = 0.35, segments = 160) {
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
  const steps = 20;
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

  // 3. Route EX-03 to Waste Dump: smoothly ascends from Bench +320m (Y=28) up onto the flat tipping pad at Y=42
  const ptsEX3 = [
    LOCATIONS.ex3.clone(),
    new THREE.Vector3(-104, 32, -96),
    new THREE.Vector3(-114, 36.5, -106),
    new THREE.Vector3(-120, 40.5, -114),
    LOCATIONS.waste_dump.clone(),
  ];
  routeEX3 = new THREE.CatmullRomCurve3(ptsEX3);

  // 4. Detour bypass road around collapsed ramp section (+1.4 km detour along west/north wall)
  const ptsDetour = [];
  const dSteps = 18;
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

  // Road materials with polygonOffset to completely prevent Z-fighting against terrain
  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x3d362e, // Compacted quarry gravel haul road
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -1.0,
    polygonOffsetUnits: -1.0,
    side: THREE.DoubleSide,
  });

  // Main Ramp Road Mesh
  const roadGeo2 = createRoadRibbon(routeEX2, 6.6, 0.35, 160);
  const roadMesh2 = new THREE.Mesh(roadGeo2, roadMat);
  roadMesh2.receiveShadow = true;
  scene.add(roadMesh2);

  // EX-03 Overburden Road Mesh
  const roadGeo3 = createRoadRibbon(routeEX3, 6.6, 0.35, 60);
  const roadMesh3 = new THREE.Mesh(roadGeo3, roadMat);
  roadMesh3.receiveShadow = true;
  scene.add(roadMesh3);

  // Detour Bypass Road Mesh
  const detourMat = new THREE.MeshStandardMaterial({
    color: 0x483e34,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -1.0,
    polygonOffsetUnits: -1.0,
    side: THREE.DoubleSide,
  });
  const detourGeo = createRoadRibbon(routeDetour, 6.0, 0.32, 140);
  const detourMesh = new THREE.Mesh(detourGeo, detourMat);
  detourMesh.receiveShadow = true;
  scene.add(detourMesh);

  // Rockslide hazard cluster on ramp +240m (at index 7 of spiral ramp)
  const slidePos = ptsEX2[7].clone();
  rockslideGroup = new THREE.Group();
  rockslideGroup.position.copy(slidePos);
  const boulderMat = new THREE.MeshStandardMaterial({ color: 0x58483b, roughness: 0.92, flatShading: true });
  for (let b = 0; b < 12; b++) {
    const r = 1.0 + Math.random() * 1.8;
    const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), boulderMat);
    boulder.position.set((Math.random() - 0.5) * 6.5, r * 0.5 + 0.3, (Math.random() - 0.5) * 5.5);
    boulder.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    boulder.castShadow = true;
    rockslideGroup.add(boulder);
  }
  // Warning cones with reflective band
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 });
  for (let c = -3.5; c <= 3.5; c += 1.8) {
    const barrier = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 8), coneMat);
    barrier.position.set(c, 0.85, 3.5);
    rockslideGroup.add(barrier);
  }
  rockslideGroup.visible = false;
  scene.add(rockslideGroup);
}

function buildInfrastructure() {
  // 1. Primary Gyratory Crusher & Surge Stockpile Complex at LOCATIONS.crusher (82, 35, -128)
  const crusherGroup = new THREE.Group();
  crusherGroup.position.copy(LOCATIONS.crusher);

  // Heavy reinforced concrete foundation vault & dumping ramp abutment
  const concMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.88 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(22, 10, 20), concMat);
  base.position.y = 5.0;
  base.castShadow = true;
  base.receiveShadow = true;
  crusherGroup.add(base);

  // Industrial steel crusher house (dark industrial slate with yellow framing)
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.45 });
  const house = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 14), steelMat);
  house.position.y = 15.0;
  house.castShadow = true;
  crusherGroup.add(house);

  // Roof maintenance gantry crane structure
  const gantryMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.4, roughness: 0.4 });
  const craneBeam = new THREE.Mesh(new THREE.BoxGeometry(18, 1.0, 1.2), gantryMat);
  craneBeam.position.set(0, 21.5, 0);
  crusherGroup.add(craneBeam);

  // Operator control cabin with panoramic observation windows overlooking dump bay
  const cabGlassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.8, roughness: 0.2 });
  const controlCab = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.2, 3.6), cabGlassMat);
  controlCab.position.set(-6.5, 17.5, 5.0);
  crusherGroup.add(controlCab);

  // Truck tipping pocket / dump hopper facing the incoming ramp
  const hopperMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.35, roughness: 0.5 });
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 3.5, 6.5, 16), hopperMat);
  hopper.position.set(-6, 10.0, 2);
  crusherGroup.add(hopper);

  // Heavy yellow safety wheel stop curbs & bollards for dumping haul trucks
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35 });
  const curbL = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 8.5), curbMat);
  curbL.position.set(-9.8, 10.2, 2);
  const curbR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 8.5), curbMat);
  curbR.position.set(-2.2, 10.2, 2);
  crusherGroup.add(curbL);
  crusherGroup.add(curbR);

  // 3D Lattice Overland Conveyor Bridge spanning from crusher to stockpile
  // Starts at crusher discharge (16, 15, -4), ends at stockpile head (42, 18, -10)
  const conveyorGroup = new THREE.Group();
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.65, roughness: 0.35 });
  const convBelt = new THREE.Mesh(new THREE.BoxGeometry(44, 2.4, 2.8), trussMat);
  convBelt.position.set(22, 16.5, -6);
  convBelt.rotation.z = -0.15;
  convBelt.rotation.y = -0.22;
  convBelt.castShadow = true;
  conveyorGroup.add(convBelt);

  // Conveyor structural support bents (trestles anchored to ground)
  const bentMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.5, roughness: 0.4 });
  const bent1 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 14, 8), bentMat);
  bent1.position.set(18, 7.0, -4.5);
  bent1.castShadow = true;
  conveyorGroup.add(bent1);

  const bent2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 16, 8), bentMat);
  bent2.position.set(32, 8.0, -8.0);
  bent2.castShadow = true;
  conveyorGroup.add(bent2);

  crusherGroup.add(conveyorGroup);
  scene.add(crusherGroup);

  // 2. Surge Stockpile at LOCATIONS.stockpile (124, 35, -138)
  const stockpileMat = new THREE.MeshStandardMaterial({ color: 0x6e5844, roughness: 0.95, flatShading: true });
  const stockpile = new THREE.Mesh(new THREE.ConeGeometry(24, 18, 32), stockpileMat);
  stockpile.position.set(LOCATIONS.stockpile.x, LOCATIONS.stockpile.y + 9, LOCATIONS.stockpile.z);
  stockpile.castShadow = true;
  stockpile.receiveShadow = true;
  scene.add(stockpile);

  // 3. Terraced Waste Dump with flat, elevated tipping platform at LOCATIONS.waste_dump (-125, 42.0, -120)
  const wasteDumpGroup = new THREE.Group();
  wasteDumpGroup.position.set(LOCATIONS.waste_dump.x, 35, LOCATIONS.waste_dump.z);

  // Lower embankment tier (from Y=35 to Y=42)
  const wasteMat1 = new THREE.MeshStandardMaterial({ color: 0x584c40, roughness: 0.95, flatShading: true });
  const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(46, 62, 7, 36), wasteMat1);
  tier1.position.y = 3.5;
  tier1.castShadow = true;
  tier1.receiveShadow = true;
  wasteDumpGroup.add(tier1);

  // Flat top tipping platform (at Y=42, radius 46)
  const padGeo = new THREE.CircleGeometry(46, 36);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x4f4438, roughness: 0.95, side: THREE.DoubleSide });
  const padMesh = new THREE.Mesh(padGeo, padMat);
  padMesh.rotation.x = -Math.PI / 2;
  padMesh.position.y = 7.02; // world Y = 42.02
  padMesh.receiveShadow = true;
  wasteDumpGroup.add(padMesh);

  // Safety windrow / wheel-stop bund (предохранительный вал) along the northern active tipping crest
  const bundGeo = new THREE.TorusGeometry(43, 1.8, 8, 24, Math.PI * 0.7);
  const bundMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5 });
  const bundMesh = new THREE.Mesh(bundGeo, bundMat);
  bundMesh.rotation.x = Math.PI / 2;
  bundMesh.rotation.z = Math.PI * 0.15;
  bundMesh.position.set(0, 7.8, 0);
  bundMesh.castShadow = true;
  wasteDumpGroup.add(bundMesh);

  // Spotter cabin & solar lighting trailer on waste dump platform
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.8, 3.2), cabinMat);
  cabin.position.set(22, 8.4, 10);
  cabin.castShadow = true;
  wasteDumpGroup.add(cabin);

  // Lighting floodlight mast on dump platform
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.6 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 12, 8), mastMat);
  mast.position.set(22, 13.0, 10);
  mast.castShadow = true;
  wasteDumpGroup.add(mast);

  // Secondary Spoil Mound (further back, progressive waste development)
  const wasteMat2 = new THREE.MeshStandardMaterial({ color: 0x453b31, roughness: 0.95, flatShading: true });
  const tier2 = new THREE.Mesh(new THREE.ConeGeometry(28, 14, 28), wasteMat2);
  tier2.position.set(-20, 14.0, -18);
  tier2.castShadow = true;
  tier2.receiveShadow = true;
  wasteDumpGroup.add(tier2);

  scene.add(wasteDumpGroup);

  // 4. Slope Stability Radar (SSR) at LOCATIONS.radar (0, 35, -155)
  const radarGroup = new THREE.Group();
  radarGroup.position.copy(LOCATIONS.radar);

  const radarBase = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 3.2, 7, 8), concMat);
  radarBase.position.y = 3.5;
  radarBase.castShadow = true;
  radarGroup.add(radarBase);

  const dishMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.4, roughness: 0.4 });
  const dish = new THREE.Mesh(new THREE.SphereGeometry(3.8, 16, 16, 0, Math.PI), dishMat);
  dish.rotation.x = Math.PI / 2;
  dish.position.y = 7.8;
  dish.castShadow = true;
  radarGroup.add(dish);

  // Radar Scan Beam Fan overlooking the active quarry crater
  const beamGeo = new THREE.ConeGeometry(65, 150, 20, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.16,
    wireframe: true,
    side: THREE.DoubleSide,
  });
  radarBeamMesh = new THREE.Mesh(beamGeo, beamMat);
  radarBeamMesh.rotation.x = -Math.PI / 2.15;
  radarBeamMesh.position.set(0, 7.8, 75);
  radarGroup.add(radarBeamMesh);

  scene.add(radarGroup);
}

// Authentic CAT 7495 Electric Rope Shovel Model
function createShovelMesh(name, houseColor) {
  const shovel = new THREE.Group();

  // 1. Crawler lower works (гусеничная тележка)
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.25 });
  const trackL = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 12), trackMat);
  trackL.position.set(-3.4, 1.2, 0);
  trackL.castShadow = true;
  trackL.receiveShadow = true;
  shovel.add(trackL);

  const trackR = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 12), trackMat);
  trackR.position.set(3.4, 1.2, 0);
  trackR.castShadow = true;
  trackR.receiveShadow = true;
  shovel.add(trackR);

  // Drive tumblers and idler wheels
  const tumblerMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
  [-3.4, 3.4].forEach(x => {
    const fTumbler = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.7, 12), tumblerMat);
    fTumbler.rotation.z = Math.PI / 2;
    fTumbler.position.set(x, 1.2, 5.2);
    shovel.add(fTumbler);

    const rTumbler = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.7, 12), tumblerMat);
    rTumbler.rotation.z = Math.PI / 2;
    rTumbler.position.set(x, 1.2, -5.2);
    shovel.add(rTumbler);
  });

  // Center turntable bearing casting
  const turn = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.1, 18), trackMat);
  turn.position.y = 2.4;
  shovel.add(turn);

  // 2. Revolving Machinery House (Кузов экскаватора)
  const houseMat = new THREE.MeshStandardMaterial({ color: houseColor, metalness: 0.35, roughness: 0.45 });
  const house = new THREE.Mesh(new THREE.BoxGeometry(8.4, 5.5, 9.6), houseMat);
  house.name = "machineryHouse";
  house.position.set(0, 5.5, -1.0);
  house.castShadow = true;
  house.receiveShadow = true;
  shovel.add(house);

  // Roof filtration house monitor
  const roofVentMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 });
  const roofVent = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.4, 6.0), roofVentMat);
  roofVent.position.set(0, 8.8, -1.2);
  shovel.add(roofVent);

  // Heavy rear counterweight with warning hazard accents
  const cwMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
  const cw = new THREE.Mesh(new THREE.BoxGeometry(8.2, 4.8, 2.6), cwMat);
  cw.position.set(0, 5.2, -5.6);
  cw.castShadow = true;
  shovel.add(cw);

  // Yellow safety perimeter handrails around upper deck
  const railMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 });
  const railL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 9.4), railMat);
  railL.position.set(-4.1, 8.7, -1.0);
  shovel.add(railL);

  // 3. Elevated Operator Cab with wrap-around tinted glass
  const cabGlassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.85, roughness: 0.15 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 3.0), cabGlassMat);
  cab.position.set(3.2, 6.6, 2.6);
  cab.castShadow = true;
  shovel.add(cab);

  // Cab boarding walkway
  const walkwayMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 });
  const walkway = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.3, 1.2), walkwayMat);
  walkway.position.set(3.2, 5.0, 4.4);
  shovel.add(walkway);

  // 4. A-Frame Gantry structure
  const gantryBarMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45 });
  const gantryL = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7.5, 8), gantryBarMat);
  gantryL.rotation.x = Math.PI / 6;
  gantryL.position.set(-2.0, 10.5, -0.5);
  shovel.add(gantryL);

  const gantryR = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7.5, 8), gantryBarMat);
  gantryR.rotation.x = Math.PI / 6;
  gantryR.position.set(2.0, 10.5, -0.5);
  shovel.add(gantryR);

  // 5. Heavy Lattice Boom pitched forward toward the rock face
  const boomMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45 });
  const boomL = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 15, 8), boomMat);
  boomL.rotation.x = -Math.PI / 4.2;
  boomL.position.set(-1.8, 8.6, 5.4);
  boomL.castShadow = true;
  shovel.add(boomL);

  const boomR = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 15, 8), boomMat);
  boomR.rotation.x = -Math.PI / 4.2;
  boomR.position.set(1.8, 8.6, 5.4);
  boomR.castShadow = true;
  shovel.add(boomR);

  // Boom point sheaves (head pulleys)
  const sheaveMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7 });
  const sheave = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.8, 16), sheaveMat);
  sheave.rotation.z = Math.PI / 2;
  sheave.position.set(0, 14.2, 10.6);
  shovel.add(sheave);

  // 6. Hoist Cables (LineSegments connecting gantry, boom head, and bucket)
  const cableMat = new THREE.LineBasicMaterial({ color: 0x1e293b, linewidth: 2 });
  const cablePoints = [
    // Suspension cables from gantry top to boom point
    -2.0, 13.5, 0.5, -1.4, 14.2, 10.6,
    2.0, 13.5, 0.5, 1.4, 14.2, 10.6,
    // Hoist cables from boom sheaves down to dipper bucket bail
    -1.0, 14.2, 10.6, -1.0, 6.8, 11.4,
    1.0, 14.2, 10.6, 1.0, 6.8, 11.4,
  ];
  const cableGeo = new THREE.BufferGeometry();
  cableGeo.setAttribute("position", new THREE.Float32BufferAttribute(cablePoints, 3));
  const cableLines = new THREE.LineSegments(cableGeo, cableMat);
  shovel.add(cableLines);

  // 7. Dipper handle (stick) with crowd mechanism
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.55, roughness: 0.4 });
  const stick = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 9.6), stickMat);
  stick.position.set(0, 6.6, 7.2);
  stick.rotation.x = 0.18;
  shovel.add(stick);

  // 8. Mining Dipper Bucket with prominent digging teeth
  const bucketMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.35 });
  const bucket = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3.4, 3.6), bucketMat);
  bucket.position.set(0, 5.4, 11.6);
  bucket.castShadow = true;
  shovel.add(bucket);

  // 6 Forged Digging Teeth (зубья ковша)
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.5, roughness: 0.3 });
  for (let t = -1.5; t <= 1.5; t += 0.6) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 6), toothMat);
    tooth.rotation.x = Math.PI / 2.3;
    tooth.position.set(t, 4.0, 13.5);
    shovel.add(tooth);
  }

  return shovel;
}

// Authentic CAT 793F 227-Tonne Haul Truck Model
function createTruckMesh() {
  const truck = new THREE.Group();

  // 1. Heavy box-section ladder chassis frame
  const chassisMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 });
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.3, 9.6), chassisMat);
  chassis.position.y = 2.0;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  truck.add(chassis);

  // Heavy front cast bumper with recessed LED headlights
  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.6 });
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.1, 1.2), bumperMat);
  bumper.position.set(0, 1.6, 5.0);
  bumper.castShadow = true;
  truck.add(bumper);

  // Headlights (pale yellow glowing lenses)
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfef08a, emissiveIntensity: 0.6 });
  [-1.8, 1.8].forEach(lx => {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.2), lightMat);
    lamp.position.set(lx, 1.6, 5.62);
    truck.add(lamp);
  });

  // Front radiator grille & access stairs
  const grilleMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
  const grille = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.2, 0.8), grilleMat);
  grille.position.set(0, 2.8, 4.5);
  truck.add(grille);

  // Signature CAT diagonal access stairway from bumper to deck
  const stairMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45 });
  const diagStair = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.8, 0.3), stairMat);
  diagStair.rotation.z = -0.55;
  diagStair.position.set(0.8, 2.9, 4.95);
  truck.add(diagStair);

  // Upper front walk-around deck with safety handrails
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.3, 2.0), deckMat);
  deck.position.set(0, 3.8, 3.5);
  truck.add(deck);

  const handrail = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 0.1), stairMat);
  handrail.position.set(0, 4.3, 4.4);
  truck.add(handrail);

  // 2. Offset CAT Operator Cab on left side
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 2.4), cabMat);
  cab.position.set(-1.1, 4.9, 2.6);
  cab.castShadow = true;
  truck.add(cab);

  // Tinted blue glass windshield and windows
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.8, roughness: 0.2 });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.0, 1.3), glassMat);
  glass.position.set(-1.1, 5.3, 3.25);
  truck.add(glass);

  // Dual vertical exhaust stacks behind cab
  const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.3 });
  [-0.6, 0.6].forEach(ex => {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.6, 8), exhaustMat);
    pipe.position.set(ex, 5.8, 0.8);
    truck.add(pipe);
  });

  // Dual hydraulic hoist cylinders beneath dump body
  const ramMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 });
  [-1.2, 1.2].forEach(rx => {
    const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.8, 12), ramMat);
    ram.position.set(rx, 2.8, -0.6);
    ram.rotation.x = -0.25;
    truck.add(ram);
  });

  // Fuel tank on left side
  const fuelTank = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 2.8), bumperMat);
  fuelTank.position.set(-2.25, 2.1, 0.3);
  truck.add(fuelTank);

  // 3. Heavy Rock Dump Body (Кузов) with forward protective canopy
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.5, 7.2), boxMat);
  box.position.set(0, 4.0, -0.8);
  box.castShadow = true;
  box.receiveShadow = true;
  truck.add(box);

  // Protective Rock Canopy (защитный козырек над кабиной)
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.6, 3.6), boxMat);
  canopy.position.set(0, 5.9, 2.8);
  canopy.rotation.x = -0.16;
  canopy.castShadow = true;
  truck.add(canopy);

  // 4. Dynamic Ore Payload Heap in Dump Box
  const oreMat = new THREE.MeshStandardMaterial({ color: 0x3d7068, roughness: 0.92, flatShading: true });
  const ore = new THREE.Mesh(new THREE.DodecahedronGeometry(2.6, 1), oreMat);
  ore.scale.set(1.5, 0.8, 1.9);
  ore.position.set(0, 4.8, -0.8);
  ore.name = "oreLoad";
  truck.add(ore);

  // 5. 6 Massive Haul Tires (CAT 40.00R57) with bright yellow planetary hubs
  // Front steer: single tires. Rear axle: dual tires on each side.
  // Wheel radius 1.7m, centered at y = 1.7m so bottom of tire touches y = 0.0 with zero clipping.
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.92 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35, metalness: 0.3 });
  const tireGeo = new THREE.CylinderGeometry(1.7, 1.7, 1.0, 18);
  tireGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.85, 0.85, 1.05, 14);
  hubGeo.rotateZ(Math.PI / 2);

  // Wheel positions: 2 front steer + 4 rear duals (outer & inner on each side)
  const wheelPositions = [
    [-2.4, 1.7, 3.2], [2.4, 1.7, 3.2],   // Front single steer wheels
    [-2.95, 1.7, -2.5], [-1.85, 1.7, -2.5], // Rear left dual wheels
    [1.85, 1.7, -2.5], [2.95, 1.7, -2.5],   // Rear right dual wheels
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

  // 5 CAT 793F Haul Trucks
  for (let i = 1; i <= 5; i++) {
    const id = `truck-0${i}`;
    const mesh = createTruckMesh();
    mesh.name = id;
    truckMeshes[id] = mesh;
    scene.add(mesh);

    // Initial default kinematics state
    let initCurve = routeEX2;
    let routeDist = 4.2;
    if (i === 1 || i === 2) {
      initCurve = routeEX1;
      routeDist = 3.6;
    } else if (i === 5) {
      initCurve = routeEX3;
      routeDist = 2.8;
    }

    truckKinematics[id] = {
      renderProgress: 0.1 * i,
      targetProgress: 0.1 * i,
      speedKmh: 14.5,
      totalRouteKm: routeDist,
      state: "hauling",
      curve: initCurve,
      payload: 227.0,
      grade: 0.48,
      dustTimer: 0.0,
    };
  }
}

// Tire Dust Particle System
function initDustSystem() {
  dustGeo = new THREE.BufferGeometry();
  for (let i = 0; i < DUST_COUNT; i++) {
    dustPositions[i * 3] = 0;
    dustPositions[i * 3 + 1] = -1000; // Hidden initially
    dustPositions[i * 3 + 2] = 0;
    dustParticles.push({
      active: false,
      life: 0.0,
      maxLife: 1.4,
      vx: 0,
      vy: 0,
      vz: 0,
    });
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));

  // Procedural soft radial gradient particle texture
  const pCanvas = document.createElement("canvas");
  pCanvas.width = 32;
  pCanvas.height = 32;
  const ctx = pCanvas.getContext("2d");
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(215, 195, 170, 0.7)");
  grad.addColorStop(0.35, "rgba(200, 180, 155, 0.35)");
  grad.addColorStop(0.75, "rgba(185, 165, 140, 0.1)");
  grad.addColorStop(1, "rgba(185, 165, 140, 0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  const pTexture = new THREE.CanvasTexture(pCanvas);

  dustMat = new THREE.PointsMaterial({
    size: 4.8,
    map: pTexture,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    color: 0xc8b79f,
    blending: THREE.NormalBlending,
  });

  dustPoints = new THREE.Points(dustGeo, dustMat);
  scene.add(dustPoints);
}

function emitDustPuff(truckMesh, isReturning) {
  // Find an inactive particle from the pool
  let p = null;
  let pIdx = -1;
  for (let i = 0; i < DUST_COUNT; i++) {
    if (!dustParticles[i].active) {
      p = dustParticles[i];
      pIdx = i;
      break;
    }
  }
  if (!p) return;

  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(truckMesh.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(truckMesh.quaternion);

  // Position puff behind rear wheels
  const rearOffset = isReturning ? 3.8 : -3.8;
  const sideOffset = (Math.random() - 0.5) * 3.6;
  const spawnPos = truckMesh.position.clone()
    .addScaledVector(forward, rearOffset)
    .addScaledVector(right, sideOffset);
  spawnPos.y += 0.2;

  dustPositions[pIdx * 3] = spawnPos.x;
  dustPositions[pIdx * 3 + 1] = spawnPos.y;
  dustPositions[pIdx * 3 + 2] = spawnPos.z;

  // Velocity: backward slipstream drift + gentle upward buoyancy
  const drift = forward.clone().multiplyScalar(isReturning ? 0.6 : -0.6);
  p.vx = drift.x * 0.8 + (Math.random() - 0.5) * 0.3;
  p.vy = 0.4 + Math.random() * 0.5;
  p.vz = drift.z * 0.8 + (Math.random() - 0.5) * 0.3;
  p.life = 1.0;
  p.maxLife = 1.1 + Math.random() * 0.5;
  p.active = true;
}

function updateDustSystem(dt) {
  if (!dustGeo) return;
  for (let i = 0; i < DUST_COUNT; i++) {
    const p = dustParticles[i];
    if (!p.active) continue;

    p.life -= dt / p.maxLife;
    if (p.life <= 0) {
      p.active = false;
      dustPositions[i * 3 + 1] = -1000;
      continue;
    }

    dustPositions[i * 3] += p.vx * dt * 3.5;
    dustPositions[i * 3 + 1] += p.vy * dt * 2.5;
    dustPositions[i * 3 + 2] += p.vz * dt * 3.5;

    p.vx *= 0.97;
    p.vz *= 0.97;
  }
  dustGeo.attributes.position.needsUpdate = true;
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
  const radarEl = document.getElementById("val-radar-status");
  if (radarEl) {
    const statusVal = (radar.status && radar.status.value) ? String(radar.status.value).toLowerCase() : "normal";
    const isAlert = statusVal.includes("alert") || statusVal.includes("collapse") || !!whatif.road_blocked;
    if (isAlert) {
      radarEl.innerText = "ОПОЛЗЕНЬ (14.80 мм/сут)";
      radarEl.style.color = "#ef4444";
    } else {
      radarEl.innerText = "Стабильно (0.20 мм/сут)";
      radarEl.style.color = "#34d399";
    }
  }

  // What-If Button States
  const btnEx1 = document.getElementById("btn-ex1");
  const btnRoad = document.getElementById("btn-road");
  const btnDilution = document.getElementById("btn-dilution");
  if (btnEx1) btnEx1.classList.toggle("active", !!whatif.ex1_failure);
  if (btnRoad) btnRoad.classList.toggle("active", !!whatif.road_blocked);
  if (btnDilution) btnDilution.classList.toggle("active", !!whatif.dilution);

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

  // Check Shovel EX-01 failure
  if (shovelMeshes["excavator-01"]) {
    const house = shovelMeshes["excavator-01"].getObjectByName("machineryHouse");
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
    const house = shovelMeshes["excavator-02"].getObjectByName("machineryHouse");
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

  // Update truck telemetry targets for 60 FPS kinematics interpolation
  for (let i = 1; i <= 5; i++) {
    const id = `truck-0${i}`;
    const t = twins[id];
    const tk = truckKinematics[id];
    if (!t || !tk) continue;

    const state = t.state ? t.state.value : "hauling";
    const targetProg = (t.route_progress_pct ? t.route_progress_pct.value : 0) / 100.0;
    const speed = t.speed ? t.speed.value : 0;
    const payload = t.payload ? t.payload.value : 0;
    const grade = t.grade_in_box ? t.grade_in_box.value : 0.40;

    // Determine route curve and total distance
    let curve = routeEX2;
    let routeKm = 4.2;
    if (i === 5) {
      curve = routeEX3;
      routeKm = 2.8;
    } else if (whatif.road_blocked) {
      curve = routeDetour;
      routeKm = (i === 1 || i === 2) ? 3.6 + 1.4 : 4.2 + 1.4;
    } else if (i === 1 || i === 2) {
      curve = whatif.ex1_failure ? routeDetour : routeEX1;
      routeKm = 3.6;
    }

    // State transition handling
    if (tk.state !== state) {
      if (state === "hauling") tk.renderProgress = 0.0;
      else if (state === "returning") tk.renderProgress = 0.0;
      else if (state === "dumping") tk.renderProgress = 1.0;
    }

    tk.targetProgress = targetProg;
    tk.speedKmh = speed;
    tk.totalRouteKm = routeKm;
    tk.state = state;
    tk.curve = curve;
    tk.payload = payload;
    tk.grade = grade;
  }
}

// What-If scenario triggers
async function triggerWhatIf(scenario) {
  try {
    const res = await fetch(`/api/whatif/${scenario}`);
    const data = await res.json();
    const isActivating = data.active === true || data.status === "active";
    logEvent(data.message || `Сценарий ${scenario}: ${data.status}`, isActivating ? "alert" : "success");

    // Immediate button state update
    const mapBtn = {
      "ex1-fail": "btn-ex1",
      "road-block": "btn-road",
      "dilution": "btn-dilution"
    };
    const btnId = mapBtn[scenario];
    if (btnId) {
      const btn = document.getElementById(btnId);
      if (btn && data.active !== undefined) {
        btn.classList.toggle("active", !!data.active);
      }
    }

    fetchState();
  } catch (err) {
    console.error(err);
  }
}

const toggleWhatIf = triggerWhatIf;

// Expose globally for HTML onclick handlers and test scripts
if (typeof window !== "undefined") {
  window.triggerWhatIf = triggerWhatIf;
  window.toggleWhatIf = triggerWhatIf;
  window.resetWhatIf = resetWhatIf;
  window.setCameraView = setCameraView;
}

async function resetWhatIf() {
  try {
    const res = await fetch(`/api/whatif/reset`);
    const data = await res.json();
    logEvent(data.message || "[Штатный режим] Все сценарии «Что-Если» сброшены в исходное состояние.", "success");
    ["btn-ex1", "btn-road", "btn-dilution"].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.remove("active");
    });
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
  const activeBtn = document.querySelector(`.cam-btn[data-cam="${mode}"]`);
  if (activeBtn) activeBtn.classList.add("active");

  if (mode === "orbit") {
    camera.position.set(-65, 165, 245);
    controls.target.set(10, 8, -15);
  } else if (mode === "crusher") {
    // 3/4 view of the crusher dump bay, conveyor bridge, and incoming trucks
    camera.position.set(45, 58, -80);
    controls.target.set(95, 38, -132);
  } else if (mode === "ex1") {
    // Front 3/4 working face view of Shovel EX-01 scooping high-grade copper
    camera.position.set(45, 28, 45);
    controls.target.set(72, 20, 65);
  } else if (mode === "ex2") {
    // Front 3/4 working face view of Shovel EX-02 on bench +220m
    camera.position.set(-48, 14, 46);
    controls.target.set(-28, 4, 30);
  } else if (mode === "waste") {
    // Panoramic view of waste dump tipping deck, truck-05, and safety bund
    camera.position.set(-145, 52, -85);
    controls.target.set(-118, 38, -112);
  } else if (mode.startsWith("truck")) {
    const mesh = truckMeshes[mode];
    if (mesh) {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      const backward = forward.clone().negate().setY(0).normalize();
      camera.position.copy(mesh.position).addScaledVector(backward, 32).add(new THREE.Vector3(0, 13.0, 0));
      controls.target.copy(mesh.position).add(new THREE.Vector3(0, 3.0, 0));
    }
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Main 60 FPS Render & Kinematics Loop
function animate(timestamp) {
  requestAnimationFrame(animate);

  const dt = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000.0, 0.1) : 0.016;
  lastTimestamp = timestamp;

  // 1. Advance Truck Kinematics smoothly at full 60 FPS
  for (let i = 1; i <= 5; i++) {
    const id = `truck-0${i}`;
    const tk = truckKinematics[id];
    const mesh = truckMeshes[id];
    if (!tk || !mesh || !tk.curve) continue;

    if (tk.state === "hauling" || tk.state === "returning") {
      // Continuous speed-based progress advance (simulator speedup = 5.0x)
      const speedup = 5.0;
      const progressRate = (Math.max(tk.speedKmh, 8.0) * speedup / 3600.0) / tk.totalRouteKm;
      tk.renderProgress += progressRate * dt;

      // Smoothly synchronize with targetProgress from REST API to eliminate cumulative drift
      const diff = tk.targetProgress - tk.renderProgress;
      if (Math.abs(diff) > 0.35) {
        tk.renderProgress = tk.targetProgress;
      } else {
        tk.renderProgress += diff * Math.min(1.0, dt * 3.5);
      }
    } else if (tk.state === "dumping") {
      tk.renderProgress = 1.0;
    } else {
      // loading or queued at shovel
      tk.renderProgress = 0.0;
    }

    tk.renderProgress = Math.max(0.001, Math.min(0.999, tk.renderProgress));

    let tNorm = tk.renderProgress;
    const isReturning = (tk.state === "returning");
    if (isReturning) {
      tNorm = 1.0 - tNorm;
    }

    const pos = tk.curve.getPointAt(tNorm);
    const tangent = tk.curve.getTangentAt(tNorm).normalize();

    mesh.position.copy(pos);
    mesh.position.y += 0.35; // Tires seated firmly on road ribbon with zero clipping

    // Orient truck along road tangent with strict vertical UP constraint (no unwanted roll)
    if (isReturning) {
      tangent.negate();
    }
    const lookTarget = mesh.position.clone().add(tangent);
    mesh.lookAt(lookTarget);

    // Update dynamic ore payload in dump box
    const ore = mesh.getObjectByName("oreLoad");
    if (ore) {
      ore.visible = tk.payload > 10;
      if (tk.grade > 0.50) {
        ore.material.color.setHex(0x15803d); // High-grade malachite green
      } else if (tk.grade > 0.20) {
        ore.material.color.setHex(0xb45309); // ROM chalcopyrite bronze
      } else {
        ore.material.color.setHex(0x475569); // Overburden waste rock
      }
    }

    // Emit subtle dust puffs behind tires of moving haul trucks
    if ((tk.state === "hauling" || tk.state === "returning") && tk.speedKmh > 5.0) {
      tk.dustTimer += dt;
      if (tk.dustTimer >= 0.08) {
        tk.dustTimer = 0.0;
        emitDustPuff(mesh, isReturning);
      }
    }
  }

  // 2. Update Dust Particle System
  updateDustSystem(dt);

  // 3. Oscillate SSR Radar beam
  if (radarBeamMesh) {
    radarBeamMesh.rotation.y = Math.sin(Date.now() * 0.0014) * 0.42;
  }

  // 4. Smooth chase camera update if following a truck
  if (currentCameraMode.startsWith("truck")) {
    const mesh = truckMeshes[currentCameraMode];
    if (mesh) {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      const backward = forward.clone().negate().setY(0).normalize();
      const idealCam = mesh.position.clone().addScaledVector(backward, 32).add(new THREE.Vector3(0, 13.0, 0));
      camera.position.lerp(idealCam, 0.08);
      controls.target.lerp(mesh.position.clone().add(new THREE.Vector3(0, 3.0, 0)), 0.08);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener("DOMContentLoaded", init);
