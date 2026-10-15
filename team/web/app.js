/**
 * Aktogay Open-Pit Mine 3D Digital Twin Visualizer
 * Team AURA (team-077) for OpenEgiz Contest
 */

let scene, camera, renderer, controls;
let truckMeshes = {};
let shovelMeshes = {};
let pitMesh, rampLine, detourLine;
let radarBeamMesh;
let activeCamTarget = null;
let currentCameraMode = "orbit";

// Coordinates for key pit locations
const LOCATIONS = {
  crusher: new THREE.Vector3(120, 35, -40),
  stockpile: new THREE.Vector3(150, 36, -30),
  waste_dump: new THREE.Vector3(-140, 35, -120),
  ex1: new THREE.Vector3(40, 20, 80),     // Bench +280m
  ex2: new THREE.Vector3(-60, 5, 20),     // Bench +220m
  ex3: new THREE.Vector3(-90, 28, -60),   // Bench +320m
  radar: new THREE.Vector3(0, 36, -140),
};

// Spline Curves for Haul Routes
let routeEX1, routeEX2, routeEX3, routeDetour;

function init() {
  const canvas = document.getElementById("viewport");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f17);
  scene.fog = new THREE.FogExp2(0x0b0f17, 0.0018);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 2000);
  camera.position.set(160, 140, 220);

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
  controls.maxDistance = 600;
  controls.target.set(0, 10, 0);

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
  const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.55);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xffedd5, 1.2);
  sunLight.position.set(150, 250, 100);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 600;
  sunLight.shadow.camera.left = -200;
  sunLight.shadow.camera.right = 200;
  sunLight.shadow.camera.top = 200;
  sunLight.shadow.camera.bottom = -200;
  scene.add(sunLight);

  // Soft blue sky bounce light
  const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x1e293b, 0.4);
  scene.add(hemiLight);
}

function buildOpenPit() {
  // Ground plane surface (+350m elevation)
  const surfaceGeo = new THREE.PlaneGeometry(600, 600, 32, 32);
  const surfaceMat = new THREE.MeshStandardMaterial({
    color: 0x5a4d41,
    roughness: 0.9,
    metalness: 0.1,
    flatShading: true,
  });
  const surface = new THREE.Mesh(surfaceGeo, surfaceMat);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 35;
  surface.receiveShadow = true;
  scene.add(surface);

  // Pit crater with concentric stepped terraces (benches)
  const benches = [
    { radiusTop: 160, radiusBottom: 140, height: 8, y: 31, color: 0x6b5b4d },
    { radiusTop: 140, radiusBottom: 120, height: 8, y: 23, color: 0x786756 }, // +280m High-grade
    { radiusTop: 120, radiusBottom: 100, height: 8, y: 15, color: 0x857260 },
    { radiusTop: 100, radiusBottom: 80, height: 8, y: 7, color: 0x8a6e55 },  // +220m ROM
    { radiusTop: 80, radiusBottom: 55, height: 8, y: -1, color: 0x54473b },
    { radiusTop: 55, radiusBottom: 35, height: 8, y: -9, color: 0x45392f },  // Pit bottom
  ];

  benches.forEach((b, idx) => {
    const benchGeo = new THREE.CylinderGeometry(b.radiusTop, b.radiusBottom, b.height, 48, 1, true);
    // Tint ore faces with greenish-copper or reddish tones
    let faceColor = b.color;
    if (idx === 1) faceColor = 0x3d7068; // Cu high-grade mineralization
    if (idx === 3) faceColor = 0x7c4f3d; // Porphyry Cu ROM

    const benchMat = new THREE.MeshStandardMaterial({
      color: faceColor,
      roughness: 0.85,
      metalness: 0.15,
      side: THREE.BackSide,
      flatShading: true,
    });
    const benchMesh = new THREE.Mesh(benchGeo, benchMat);
    benchMesh.position.y = b.y;
    benchMesh.receiveShadow = true;
    scene.add(benchMesh);

    // Bench Berm Floor
    const bermGeo = new THREE.RingGeometry(b.radiusBottom - 0.5, b.radiusTop + 0.5, 48);
    const bermMat = new THREE.MeshStandardMaterial({ color: 0x4a3d32, roughness: 0.9, side: THREE.DoubleSide });
    const bermMesh = new THREE.Mesh(bermGeo, bermMat);
    bermMesh.rotation.x = -Math.PI / 2;
    bermMesh.position.y = b.y - b.height / 2;
    bermMesh.receiveShadow = true;
    scene.add(bermMesh);
  });
}

