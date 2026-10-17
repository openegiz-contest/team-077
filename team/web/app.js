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
  crusher: new THREE.Vector3(145, 35, -45),
  stockpile: new THREE.Vector3(175, 35, -35),
  waste_dump: new THREE.Vector3(-170, 35, -120),
  ex1: new THREE.Vector3(40, 19, 80),     // Bench +280m High-grade Cu (0.64%)
  ex2: new THREE.Vector3(-34, 3, 16),     // Bench +220m ROM Porphyry Cu (0.40%)
  ex3: new THREE.Vector3(-92, 28, -62),   // Bench +320m Waste Overburden
  radar: new THREE.Vector3(0, 35, -150),  // North rim Slope Stability Radar (SSR)
};

// Spline Curves for Haul Routes
let routeEX1, routeEX2, routeEX3, routeDetour;

function init() {
  const canvas = document.getElementById("viewport");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);
  scene.fog = new THREE.FogExp2(0x0f172a, 0.0012);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 2000);
  camera.position.set(160, 130, 190);

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
  controls.maxDistance = 650;
  controls.target.set(0, 8, 0);

  setupLighting();
  buildOpenPit();
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
  const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.45);
  scene.add(ambientLight);

  // Directional sun light casting soft shadows across the pit benches
  const sunLight = new THREE.DirectionalLight(0xffedd5, 1.35);
  sunLight.position.set(180, 240, 110);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 700;
  sunLight.shadow.camera.left = -220;
  sunLight.shadow.camera.right = 220;
  sunLight.shadow.camera.top = 220;
  sunLight.shadow.camera.bottom = -220;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  // Sky hemisphere bounce light
  const hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x1e293b, 0.55);
  scene.add(hemiLight);
}

function buildOpenPit() {
  const pitGroup = new THREE.Group();

  // 1. Surrounding Plateau Surface (+350m elevation) with exact pit crater opening
  // Built using Shape with a circular hole so the pit is an OPEN sunken excavation bowl
  const surfaceShape = new THREE.Shape();
  const halfSize = 500;
  surfaceShape.moveTo(-halfSize, -halfSize);
  surfaceShape.lineTo(halfSize, -halfSize);
  surfaceShape.lineTo(halfSize, halfSize);
  surfaceShape.lineTo(-halfSize, halfSize);
  surfaceShape.closePath();

  // Circular crater rim opening (radius 145)
  const rimRadius = 145;
  const pitHole = new THREE.Path();
  pitHole.absarc(0, 0, rimRadius, 0, Math.PI * 2, true);
  surfaceShape.holes.push(pitHole);

  const surfaceGeo = new THREE.ShapeGeometry(surfaceShape, 64);
  const surfaceMat = new THREE.MeshStandardMaterial({
    color: 0x6e6355, // Steppe arid plateau earth
    roughness: 0.92,
    metalness: 0.05,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const surface = new THREE.Mesh(surfaceGeo, surfaceMat);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 35;
  surface.receiveShadow = true;
  pitGroup.add(surface);

  // 2. Realistic Stepped Benches (Уступы карьера)
  // Each tier consists of:
  // - Sloped batter face (откос уступа)
  // - Horizontal working berm shelf (горизонтальная берма безопасности/площадка)
  const benchTiers = [
    {
      // Tier 0: Horizon +350m to +320m (Waste overburden / Наносы и вскрыша)
      yTop: 35, rTop: 145, yBottom: 28, rToe: 128, rBermIn: 116,
      faceColor: 0x6d5e50, bermColor: 0x584b3f
    },
    {
      // Tier 1: Horizon +320m to +280m (High-grade Cu mineralization - Забой EX-01)
      yTop: 28, rTop: 116, yBottom: 19, rToe: 98, rBermIn: 84,
      faceColor: 0x27594f, bermColor: 0x3a544c // Rich malachite/copper oxidized ore face
    },
    {
      // Tier 2: Horizon +280m to +250m (Intermediate transition horizon)
      yTop: 19, rTop: 84, yBottom: 11, rToe: 68, rBermIn: 58,
      faceColor: 0x785340, bermColor: 0x5a3e30 // Mixed sulfide copper ore
    },
    {
      // Tier 3: Horizon +250m to +220m (Primary ROM porphyry Cu - Забой EX-02)
      yTop: 11, rTop: 58, yBottom: 3, rToe: 44, rBermIn: 32,
      faceColor: 0x8c5b36, bermColor: 0x5f4129 // Chalcopyrite bronze tone
    },
    {
      // Tier 4: Horizon +220m to +180m (Deep excavation horizon)
      yTop: 3, rTop: 32, yBottom: -5, rToe: 22, rBermIn: 16,
      faceColor: 0x44372e, bermColor: 0x322822 // Deep dark bedrock
    },
    {
      // Tier 5: Horizon +180m to +150m (Pit bottom slope to sump)
      yTop: -5, rTop: 16, yBottom: -12, rToe: 12, rBermIn: 0,
      faceColor: 0x2c221b, bermColor: 0x241c16
    },
  ];

  benchTiers.forEach((t) => {
    // Face (batter wall)
    const height = t.yTop - t.yBottom;
    const centerY = (t.yTop + t.yBottom) / 2;
    const faceGeo = new THREE.CylinderGeometry(t.rTop, t.rToe, height, 64, 1, true);
    const faceMat = new THREE.MeshStandardMaterial({
      color: t.faceColor,
      roughness: 0.88,
      metalness: 0.12,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    const faceMesh = new THREE.Mesh(faceGeo, faceMat);
    faceMesh.position.y = centerY;
    faceMesh.receiveShadow = true;
    faceMesh.castShadow = true;
    pitGroup.add(faceMesh);

    // Horizontal working berm shelf (if not bottom)
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
  const floorGeo = new THREE.CircleGeometry(12, 64);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x241c16,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -12;
  floorMesh.receiveShadow = true;
  pitGroup.add(floorMesh);

  // Sump Pool (Водоотливной зумпф) - reflective turquoise mine water at bottom
  const sumpGeo = new THREE.CircleGeometry(6, 32);
  const sumpMat = new THREE.MeshStandardMaterial({
    color: 0x155e75,
    roughness: 0.25,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });
  const sumpMesh = new THREE.Mesh(sumpGeo, sumpMat);
  sumpMesh.rotation.x = -Math.PI / 2;
  sumpMesh.position.y = -11.8;
  pitGroup.add(sumpMesh);

  scene.add(pitGroup);
}

// Generate smooth, flat 3D road ribbon along a CatmullRomCurve3
function createRoadRibbon(curve, width = 5.6, yOffset = 0.25, segments = 100) {
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
  // Route EX-01 (Bench +280m at Y=19) to Crusher (Y=35)
  const ptsEX1 = [
    LOCATIONS.ex1.clone(),
    new THREE.Vector3(65, 22, 58),
    new THREE.Vector3(92, 26, 25),
    new THREE.Vector3(118, 30, -8),
    new THREE.Vector3(132, 34, -28),
    LOCATIONS.crusher.clone(),
  ];
  routeEX1 = new THREE.CatmullRomCurve3(ptsEX1);

  // Route EX-02 (Bench +220m at Y=3) to Crusher (Y=35)
  const ptsEX2 = [
    LOCATIONS.ex2.clone(),
    new THREE.Vector3(-10, 8, 36),
    new THREE.Vector3(20, 14, 62),
    new THREE.Vector3(65, 22, 58),
    new THREE.Vector3(92, 26, 25),
    new THREE.Vector3(118, 30, -8),
    new THREE.Vector3(132, 34, -28),
    LOCATIONS.crusher.clone(),
  ];
  routeEX2 = new THREE.CatmullRomCurve3(ptsEX2);

  // Route EX-03 (Waste Bench +320m at Y=28) to Waste Dump (Y=35)
  const ptsEX3 = [
    LOCATIONS.ex3.clone(),
    new THREE.Vector3(-118, 31, -85),
    new THREE.Vector3(-142, 35, -105),
    LOCATIONS.waste_dump.clone(),
  ];
  routeEX3 = new THREE.CatmullRomCurve3(ptsEX3);

  // Bypass detour route around collapsed ramp section
  const ptsDetour = [
    LOCATIONS.ex2.clone(),
    new THREE.Vector3(-30, 9, -20),
    new THREE.Vector3(-12, 17, -55),
    new THREE.Vector3(32, 25, -70),
    new THREE.Vector3(82, 32, -62),
    new THREE.Vector3(122, 35, -52),
    LOCATIONS.crusher.clone(),
  ];
  routeDetour = new THREE.CatmullRomCurve3(ptsDetour);

  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x383028, // Compacted quarry haul road surface
    roughness: 0.95,
    side: THREE.DoubleSide,
  });

  // Main Ramp Road (EX-02 & EX-01 to Crusher)
  const roadGeo2 = createRoadRibbon(routeEX2, 5.8, 0.25, 100);
  const roadMesh2 = new THREE.Mesh(roadGeo2, roadMat);
  roadMesh2.receiveShadow = true;
  scene.add(roadMesh2);

  // EX-03 to Waste Dump Road
  const roadGeo3 = createRoadRibbon(routeEX3, 5.8, 0.25, 50);
  const roadMesh3 = new THREE.Mesh(roadGeo3, roadMat);
  roadMesh3.receiveShadow = true;
  scene.add(roadMesh3);

  // Detour Road (Bypass around collapsed ramp section)
  const detourMat = new THREE.MeshStandardMaterial({
    color: 0x42382e,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const detourGeo = createRoadRibbon(routeDetour, 5.4, 0.22, 90);
  const detourMesh = new THREE.Mesh(detourGeo, detourMat);
  detourMesh.receiveShadow = true;
  scene.add(detourMesh);

  // Dynamic Rockslide debris cluster (visible when road_blocked scenario is active)
  rockslideGroup = new THREE.Group();
  rockslideGroup.position.set(20, 14, 62);
  const boulderMat = new THREE.MeshStandardMaterial({ color: 0x5a483a, roughness: 0.92, flatShading: true });
  for (let b = 0; b < 9; b++) {
    const r = 1.0 + Math.random() * 1.5;
    const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), boulderMat);
    boulder.position.set((Math.random() - 0.5) * 5, r * 0.6, (Math.random() - 0.5) * 4);
    boulder.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    boulder.castShadow = true;
    rockslideGroup.add(boulder);
  }
  // Hazard warning cones
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 });
  for (let c = -2; c <= 2; c += 2) {
    const barrier = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 8), coneMat);
    barrier.position.set(c, 0.7, 3);
    rockslideGroup.add(barrier);
  }
  rockslideGroup.visible = false;
  scene.add(rockslideGroup);
}