function buildRoads() {
  // Route EX-01 (Bench +280m) to Crusher
  const ptsEX1 = [
    LOCATIONS.ex1.clone(),
    new THREE.Vector3(70, 22, 60),
    new THREE.Vector3(95, 26, 20),
    new THREE.Vector3(105, 30, -10),
    LOCATIONS.crusher.clone(),
  ];
  routeEX1 = new THREE.CatmullRomCurve3(ptsEX1);

  // Route EX-02 (Bench +220m) to Crusher (Ramp +240m section)
  const ptsEX2 = [
    LOCATIONS.ex2.clone(),
    new THREE.Vector3(-30, 8, 40),
    new THREE.Vector3(20, 15, 60),
    new THREE.Vector3(70, 22, 60),
    new THREE.Vector3(95, 26, 20),
    new THREE.Vector3(105, 30, -10),
    LOCATIONS.crusher.clone(),
  ];
  routeEX2 = new THREE.CatmullRomCurve3(ptsEX2);

  // Route EX-03 (Waste Bench +320m) to Waste Dump
  const ptsEX3 = [
    LOCATIONS.ex3.clone(),
    new THREE.Vector3(-100, 32, -80),
    LOCATIONS.waste_dump.clone(),
  ];
  routeEX3 = new THREE.CatmullRomCurve3(ptsEX3);

  // Bypass detour route around collapsed ramp
  const ptsDetour = [
    LOCATIONS.ex2.clone(),
    new THREE.Vector3(-50, 10, -10),
    new THREE.Vector3(-20, 20, -50),
    new THREE.Vector3(30, 28, -60),
    new THREE.Vector3(80, 34, -50),
    LOCATIONS.crusher.clone(),
  ];
  routeDetour = new THREE.CatmullRomCurve3(ptsDetour);

  // Draw main road tube on scene
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x2d241e, roughness: 0.95 });
  const tube1 = new THREE.Mesh(new THREE.TubeGeometry(routeEX2, 64, 2.8, 8, false), roadMat);
  tube1.position.y += 0.3;
  tube1.receiveShadow = true;
  scene.add(tube1);

  const tube3 = new THREE.Mesh(new THREE.TubeGeometry(routeEX3, 32, 2.8, 8, false), roadMat);
  tube3.position.y += 0.3;
  tube3.receiveShadow = true;
  scene.add(tube3);
}

function buildInfrastructure() {
  // Primary Gyratory Crusher building
  const crusherGroup = new THREE.Group();
  crusherGroup.position.copy(LOCATIONS.crusher);

  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.4, roughness: 0.5 });
  const building = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 18), buildingMat);
  building.position.y = 6;
  building.castShadow = true;
  crusherGroup.add(building);

  // Dump hopper
  const hopperMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.2, roughness: 0.6 });
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(5, 2.5, 4, 16), hopperMat);
  hopper.position.set(-6, 8, 0);
  crusherGroup.add(hopper);

  // Conveyor bridge leading to surge stockpile
  const conveyorMat = new THREE.MeshStandardMaterial({ color: 0x64748b });
  const conveyor = new THREE.Mesh(new THREE.BoxGeometry(32, 2, 2), conveyorMat);
  conveyor.position.set(16, 10, 5);
  conveyor.rotation.z = -0.15;
  crusherGroup.add(conveyor);

  scene.add(crusherGroup);

  // Surge Stockpile (Ore cone)
  const stockpileMat = new THREE.MeshStandardMaterial({ color: 0x5c4d3c, roughness: 0.9 });
  const stockpile = new THREE.Mesh(new THREE.ConeGeometry(18, 14, 24), stockpileMat);
  stockpile.position.set(LOCATIONS.stockpile.x, LOCATIONS.stockpile.y + 7, LOCATIONS.stockpile.z);
  stockpile.castShadow = true;
  scene.add(stockpile);

  // Waste Dump (terraced mound)
  const wasteMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.95 });
  const wasteDump = new THREE.Mesh(new THREE.CylinderGeometry(28, 42, 16, 24), wasteMat);
  wasteDump.position.set(LOCATIONS.waste_dump.x, LOCATIONS.waste_dump.y + 8, LOCATIONS.waste_dump.z);
  wasteDump.castShadow = true;
  scene.add(wasteDump);

  // Slope Stability Radar (SSR)
  const radarGroup = new THREE.Group();
  radarGroup.position.copy(LOCATIONS.radar);

  const tripod = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 2, 6, 6), buildingMat);
  tripod.position.y = 3;
  radarGroup.add(tripod);

  const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 16, 0, Math.PI), hopperMat);
  dish.rotation.x = Math.PI / 2;
  dish.position.y = 6;
  radarGroup.add(dish);

  // Radar Scan Beam Fan
  const beamGeo = new THREE.ConeGeometry(40, 90, 16, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.15,
    wireframe: true,
    side: THREE.DoubleSide,
  });
  radarBeamMesh = new THREE.Mesh(beamGeo, beamMat);
  radarBeamMesh.rotation.x = -Math.PI / 2.3;
  radarBeamMesh.position.set(0, 6, 45);
  radarGroup.add(radarBeamMesh);

  scene.add(radarGroup);
}