function buildInfrastructure() {
  // 1. Primary Gyratory Crusher building at LOCATIONS.crusher (145, 35, -45)
  // Sits properly on the surface rim (+350m) overlooking the open pit
  const crusherGroup = new THREE.Group();
  crusherGroup.position.copy(LOCATIONS.crusher);

  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.4, roughness: 0.5 });
  const building = new THREE.Mesh(new THREE.BoxGeometry(18, 14, 20), buildingMat);
  building.position.y = 7;
  building.castShadow = true;
  crusherGroup.add(building);

  // Dump hopper pocket with yellow guide beams where trucks tip ore
  const hopperMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.3, roughness: 0.5 });
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 3.0, 5, 16), hopperMat);
  hopper.position.set(-7, 9, 0);
  crusherGroup.add(hopper);

  // Overhead primary conveyor truss towards stockpile
  const conveyorMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.5, roughness: 0.4 });
  const conveyor = new THREE.Mesh(new THREE.BoxGeometry(34, 2.5, 2.5), conveyorMat);
  conveyor.position.set(16, 11, 4);
  conveyor.rotation.z = -0.12;
  conveyor.rotation.y = 0.28;
  conveyor.castShadow = true;
  crusherGroup.add(conveyor);

  scene.add(crusherGroup);

  // 2. Surge Stockpile at LOCATIONS.stockpile (175, 35, -35)
  const stockpileMat = new THREE.MeshStandardMaterial({ color: 0x635240, roughness: 0.95 });
  const stockpile = new THREE.Mesh(new THREE.ConeGeometry(20, 16, 24), stockpileMat);
  stockpile.position.set(LOCATIONS.stockpile.x, LOCATIONS.stockpile.y + 8, LOCATIONS.stockpile.z);
  stockpile.castShadow = true;
  stockpile.receiveShadow = true;
  scene.add(stockpile);

  // 3. Engineered Terraced Waste Dump at LOCATIONS.waste_dump (-170, 35, -120)
  // Natural terraced overburden dump in realistic rock tones (not an inverted blue cone)
  const wasteDumpGroup = new THREE.Group();
  wasteDumpGroup.position.copy(LOCATIONS.waste_dump);

  const wasteMatTier1 = new THREE.MeshStandardMaterial({ color: 0x54493e, roughness: 0.95, flatShading: true });
  const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(40, 52, 9, 28), wasteMatTier1);
  tier1.position.y = 4.5;
  tier1.castShadow = true;
  tier1.receiveShadow = true;
  wasteDumpGroup.add(tier1);

  const wasteMatTier2 = new THREE.MeshStandardMaterial({ color: 0x483e35, roughness: 0.95, flatShading: true });
  const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(24, 34, 8, 24), wasteMatTier2);
  tier2.position.y = 13;
  tier2.castShadow = true;
  tier2.receiveShadow = true;
  wasteDumpGroup.add(tier2);

  scene.add(wasteDumpGroup);

  // 4. Slope Stability Radar (SSR) at LOCATIONS.radar (0, 35, -150)
  const radarGroup = new THREE.Group();
  radarGroup.position.copy(LOCATIONS.radar);

  const tripod = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.5, 6, 6), buildingMat);
  tripod.position.y = 3;
  radarGroup.add(tripod);

  const dish = new THREE.Mesh(new THREE.SphereGeometry(3.5, 16, 16, 0, Math.PI), hopperMat);
  dish.rotation.x = Math.PI / 2;
  dish.position.y = 6.5;
  radarGroup.add(dish);

  // Radar Scan Beam Fan overlooking the active quarry crater
  const beamGeo = new THREE.ConeGeometry(55, 130, 20, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.16,
    wireframe: true,
    side: THREE.DoubleSide,
  });
  radarBeamMesh = new THREE.Mesh(beamGeo, beamMat);
  radarBeamMesh.rotation.x = -Math.PI / 2.2;
  radarBeamMesh.position.set(0, 6.5, 65);
  radarGroup.add(radarBeamMesh);

  scene.add(radarGroup);
}

function createShovelMesh(name, color) {
  const shovel = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
  const tracks = new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 10), baseMat);
  tracks.position.y = 1.1;
  tracks.castShadow = true;
  tracks.receiveShadow = true;
  shovel.add(tracks);

  const houseMat = new THREE.MeshStandardMaterial({ color: color, metalness: 0.35, roughness: 0.55 });
  const house = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 8), houseMat);
  house.position.set(0, 4.6, -0.5);
  house.castShadow = true;
  house.receiveShadow = true;
  shovel.add(house);

  // Cab with glass
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.8, roughness: 0.2 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.5, 2.5), cabMat);
  cab.position.set(2.8, 5.5, 2.2);
  shovel.add(cab);

  // Heavy boom
  const boomMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 });
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 14, 8), boomMat);
  boom.rotation.x = -Math.PI / 4;
  boom.position.set(0, 8, 6);
  boom.castShadow = true;
  shovel.add(boom);

  return shovel;
}

function createTruckMesh() {
  const truck = new THREE.Group();

  // Heavy duty chassis frame
  const chassisMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.7 });
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 8.5), chassisMat);
  chassis.position.y = 2.0;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  truck.add(chassis);

  // Yellow CAT Cab
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.8, 2.2), cabMat);
  cab.position.set(-1.0, 3.5, 2.5);
  cab.castShadow = true;
  truck.add(cab);

  // Dump Box (Кузов)
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 6.0), boxMat);
  box.position.set(0, 3.4, -1.0);
  box.castShadow = true;
  box.receiveShadow = true;
  truck.add(box);

  // Dynamic Ore in Dump Box
  const oreMat = new THREE.MeshStandardMaterial({ color: 0x3d7068, roughness: 0.9 });
  const ore = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.5, 5.6), oreMat);
  ore.position.set(0, 3.8, -1.0);
  ore.name = "oreLoad";
  truck.add(ore);

  // 6 Massive Haul Wheels (CAT 793F 227-tonne)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
  const wheelGeo = new THREE.CylinderGeometry(1.4, 1.4, 0.9, 14);
  wheelGeo.rotateZ(Math.PI / 2);

  const wheelPositions = [
    [-2.2, 1.4, 2.6], [2.2, 1.4, 2.6],   // Front left & right
    [-2.2, 1.4, -1.5], [2.2, 1.4, -1.5], // Rear outer
    [-2.2, 1.4, -3.0], [2.2, 1.4, -3.0], // Rear inner
  ];

  wheelPositions.forEach(pos => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(...pos);
    w.castShadow = true;
    truck.add(w);
  });

  return truck;
}