function createShovelMesh(name, color) {
  const shovel = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });
  const tracks = new THREE.Mesh(new THREE.BoxGeometry(7, 2, 9), baseMat);
  tracks.position.y = 1;
  shovel.add(tracks);

  const houseMat = new THREE.MeshStandardMaterial({ color: color, metalness: 0.3, roughness: 0.6 });
  const house = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 7), houseMat);
  house.position.set(0, 4, -0.5);
  house.castShadow = true;
  shovel.add(house);

  const boomMat = new THREE.MeshStandardMaterial({ color: 0xfacc15 });
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 12, 8), boomMat);
  boom.rotation.x = -Math.PI / 4;
  boom.position.set(0, 7, 5);
  shovel.add(boom);

  return shovel;
}

function createTruckMesh() {
  const truck = new THREE.Group();

  // Chassis
  const chassisMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.7 });
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 8.5), chassisMat);
  chassis.position.y = 2.0;
  truck.add(chassis);

  // Yellow Cab
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
  truck.add(box);

  // Ore in Dump Box
  const oreMat = new THREE.MeshStandardMaterial({ color: 0x3d7068, roughness: 0.9 });
  const ore = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.5, 5.6), oreMat);
  ore.position.set(0, 3.8, -1.0);
  ore.name = "oreLoad";
  truck.add(ore);

  // 6 Massive Haul Wheels
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
  const wheelGeo = new THREE.CylinderGeometry(1.4, 1.4, 0.9, 12);
  wheelGeo.rotateZ(Math.PI / 2);

  const wheelPositions = [
    [-2.2, 1.4, 2.6], [2.2, 1.4, 2.6],   // Front
    [-2.2, 1.4, -1.5], [2.2, 1.4, -1.5], // Rear Left/Right outer
    [-2.2, 1.4, -3.0], [2.2, 1.4, -3.0], // Rear Left/Right inner
  ];

  wheelPositions.forEach(pos => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(...pos);
    truck.add(w);
  });

  return truck;
}

function buildEquipment() {
  // Shovels
  shovelMeshes["excavator-01"] = createShovelMesh("EX-01", 0x0284c7); // High-grade
  shovelMeshes["excavator-01"].position.copy(LOCATIONS.ex1);
  shovelMeshes["excavator-01"].rotation.y = -Math.PI / 3;
  scene.add(shovelMeshes["excavator-01"]);

  shovelMeshes["excavator-02"] = createShovelMesh("EX-02", 0xe11d48); // ROM
  shovelMeshes["excavator-02"].position.copy(LOCATIONS.ex2);
  shovelMeshes["excavator-02"].rotation.y = Math.PI / 4;
  scene.add(shovelMeshes["excavator-02"]);

  shovelMeshes["excavator-03"] = createShovelMesh("EX-03", 0x64748b); // Waste
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

    // Color grade indicator: green if in band [0.44, 0.52], red/yellow otherwise
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
  if (mine.fuel_rate) {
    document.getElementById("val-fuel-rate").innerText = `${Math.round(mine.fuel_rate.value)} л/ч`;
  }

  // Radar status
  const radar = twins["slope-radar-01"] || {};
  if (radar.status) {
    const disp = radar.displacement_rate_mm ? `${radar.displacement_rate_mm.value.toFixed(2)} мм/ч` : "0.3 мм/ч";
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
    if (i === 1) curve = whatif.ex1_failure ? routeDetour : routeEX1;
    else if (i === 5) curve = routeEX3;
    else if (whatif.road_blocked) curve = routeDetour;

    let tNorm = Math.max(0.001, Math.min(0.999, progress));
    if (state === "returning") {
      tNorm = 1.0 - tNorm; // Driving backwards along the route
    }

    const pos = curve.getPointAt(tNorm);
    const tangent = curve.getTangentAt(tNorm);

    mesh.position.copy(pos);
    mesh.position.y += 0.8; // Elevation above road surface

    if (state === "returning") {
      tangent.negate();
    }
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent.normalize());

    // Update Chase Camera if actively following this truck
    if (currentCameraMode === id) {
      const offset = new THREE.Vector3(0, 8, -18).applyQuaternion(mesh.quaternion);
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
    camera.position.set(160, 140, 220);
    controls.target.set(0, 10, 0);
  } else if (mode === "crusher") {
    camera.position.set(150, 60, -10);
    controls.target.copy(LOCATIONS.crusher);
  } else if (mode === "ex1") {
    camera.position.set(65, 35, 105);
    controls.target.copy(LOCATIONS.ex1);
  } else if (mode === "ex2") {
    camera.position.set(-35, 20, 45);
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