function buildEquipment() {
  // Excavators on Benches
  shovelMeshes["excavator-01"] = createShovelMesh("EX-01", 0x0284c7); // High-grade bench +280m
  shovelMeshes["excavator-01"].position.copy(LOCATIONS.ex1);
  shovelMeshes["excavator-01"].rotation.y = -Math.PI / 3;
  scene.add(shovelMeshes["excavator-01"]);

  shovelMeshes["excavator-02"] = createShovelMesh("EX-02", 0xe11d48); // ROM bench +220m
  shovelMeshes["excavator-02"].position.copy(LOCATIONS.ex2);
  shovelMeshes["excavator-02"].rotation.y = Math.PI / 4;
  scene.add(shovelMeshes["excavator-02"]);

  shovelMeshes["excavator-03"] = createShovelMesh("EX-03", 0x64748b); // Waste bench +320m
  shovelMeshes["excavator-03"].position.copy(LOCATIONS.ex3);
  shovelMeshes["excavator-03"].rotation.y = Math.PI / 1.5;
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

    // Color grade indicator: blue/green if in band [0.44, 0.52], red/yellow otherwise
    if (grade >= 0.44 && grade <= 0.52) {
      el.style.color = "#38bdf8";
    } else {
      el.style.color = "#f87171";
    }

    // Update target bar position (0.20% to 0.70% scale)
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
  // Total Fleet Fuel Rate
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
    shovelMeshes["excavator-01"].visible = true;
    if (whatif.ex1_failure) {
      // Shovel is broken: flash red indicator
      shovelMeshes["excavator-01"].children[1].material.color.setHex(0xef4444);
    } else {
      shovelMeshes["excavator-01"].children[1].material.color.setHex(0x0284c7);
    }
  }

  // Shovel EX-02 dilution indicator
  if (shovelMeshes["excavator-02"]) {
    if (whatif.dilution) {
      shovelMeshes["excavator-02"].children[1].material.color.setHex(0xca8a04);
    } else {
      shovelMeshes["excavator-02"].children[1].material.color.setHex(0xe11d48);
    }
  }

  // Road Blockage Scenario: toggle rockslide cluster and radar alert beam
  if (rockslideGroup) {
    rockslideGroup.visible = !!whatif.road_blocked;
  }
  if (radarBeamMesh) {
    if (whatif.road_blocked) {
      radarBeamMesh.material.color.setHex(0xef4444); // Red alert sweep
    } else {
      radarBeamMesh.material.color.setHex(0x10b981); // Green nominal sweep
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
        ore.material.color.setHex(0x10b981); // High grade green
      } else if (grade > 0.20) {
        ore.material.color.setHex(0xca8a04); // ROM bronze
      } else {
        ore.material.color.setHex(0x64748b); // Waste grey
      }
    }

    // Determine route curve
    let curve = routeEX2;
    if (i === 1 || i === 2) curve = whatif.ex1_failure ? routeDetour : routeEX1;
    else if (i === 5) curve = routeEX3;
    else if (whatif.road_blocked) curve = routeDetour;

    let tNorm = Math.max(0.001, Math.min(0.999, progress));
    if (state === "returning") {
      tNorm = 1.0 - tNorm; // Driving backwards along the route
    }

    const pos = curve.getPointAt(tNorm);
    const tangent = curve.getTangentAt(tNorm);

    mesh.position.copy(pos);
    mesh.position.y += 0.35; // Tires sitting firmly on road surface

    if (state === "returning") {
      tangent.negate();
    }
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent.normalize());

    // Update Chase Camera if actively following this truck
    if (currentCameraMode === id) {
      const offset = new THREE.Vector3(0, 8, -20).applyQuaternion(mesh.quaternion);
      camera.position.copy(mesh.position).add(offset);
      controls.target.copy(mesh.position);
    }
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
    camera.position.set(160, 130, 190);
    controls.target.set(0, 8, 0);
  } else if (mode === "crusher") {
    camera.position.set(175, 50, -18);
    controls.target.copy(LOCATIONS.crusher);
  } else if (mode === "ex1") {
    camera.position.set(65, 32, 105);
    controls.target.copy(LOCATIONS.ex1);
  } else if (mode === "ex2") {
    camera.position.set(-8, 16, 38);
    controls.target.copy(LOCATIONS.ex2);
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
    radarBeamMesh.rotation.y = Math.sin(Date.now() * 0.0015) * 0.45;
  }

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener("DOMContentLoaded", init);
