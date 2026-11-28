'use strict';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  buildSolarTrackerRig,
  HOTSPOT_LAYER,
  WIRE_HIT_LAYER,
  PIN_HIT_LAYER
} from './rig3d-model.js';
import {
  createWorkshopFloorTexture,
  createOutdoorGroundTexture
} from './rig3d-textures.js';
import {
  clamp,
  servoDegToPanelTiltRad,
  servoDegToHornRad,
  lightArcToWorldPos,
  worldPosToLightArc,
  computeElectricalEstimate
} from './rig3d-math.js';
import {
  WIRE_NET_META,
  HOTSPOT_WIRE_NET_MAP,
  buildMacroPinCallouts,
  getWireNetMetaForStage,
  getHotspotWireNetsForStage,
  computeSmartCameraOffset,
  computeWireFrameCamera
} from './rig3d-wiring.js';
import {
  MIN_BUILD_STAGE,
  FULL_BUILD_STAGE,
  BUILD_STAGES,
  getBuildStageMeta,
  isHotspotVisibleAtStage,
  isPresetVisibleAtStage,
  isWireNetVisibleAtStage,
  createStageHistoryState,
  checkoutStageInHistory,
  undoStageInHistory,
  redoStageInHistory
} from './rig3d-stages.js';

const STAGE_STORAGE_KEY = 'solartracker_rig3d_stage_v1';

const CAMERA_PRESETS = {
  overview:   { pos: [1.30, 1.86, 2.48],   target: [0.06, 0.80, 0.06] },
  front:      { pos: [0.08, 1.12, 2.32],   target: [0.05, 0.94, 0.06] },
  watt_scc:   { pos: [0.04, 1.02, 0.62],   target: [0.02, 1.00, 0.05] },
  ina219:     { pos: [-0.306, 0.782, 0.218], target: [-0.306, 0.623, 0.118] },
  xl4015:     { pos: [-0.215, 0.80, 0.25], target: [-0.215, 0.625, 0.118] },
  breadboard: { pos: [-0.042, 0.80, 0.26], target: [-0.042, 0.625, 0.126] },
  esp_pins:   { pos: [0.165, 0.78, 0.24],  target: [0.160, 0.628, 0.118] },
  tiny_rtc:   { pos: [0.298, 0.745, 0.192], target: [0.295, 0.624, 0.119] },
  ups_switch: { pos: [0.352, 0.745, 0.215], target: [0.348, 0.625, 0.082] },
  ups:        { pos: [0.415, 0.772, 0.318], target: [0.422, 0.630, 0.105] },
  ldr:        { pos: [-0.43, 0.81, 0.29],  target: [-0.43, 0.635, 0.115] },
  rear:       { pos: [0.36, 1.28, -0.76],  target: [0.02, 1.20, -0.03] },
  power:      { pos: [-0.56, 0.44, 0.90],  target: [-0.14, 0.30, -0.04] }
};

const MACRO_PRESET_GROUPS = {
  esp_pins: 'esp',
  tiny_rtc: 'esp',
  ups_switch: 'ups',
  ina219: 'ina219',
  breadboard: 'breadboard',
  xl4015: 'xl4015',
  ups: 'ups',
  ldr: 'ldr',
  watt_scc: 'watt_scc'
};

const HOTSPOT_META = {
  panel: {
    title: 'Panel Surya Monokristalin (Fleksibel)',
    preset: 'front',
    wiring: 'Menghadap sisi depan (+Z) searah Watt Meter & SCC · Flip Single-Axis 15° ↔ 90° ↔ 165° → JBox → Watt Meter'
  },
  wattmeter: {
    title: 'Watt Meter Digital Biru (0–60V / 0–100A)',
    preset: 'watt_scc',
    wiring: 'Posisi depan atas (di atas SCC): SOURCE (+/−) dari Panel Surya → LOAD (+/−) turun ke Terminal +PV− SCC'
  },
  scc: {
    title: 'Solar Charge Controller PWM Biru',
    preset: 'watt_scc',
    wiring: 'Posisi depan tengah (di bawah Watt Meter): +PV− (dari Watt Meter) · +BAT− (Aki INCOE 12V) · LOAD+ → INA219 VIN+ · LOAD− → XL4015 IN−'
  },
  ina219: {
    title: 'INA219 DC Current/Voltage Sensor (0x40)',
    preset: 'ina219',
    wiring: 'Jalur ukur 12V: SCC LOAD+ → VIN+ → Shunt R100 (0.1Ω) → VIN− → XL4015 IN+. Suplai & I2C: VCC→3.3V · GND→Common GND · SDA→GPIO21 · SCL→GPIO22.'
  },
  xl4015: {
    title: 'XL4015 CC/CV 5A (Merah)',
    preset: 'xl4015',
    wiring: 'IN+ dari INA219 VIN− (12V), IN− dari SCC LOAD− → atur 6V → OUT+ ke Servo Merah, OUT− ke Breadboard Common GND. Jangan sambung 6V ke ESP32!'
  },
  breadboard: {
    title: 'Breadboard Common GND (4 Kabel)',
    preset: 'breadboard',
    wiring: 'Menyatukan 4 kabel GND: INA219 GND, XL4015 OUT−, Servo MG996R (cokelat), dan ESP32 GND.'
  },
  esp32: {
    title: 'ESP32 NodeMCU-32S + GOOUUU V4',
    preset: 'esp_pins',
    wiring: 'Suplai 5V dari UPS QF-M6001-2 lewat Switch 5V (UPS+ → Switch → 5V, UPS− → GND). Matikan Switch (O) sebelum colok USB laptop untuk flash.'
  },
  rtc: {
    title: 'Tiny RTC I2C (DS1307 + CR2032)',
    preset: 'tiny_rtc',
    wiring: 'Nyambung langsung ke ESP32: SCL→GPIO22, SDA→GPIO21, VCC→3.3V, GND→ESP32 GND (SQ/DS/BAT kosong).'
  },
  ups_switch: {
    title: 'Switch Pengaman 5V UPS (KCD11 I/O)',
    preset: 'ups_switch',
    wiring: 'Terpasang seri di kabel merah UPS+ → GOOUUU V4 5V. Posisi I (ON) menyalurkan 5V UPS ke ESP32; posisi O (OFF) memutus 5V UPS agar aman flash ESP32 via USB laptop.'
  },
  ups: {
    title: 'UPS 5V QF-M6001-2 (2×18650)',
    preset: 'ups',
    wiring: 'USB-C 5V IN → Charger U1 (TP4056) & 2×18650 paralel (U2/U3 DW01+8205) → Boost 2R2/U4 → UPS+ (5V) → Switch 5V → ESP32 5V · UPS− → GND.'
  },
  ldr: {
    title: 'LDR 1 & LDR 2 + Sekat Hitam',
    preset: 'ldr',
    wiring: 'Semua kabel nyambung langsung ke ESP32: AO→GPIO34/35, VCC→3.3V, GND→ESP32 GND (pin DO kosong).'
  },
  servo: {
    title: 'Servo MG996R (Metal Gear)',
    preset: 'rear',
    wiring: 'Oranye → ESP32 GPIO18 · Merah → XL4015 OUT+ (6V) · Cokelat → Breadboard Common GND.'
  },
  battery: {
    title: 'Baterai INCOE SA-20 12V 22Ah VRLA',
    preset: 'power',
    wiring: 'Klip Buaya Merah (+) & Hitam (−) terhubung langsung ke terminal +BAT− Solar Charge Controller'
  }
};

function detectSoftwareWebGL() {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return { unavailable: true, isSoftwareGl: true };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return {
      unavailable: false,
      isSoftwareGl: /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu)
    };
  } catch {
    return { unavailable: true, isSoftwareGl: true };
  }
}

function createSkyGradientTexture(topHex, midHex, botHex) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, topHex);
  g.addColorStop(0.55, midHex);
  g.addColorStop(1.0, botHex);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class SolarTrackerDigitalTwin {
  constructor() {
    this.fullMount = document.getElementById('rig3dFullMount');
    this.loadingEl = document.getElementById('rig3dLoading');
    this.hotspotLayer = document.getElementById('rig3dHotspotLayer');
    this.pinCalloutLayer = document.getElementById('rig3dPinCalloutLayer');
    this.hoverTipEl = document.getElementById('rig3dHoverTip');

    if (!this.fullMount) return;

    const probe = detectSoftwareWebGL();
    if (probe.unavailable) {
      this.renderFallbackMessage('WebGL tidak tersedia di browser ini.');
      return;
    }
    this.isSoftwareGl = probe.isSoftwareGl;

    this.slot = 'hidden'; // 'full' | 'hidden' (3D renders exclusively in Tab 4 Rendering 3D)
    this.envMode = 'outdoor'; // 'outdoor' | 'workshop'
    this.lightTestMode = false;
    this.showHotspots = true;
    this.showPinLabels = false;
    this.activeMacroGroup = null;
    this.wiringHighlight = false;
    this.focusedWireNet = null;
    this.selectedHotspot = null;
    this.selectedWireId = null;
    this.selectedPinId = null;
    this.sideCollapsed = false;
    this.sidePanelTab = 'focus';
    this.helpOpen = false;
    this.upsSwitchOn = true;

    this.stageHistory = this.loadStageHistory();
    this.currentStage = this.stageHistory.currentStage;

    this.inspHistory = [];
    this.currentInspState = null;
    this.currentInspFocusFn = null;

    this.manualLightDeg = 90;
    this.manualLightEl = 44;
    this.lastLightPostMs = 0;
    this.pendingLightSyncTimer = 0;
    this.lastHoverCheckMs = 0;

    this.lastStatus = null;
    this.lastElec = computeElectricalEstimate(null, 0, null);
    this.curServoDeg = 90;
    this.curTrimDeg = 0;
    this.curLightPos = new THREE.Vector3(0.1, 2.8, 1.6);
    this.targetLightPos = new THREE.Vector3(0.1, 2.8, 1.6);

    this.camFlyTargetPos = null;
    this.camFlyTargetLook = null;
    this.camVelocity = new THREE.Vector3();
    this.freeMoveImpulse = new THREE.Vector3();
    this.freeZoomImpulse = 0;
    this.keysHeld = new Set();
    this.navHeld = new Set();
    this.draggingLight = false;
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.1);

    this.frameId = 0;
    this.running = false;
    this.activeUntilMs = 0;
    this.lastFrameTime = performance.now();
    this.contextLost = false;

    this.sceneReady = false;
    this.sceneResourcesReady = false;
    this.sceneBuilding = false;
    this.sceneWarmed = false;
    this.hasRenderedScene = false;
    this.scenePreparationFailed = false;
    this._sceneResourceToken = 0;
    this._sceneWarmupFrameId = 0;
    this._sceneWarmupObjects = null;
    this._idleWarmupId = 0;
    this._idleWarmupIsRic = false;
    this._statusDirty = false;
    this._domRect = null;
    this._viewportW = 0;
    this._viewportH = 0;
    this._lastCanvasW = 0;
    this._lastCanvasH = 0;
    this._lastOverlaySig = '';
    this._renderedInspKey = '';
    this._hoverTipTitleEl = null;
    this._hoverTipSubEl = null;
    this._lastHoverTipKey = '';

    this._vec3 = new THREE.Vector3();
    this._vec3B = new THREE.Vector3();
    this._camFwd = new THREE.Vector3();
    this._camRight = new THREE.Vector3();
    this._moveVec = new THREE.Vector3();
    this._mouseNdc = new THREE.Vector2();
    this._raycaster = new THREE.Raycaster();
    this._upAxis = new THREE.Vector3(0, 1, 0);
    this._quat = new THREE.Quaternion();

    this.initRenderer();
    this.initHotspotDom();
    this.bindUiControls();
    this.syncBuildStageUi();

    const activeTab = document.querySelector('.nav-tab.active')?.dataset?.view || 'live';
    if (activeTab === 'twin3d') {
      this.setActiveView('twin3d');
    } else {
      this.scheduleIdleWarmup();
    }
  }

  scheduleIdleWarmup() {
    if (this.sceneReady || this.sceneBuilding || this._idleWarmupId) return;
    const run = () => {
      this._idleWarmupId = 0;
      if (!this.sceneReady && !this.sceneBuilding) {
        this.ensureSceneReady();
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      this._idleWarmupIsRic = true;
      this._idleWarmupId = window.requestIdleCallback(run, { timeout: 220 });
    } else {
      this._idleWarmupIsRic = false;
      this._idleWarmupId = window.setTimeout(run, 80);
    }
  }

  cancelIdleWarmup() {
    if (!this._idleWarmupId) return;
    if (this._idleWarmupIsRic && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(this._idleWarmupId);
    } else {
      clearTimeout(this._idleWarmupId);
    }
    this._idleWarmupId = 0;
  }

  ensureSceneReady() {
    if (this.sceneReady || this.sceneBuilding || !this.renderer) return;
    this.cancelIdleWarmup();
    this.sceneBuilding = true;
    try {
      this.initScene();
      this.initEnvironments();
      this.initRigAndLightVisuals();
      this.applyEnvironment(this.envMode);
      this.initControlsAndEvents();
      this.initPinCalloutDom(this.currentStage);
      this.applyBuildStageToScene({ focusCamera: false });

      if (this.lastStatus) {
        this.syncStatusToScene(this.lastStatus);
        this.curServoDeg = this.lastStatus.servo?.deg ?? 90;
        this.curTrimDeg = this.lastStatus.servo?.trim ?? 0;
        this.curLightPos.copy(this.targetLightPos);
      }

      this.handleResize(true);
      this.stepScene(0.016);
      this.prepareSceneResources();
      this.sceneReady = true;
    } finally {
      this.sceneBuilding = false;
    }
  }

  prepareSceneResources() {
    const token = ++this._sceneResourceToken;
    this.sceneResourcesReady = false;
    this.scenePreparationFailed = false;
    this.restoreSceneWarmup();

    const warm = () => {
      if (token !== this._sceneResourceToken || this.contextLost) return;
      this.warmSceneResources(token);
    };

    if (!this.contextLost && typeof this.renderer.compileAsync === 'function') {
      this.renderer.compileAsync(this.scene, this.camera).then(warm).catch((error) => {
        if (token !== this._sceneResourceToken || this.contextLost) return;
        this.failScenePreparation(error);
      });
      return;
    }

    try {
      if (!this.isSoftwareGl && !this.contextLost) {
        this.renderer.compile(this.scene, this.camera);
      }
      warm();
    } catch (error) {
      this.failScenePreparation(error);
    }
  }

  warmSceneResources(token) {
    if (this.sceneWarmed || this.contextLost) return;
    const objects = [];
    this.scene.traverseVisible((object) => {
      if (!object.isMesh || !object.visible || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material.visible !== false)) objects.push(object);
    });

    if (objects.length === 0) {
      this.sceneWarmed = true;
      this.sceneResourcesReady = true;
      if (this.slot === 'full') this.wakeRender(120);
      return;
    }

    this._sceneWarmupObjects = objects;
    for (const object of objects) object.visible = false;
    const batchSize = this.isSoftwareGl ? 12 : 24;
    let offset = 0;

    const drawNextBatch = () => {
      this._sceneWarmupFrameId = 0;
      if (token !== this._sceneResourceToken || this.contextLost) {
        this.restoreSceneWarmup();
        return;
      }

      const end = Math.min(offset + batchSize, objects.length);
      for (let i = offset; i < end; i++) objects[i].visible = true;
      try {
        this.renderer.render(this.scene, this.camera);
      } catch (error) {
        this.failScenePreparation(error);
        return;
      }
      for (let i = offset; i < end; i++) objects[i].visible = false;

      offset = end;
      if (offset < objects.length) {
        this._sceneWarmupFrameId = requestAnimationFrame(drawNextBatch);
        return;
      }

      this.restoreSceneWarmup();
      this.sceneWarmed = true;
      this.sceneResourcesReady = true;
      if (this.slot === 'full') this.wakeRender(120);
    };

    this._sceneWarmupFrameId = requestAnimationFrame(drawNextBatch);
  }

  restoreSceneWarmup() {
    if (this._sceneWarmupFrameId) cancelAnimationFrame(this._sceneWarmupFrameId);
    this._sceneWarmupFrameId = 0;
    if (this._sceneWarmupObjects) {
      for (const object of this._sceneWarmupObjects) object.visible = true;
    }
    this._sceneWarmupObjects = null;
  }

  failScenePreparation(error) {
    this.restoreSceneWarmup();
    this.sceneResourcesReady = false;
    this.scenePreparationFailed = true;
    this.setLoadingState(false);
    this.renderFallbackMessage('Gagal menyiapkan rendering 3D. Periksa dukungan WebGL lalu muat ulang halaman.');
    console.error('Failed to prepare SolarTracker 3D scene.', error);
  }

  loadStageHistory() {
    try {
      const raw = window.localStorage.getItem(STAGE_STORAGE_KEY);
      if (!raw) return createStageHistoryState(FULL_BUILD_STAGE);
      const parsed = JSON.parse(raw);
      return createStageHistoryState(parsed?.currentStage, parsed?.undoStack, parsed?.redoStack);
    } catch {
      return createStageHistoryState(FULL_BUILD_STAGE);
    }
  }

  saveStageHistory() {
    try {
      window.localStorage.setItem(STAGE_STORAGE_KEY, JSON.stringify(this.stageHistory));
    } catch {
      // Ignore storage quota / restricted context errors
    }
  }

  renderFallbackMessage(msg) {
    const html = `<div class="rig3d-fallback">${msg}</div>`;
    if (this.fullMount) this.fullMount.innerHTML = html;
  }

  setLoadingState(loading) {
    if (this.loadingEl) this.loadingEl.hidden = !loading;
    if (this.fullMount) this.fullMount.setAttribute('aria-busy', loading ? 'true' : 'false');
    const stage = this.fullMount?.closest('.rig3d-stage');
    if (stage) stage.classList.toggle('is-loading', loading);
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'rig3d-canvas';
    if (this.fullMount && this.renderer.domElement.parentNode !== this.fullMount) {
      this.fullMount.appendChild(this.renderer.domElement);
    }

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this._sceneResourceToken++;
      this.restoreSceneWarmup();
      this.sceneWarmed = false;
      this.sceneResourcesReady = false;
      this.hasRenderedScene = false;
      this.setLoadingState(this.slot === 'full');
      this.stopLoop();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      if (this.slot !== 'hidden') {
        this.setLoadingState(true);
      }
      this.prepareSceneResources();
    });
  }

  initScene() {
    this.scene = new THREE.Scene();

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(38, 1.6, 0.02, 60);
    this.camera.position.set(...CAMERA_PRESETS.overview.pos);

    this.hemiLight = new THREE.HemisphereLight(0xd9ecff, 0x8f8a7c, 0.90);
    this.hemiLight.position.set(0, 12, 0);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.keyLight.position.set(2.2, 4.2, 2.5);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 14;
    const d = 2.6;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.target.position.set(0, 1.0, 0);
    this.scene.add(this.keyLight, this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(0xc4dbff, 0.72);
    this.rimLight.position.set(-2.5, 2.8, -2.6);
    this.scene.add(this.rimLight);

    // Front fill so Watt Meter, SCC, Red XL4015, Breadboard & ESP32 pins look crisp & legible
    this.benchFillLight = new THREE.DirectionalLight(0xeef6ff, 0.58);
    this.benchFillLight.position.set(0.3, 1.9, 2.6);
    this.scene.add(this.benchFillLight);
  }

  initEnvironments() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    this.outdoorGroup = new THREE.Group();
    this.outdoorGroup.name = 'OutdoorEnvironment';
    this.scene.add(this.outdoorGroup);

    this.skyTexDay = createSkyGradientTexture('#4d8fe3', '#a9d0f5', '#dce9f5');
    this.skyTexSunset = createSkyGradientTexture('#2d4a7c', '#d8875a', '#f2cba2');
    this.skyTexNight = createSkyGradientTexture('#0b1328', '#152344', '#1d2d52');

    this.skyDomeMat = new THREE.MeshBasicMaterial({
      map: this.skyTexDay,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(24, 28, 18), this.skyDomeMat);
    this.outdoorGroup.add(skyDome);

    const outdoorGroundTex = createOutdoorGroundTexture(maxAniso);
    const outdoorFloor = new THREE.Mesh(
      new THREE.CircleGeometry(18, 48),
      new THREE.MeshStandardMaterial({
        map: outdoorGroundTex,
        roughness: 0.88,
        metalness: 0.04
      })
    );
    outdoorFloor.rotation.x = -Math.PI / 2;
    outdoorFloor.receiveShadow = true;
    this.outdoorGroup.add(outdoorFloor);

    const ringGeo = new THREE.RingGeometry(0.92, 0.945, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x3b6ea5,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const compassRing = new THREE.Mesh(ringGeo, ringMat);
    compassRing.rotation.x = -Math.PI / 2;
    compassRing.position.y = 0.004;
    this.outdoorGroup.add(compassRing);

    this.workshopGroup = new THREE.Group();
    this.workshopGroup.name = 'WorkshopEnvironment';
    this.scene.add(this.workshopGroup);

    const workshopFloorTex = createWorkshopFloorTexture(maxAniso);
    const workshopFloor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48),
      new THREE.MeshStandardMaterial({
        map: workshopFloorTex,
        roughness: 0.36,
        metalness: 0.06
      })
    );
    workshopFloor.rotation.x = -Math.PI / 2;
    workshopFloor.receiveShadow = true;
    this.workshopGroup.add(workshopFloor);

    const safetyStripe = new THREE.Mesh(
      new THREE.PlaneGeometry(6.8, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xe3b422, roughness: 0.45 })
    );
    safetyStripe.rotation.x = -Math.PI / 2;
    safetyStripe.position.set(0, 0.004, -2.35);
    this.workshopGroup.add(safetyStripe);

    const blueWallMat = new THREE.MeshStandardMaterial({ color: 0x11588f, roughness: 0.68, metalness: 0.04 });
    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.95, 3.6, 0.95), blueWallMat);
    leftPillar.position.set(-2.85, 1.8, -2.85);
    leftPillar.receiveShadow = true;
    const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.95, 3.6, 0.95), blueWallMat);
    rightPillar.position.set(2.85, 1.8, -2.85);
    rightPillar.receiveShadow = true;
    this.workshopGroup.add(leftPillar, rightPillar);
  }

  initRigAndLightVisuals() {
    this.rig = buildSolarTrackerRig(this.renderer, this.isSoftwareGl);
    this.scene.add(this.rig.root);

    this.lightHandleGroup = new THREE.Group();
    this.lightHandleGroup.name = 'LightSourceHandle';
    this.scene.add(this.lightHandleGroup);

    this.sunVisual = new THREE.Group();
    const sunCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xffe48f })
    );
    const sunHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.135, 0.165, 32),
      new THREE.MeshBasicMaterial({ color: 0xffc145, transparent: true, opacity: 0.65, side: THREE.DoubleSide })
    );
    this.sunHalo = sunHalo;
    this.sunVisual.add(sunCore, sunHalo);
    this.lightHandleGroup.add(this.sunVisual);

    this.lampVisual = new THREE.Group();
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.35, metalness: 0.72 });
    const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.046, 0.22, 16), lampMat);
    lampBody.rotation.x = Math.PI / 2;
    const lampLens = new THREE.Mesh(
      new THREE.CircleGeometry(0.042, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff8dc })
    );
    lampLens.position.z = 0.112;
    this.lampVisual.add(lampBody, lampLens);
    this.lightHandleGroup.add(this.lampVisual);

    this.lightPickProxy = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 12),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.lightHandleGroup.add(this.lightPickProxy);

    const beamGeo = new THREE.CylinderGeometry(0.014, 0.16, 1, 16, 1, true);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xffdf78,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.lightBeam = new THREE.Mesh(beamGeo, this.beamMat);
    this.scene.add(this.lightBeam);

    const arcPts = [];
    for (let deg = 15; deg <= 165; deg += 5) {
      const p = lightArcToWorldPos(deg, 44, 1.65, 1.48);
      arcPts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
    this.guideArc = new THREE.Line(
      arcGeo,
      new THREE.LineBasicMaterial({ color: 0xff9f0a, transparent: true, opacity: 0.62 })
    );
    this.guideArc.visible = false;
    this.scene.add(this.guideArc);
  }

  raycastInteractiveTarget(event) {
    this.updateMouseNdc(event);

    // Priority 1: Exact Physical Pin / Screw Terminal
    this._raycaster.layers.set(PIN_HIT_LAYER);
    this._raycaster.setFromCamera(this._mouseNdc, this.camera);
    const pinHits = this._raycaster.intersectObjects(this.rig.pinHitProxies, false);
    const validPinHit = pinHits.find((h) => h.object.visible && h.object.userData.stageVisible !== false && h.object.userData.pinData);
    if (validPinHit) {
      return { type: 'pin', data: validPinHit.object.userData.pinData };
    }

    // Priority 2: Any 3D Wire Cable
    this._raycaster.layers.set(WIRE_HIT_LAYER);
    this._raycaster.setFromCamera(this._mouseNdc, this.camera);
    const wireHits = this._raycaster.intersectObjects(this.rig.wireHitProxies, false);
    const validWireHit = wireHits.find((h) => h.object.visible && h.object.userData.stageVisible !== false && h.object.userData.wireSpec);
    if (validWireHit) {
      return { type: 'wire', data: validWireHit.object.userData.wireSpec };
    }

    // Priority 3: Component Body Hotspot
    this._raycaster.layers.set(HOTSPOT_LAYER);
    this._raycaster.setFromCamera(this._mouseNdc, this.camera);
    const hotHits = this._raycaster.intersectObjects(this.rig.hotspotProxies, false);
    const validHotHit = hotHits.find((h) => h.object.visible && h.object.userData.stageVisible !== false && h.object.userData.hotspotId);
    if (validHotHit) {
      return { type: 'hotspot', data: validHotHit.object.userData.hotspotId };
    }

    return null;
  }

  getCachedDomRect() {
    if (!this._domRect && this.fullMount) {
      this._domRect = this.fullMount.getBoundingClientRect();
    }
    return this._domRect;
  }

  showHoverTip(event, titleText, subText) {
    if (!this.hoverTipEl || !this.fullMount) return;
    const rect = this.getCachedDomRect();
    if (!rect || rect.width < 10) return;
    const x = clamp(event.clientX - rect.left + 14, 12, Math.max(20, rect.width - 280));
    const y = clamp(event.clientY - rect.top - 12, 12, Math.max(20, rect.height - 64));
    if (!this._hoverTipTitleEl) {
      this.hoverTipEl.innerHTML = '<div class="hover-tip-title"></div><div class="hover-tip-sub"></div>';
      this._hoverTipTitleEl = this.hoverTipEl.firstElementChild;
      this._hoverTipSubEl = this.hoverTipEl.lastElementChild;
    }
    const tipKey = `${titleText}|${subText}`;
    if (tipKey !== this._lastHoverTipKey) {
      this._lastHoverTipKey = tipKey;
      this._hoverTipTitleEl.textContent = titleText || '';
      this._hoverTipSubEl.textContent = subText || '';
    }
    this.hoverTipEl.style.transform = `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, 0)`;
    if (this.hoverTipEl.style.display !== 'block') {
      this.hoverTipEl.style.display = 'block';
    }
  }

  hideHoverTip() {
    if (this.hoverTipEl && this.hoverTipEl.style.display !== 'none') {
      this.hoverTipEl.style.display = 'none';
    }
  }

  initControlsAndEvents() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.11;
    this.controls.screenSpacePanning = true;
    // Disable zoomToCursor to eliminate OrbitControls cursor-ray jitter/shake during scroll zoom
    this.controls.zoomToCursor = false;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 8.5;
    // Full freeform 360° spherical orbit without fighting floor clamp
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = Math.PI - 0.02;
    this.controls.zoomSpeed = 1.08;
    this.controls.panSpeed = 1.35;
    this.controls.rotateSpeed = 0.98;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN
    };
    this.controls.target.set(...CAMERA_PRESETS.overview.target);

    this.controls.addEventListener('start', () => {
      this.camFlyTargetPos = null;
      this.camFlyTargetLook = null;
      this.camVelocity.set(0, 0, 0);
      this.hideHoverTip();
      this.wakeRender(450);
    });
    this.controls.addEventListener('change', () => {
      if (this.slot === 'full') this.wakeRender(280);
    });
    this.controls.addEventListener('end', () => {
      if (this.slot === 'full') this.wakeRender(400);
    });

    const dom = this.renderer.domElement;
    // Cancel camera fly-to on wheel. Plain scroll = smooth shake-free OrbitControls zoom.
    // Shift+Scroll = smooth freeform Maju/Mundur along camera look direction.
    // Alt+Scroll = smooth freeform Naik/Turun (vertical elevator).
    dom.addEventListener('wheel', (e) => {
      if (this.slot !== 'full') return;
      this.camFlyTargetPos = null;
      this.camFlyTargetLook = null;
      this.camVelocity.set(0, 0, 0);
      this.hideHoverTip();
      this.wakeRender(450);
      if (e.shiftKey || e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const dist = this.camera.position.distanceTo(this.controls.target);
        const dir = e.deltaY < 0 ? 1 : -1;
        const step = dir * clamp(dist * 0.18, 0.04, 0.40);
        if (e.altKey) {
          this.queueFreeformMove(0, step, 0);
        } else {
          this.queueFreeformMove(0, 0, step);
        }
      }
    }, { passive: false, capture: true });

    // Double-click any visible 3D object, wire, or pin to smoothly re-center the orbit pivot there
    dom.addEventListener('dblclick', (e) => {
      if (this.slot !== 'full' || this.draggingLight) return;
      e.preventDefault();
      this.updateMouseNdc(e);
      this._raycaster.layers.set(0);
      this._raycaster.setFromCamera(this._mouseNdc, this.camera);
      const hits = this._raycaster.intersectObject(this.rig.root, true);
      const visibleHit = hits.find((h) => {
        let cur = h.object;
        while (cur) {
          if (!cur.visible) return false;
          cur = cur.parent;
        }
        return true;
      });
      if (visibleHit) {
        const pt = visibleHit.point;
        this.focusOrbitPivotOnPoint([pt.x, pt.y, pt.z]);
        return;
      }
      const target = this.raycastInteractiveTarget(e);
      if (target?.type === 'pin') {
        this.focusOrbitPivotOnPoint(target.data.pos);
      } else if (target?.type === 'wire') {
        const pts = target.data.points;
        this.focusOrbitPivotOnPoint(pts[Math.floor(pts.length / 2)]);
      }
    });

    let downX = 0;
    let downY = 0;
    let isPointerDown = false;
    let lastHoverSig = '';

    dom.addEventListener('pointerdown', (e) => {
      if (this.slot !== 'full') return;
      isPointerDown = true;
      downX = e.clientX;
      downY = e.clientY;
      this.hideHoverTip();
      this.wakeRender(300);

      if (this.lightTestMode) {
        this.updateMouseNdc(e);
        this._raycaster.layers.set(0);
        this._raycaster.setFromCamera(this._mouseNdc, this.camera);
        const hits = this._raycaster.intersectObject(this.lightPickProxy, false);
        if (hits.length > 0) {
          this.draggingLight = true;
          this.controls.enabled = false;
          dom.style.cursor = 'grabbing';
          const camDir = this._vec3B;
          this.camera.getWorldDirection(camDir);
          this.dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), this.lightHandleGroup.position);
          return;
        }
      }
    });

    dom.addEventListener('pointermove', (e) => {
      if (this.slot !== 'full') return;
      if (this.draggingLight) {
        this.updateMouseNdc(e);
        this._raycaster.setFromCamera(this._mouseNdc, this.camera);
        const hitPt = this._vec3;
        if (this._raycaster.ray.intersectPlane(this.dragPlane, hitPt)) {
          hitPt.y = clamp(hitPt.y, 1.25, 3.4);
          hitPt.x = clamp(hitPt.x, -2.5, 2.5);
          hitPt.z = clamp(hitPt.z, 0.25, 2.6);
          const arc = worldPosToLightArc(hitPt, 1.48);
          this.setManualLightAngle(arc.lightDeg, arc.elevationDeg, true);
        }
        return;
      }

      if (isPointerDown || e.target !== dom) return;

      const now = performance.now();
      if (now - this.lastHoverCheckMs < 45) return;
      this.lastHoverCheckMs = now;

      const hit = this.raycastInteractiveTarget(e);
      if (hit?.type === 'pin') {
        const pin = hit.data;
        const sig = `pin:${pin.id}`;
        if (sig !== lastHoverSig) {
          lastHoverSig = sig;
          dom.style.cursor = 'pointer';
          this.rig.setHoverPreview(pin.wireIds?.[0] || null, pin.pos);
          this.wakeRender(160);
        }
        const targetTxt = pin.connectedTo?.[0] || 'Kosong';
        this.showHoverTip(e, `${pin.board} · ${pin.pinName}`, `Nyambung ke: ${targetTxt} · Klik detail`);
      } else if (hit?.type === 'wire') {
        const w = hit.data;
        const sig = `wire:${w.id}`;
        if (sig !== lastHoverSig) {
          lastHoverSig = sig;
          dom.style.cursor = 'pointer';
          this.rig.setHoverPreview(w.id, null);
          this.wakeRender(160);
        }
        this.showHoverTip(e, `${w.fromPin} → ${w.toPin}`, `${w.voltage} · Klik untuk detail`);
      } else if (hit?.type === 'hotspot') {
        const sig = `hot:${hit.data}`;
        if (sig !== lastHoverSig) {
          lastHoverSig = sig;
          dom.style.cursor = 'pointer';
          this.rig.setHoverPreview(null, null);
          this.wakeRender(160);
        }
        const meta = HOTSPOT_META[hit.data];
        if (meta) {
          this.showHoverTip(e, meta.title, 'Klik komponen untuk fokus kamera & detail pin');
        }
      } else {
        if (lastHoverSig !== '') {
          lastHoverSig = '';
          dom.style.cursor = '';
          this.rig.setHoverPreview(null, null);
          this.wakeRender(120);
        }
        this.hideHoverTip();
      }
    });

    dom.addEventListener('pointerleave', () => {
      isPointerDown = false;
      this.hideHoverTip();
      if (lastHoverSig !== '') {
        lastHoverSig = '';
        dom.style.cursor = '';
        if (this.rig) this.rig.setHoverPreview(null, null);
        this.wakeRender(120);
      }
    });

    const endDrag = (e) => {
      isPointerDown = false;
      if (this.draggingLight) {
        this.draggingLight = false;
        this.controls.enabled = true;
        dom.style.cursor = '';
        this.flushManualLightSync();
        this.wakeRender(300);
        return;
      }
      if (this.slot !== 'full') return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
        const hit = this.raycastInteractiveTarget(e);
        if (hit?.type === 'pin') {
          this.selectPin(hit.data.id);
        } else if (hit?.type === 'wire') {
          this.selectWire(hit.data.id);
        } else if (hit?.type === 'hotspot') {
          this.selectHotspot(hit.data);
        }
      }
      this.wakeRender(300);
    };
    dom.addEventListener('pointerup', endDrag);
    dom.addEventListener('pointercancel', endDrag);

    this.resizeObserver = new ResizeObserver(() => {
      this._domRect = null;
      this.handleResize();
    });
    if (this.fullMount) this.resizeObserver.observe(this.fullMount);
    window.addEventListener('resize', () => {
      this._domRect = null;
      this.handleResize();
    }, { passive: true });
  }

  initHotspotDom() {
    if (!this.hotspotLayer) return;
    this.hotspotLayer.innerHTML = '';
    this.hotspotButtons = {};
    const labels = {
      panel: 'Panel Surya',
      wattmeter: 'Watt Meter',
      scc: 'Charge Ctrl',
      ina219: 'INA219 (12V)',
      xl4015: 'XL4015 Merah',
      breadboard: 'Breadboard GND',
      esp32: 'ESP32 + GOOUUU',
      rtc: 'Tiny RTC',
      ups_switch: 'Switch 5V UPS',
      ups: 'UPS 5V (2×18650)',
      ldr: 'Sekat LDR',
      servo: 'Servo MG996R',
      battery: 'Aki INCOE'
    };
    for (const [id, label] of Object.entries(labels)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rig3d-pin';
      btn.dataset.hotspot = id;
      btn.textContent = label;
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'none';
      btn._ox = null;
      btn._oy = null;
      btn._ovis = false;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectHotspot(id);
      });
      this.hotspotLayer.appendChild(btn);
      this.hotspotButtons[id] = btn;
    }
  }

  initPinCalloutDom(stage = this.currentStage) {
    if (!this.pinCalloutLayer) return;
    const callouts = buildMacroPinCallouts(stage);
    const frag = document.createDocumentFragment();
    this.pinCalloutNodes = [];
    for (const item of callouts) {
      const el = document.createElement('div');
      el.className = 'rig3d-pin-callout mono';
      el.dataset.pinGroup = item.group;
      el.style.borderLeftColor = item.color;
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
      el.style.display = 'block';
      el.textContent = item.label;
      frag.appendChild(el);
      this.pinCalloutNodes.push({
        ...item,
        anchorVec: new THREE.Vector3(item.pos[0], item.pos[1] + 0.006, item.pos[2]),
        el,
        _ox: null,
        _oy: null,
        _ovis: false
      });
    }
    this.pinCalloutLayer.replaceChildren(frag);
    this.pinCalloutLayer.style.display = this.showPinLabels ? 'block' : 'none';
    this._lastOverlaySig = '';
  }

  setPinLabelsVisible(active, macroGroup = null) {
    this.showPinLabels = !!active;
    this.activeMacroGroup = macroGroup;
    const btn = document.getElementById('btnTogglePinLabels');
    if (btn) btn.classList.toggle('active', this.showPinLabels);
    if (this.pinCalloutLayer) {
      this.pinCalloutLayer.style.display = this.showPinLabels ? 'block' : 'none';
      this._lastOverlaySig = '';
      if (this.showPinLabels && this.sceneReady) {
        this.updateProjectedOverlays(true);
      }
    }
  }

  pushCurrentToHistory(nextState) {
    const cur = this.currentInspState;
    if (!cur || !nextState) return;
    if (cur.type === nextState.type && cur.id === nextState.id) return;
    this.inspHistory.push(cur);
    if (this.inspHistory.length > 16) this.inspHistory.shift();
  }

  updateInspActionButtons() {
    const btnBack = document.getElementById('btnInspBack');
    const btnFocus = document.getElementById('btnInspFocus');
    if (btnBack) {
      btnBack.style.display = this.inspHistory.length > 0 ? 'inline-flex' : 'none';
    }
    if (btnFocus) {
      btnFocus.style.display = this.currentInspFocusFn ? 'inline-flex' : 'none';
    }
  }

  goBackInspector() {
    const prev = this.inspHistory.pop();
    if (!prev) {
      this.updateInspActionButtons();
      return;
    }
    if (prev.type === 'wire') {
      this.selectWire(prev.id, true, true);
    } else if (prev.type === 'pin') {
      this.selectPin(prev.id, true, true);
    } else if (prev.type === 'hotspot') {
      this.selectHotspot(prev.id, true);
    } else if (prev.type === 'net') {
      this.setWiringNetFocus(prev.id, true);
    }
  }

  renderInspectorCard({ targetKey = '', badgeText, badgeColor, voltageText, titleText, routeHtml, relatedHtml, descText, extraMetrics }) {
    if (!this._inspEls) {
      this._inspEls = {
        card: document.getElementById('rig3dInspector'),
        badgeEl: document.getElementById('rig3dInspBadge'),
        voltEl: document.getElementById('rig3dInspVolt'),
        titleEl: document.getElementById('rig3dInspTitle'),
        routeEl: document.getElementById('rig3dInspRoute'),
        relatedEl: document.getElementById('rig3dInspRelated'),
        metricsEl: document.getElementById('rig3dInspMetrics'),
        wiringEl: document.getElementById('rig3dInspWiring')
      };
    }
    const { card, badgeEl, voltEl, titleEl, routeEl, relatedEl, metricsEl, wiringEl } = this._inspEls;
    if (!card || !titleEl) return;

    const isSameTarget = Boolean(targetKey && this._renderedInspKey === targetKey && card.style.display === 'flex');

    if (isSameTarget) {
      if (titleEl.textContent !== (titleText || '--')) titleEl.textContent = titleText || '--';
      if (metricsEl) {
        const nextMetrics = extraMetrics || '';
        if (metricsEl.textContent !== nextMetrics) metricsEl.textContent = nextMetrics;
        const nextMetricsDisp = nextMetrics ? 'block' : 'none';
        if (metricsEl.style.display !== nextMetricsDisp) metricsEl.style.display = nextMetricsDisp;
      }
      if (wiringEl && wiringEl.textContent !== (descText || '')) {
        wiringEl.textContent = descText || '';
      }
      return;
    }

    this._renderedInspKey = targetKey || '';

    if (badgeEl) {
      badgeEl.textContent = badgeText || 'INSPEKSI';
      badgeEl.style.background = badgeColor || '#0f172a';
    }
    if (voltEl) {
      voltEl.textContent = voltageText || '';
      voltEl.style.display = voltageText ? 'inline-flex' : 'none';
    }
    titleEl.textContent = titleText || '--';

    const bindJumpTargets = (container) => {
      container.querySelectorAll('[data-jump-pin]').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const pid = btn.dataset.jumpPin;
          if (pid) this.selectPin(pid, true);
        });
      });
      container.querySelectorAll('[data-jump-wire]').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const wid = btn.dataset.jumpWire;
          if (wid) this.selectWire(wid, true);
        });
      });
      container.querySelectorAll('[data-jump-net]').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const nkey = btn.dataset.jumpNet;
          if (nkey) {
            this.setSidePanelTab('wires');
            this.setWiringNetFocus(nkey);
          }
        });
      });
      container.querySelectorAll('[data-toggle-ups-switch]').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.upsSwitchOn = !this.upsSwitchOn;
          if (this.rig?.setUpsSwitchState) {
            this.rig.setUpsSwitchState(this.upsSwitchOn);
          }
          this._renderedInspKey = '';
          this.refreshInspectorContent();
          this.wakeRender(250);
        });
      });
    };

    if (routeEl) {
      if (routeHtml) {
        routeEl.innerHTML = routeHtml;
        routeEl.style.display = 'flex';
        bindJumpTargets(routeEl);
      } else {
        routeEl.innerHTML = '';
        routeEl.style.display = 'none';
      }
    }

    if (relatedEl) {
      if (relatedHtml) {
        relatedEl.innerHTML = relatedHtml;
        relatedEl.style.display = 'flex';
        bindJumpTargets(relatedEl);
      } else {
        relatedEl.innerHTML = '';
        relatedEl.style.display = 'none';
      }
    }

    if (metricsEl) {
      metricsEl.textContent = extraMetrics || '';
      metricsEl.style.display = extraMetrics ? 'block' : 'none';
    }
    if (wiringEl) {
      wiringEl.textContent = descText || '';
    }
    this.updateInspActionButtons();
    card.style.display = 'flex';
  }

  clearSelection() {
    this.selectedHotspot = null;
    this.selectedWireId = null;
    this.selectedPinId = null;
    this.focusedWireNet = null;
    this.inspHistory = [];
    this.currentInspState = null;
    this.currentInspFocusFn = null;
    this._renderedInspKey = '';
    Object.values(this.hotspotButtons || {}).forEach((b) => b.classList.remove('selected'));
    document.querySelectorAll('[data-wire-net]').forEach((c) => {
      c.classList.toggle('active', (c.dataset.wireNet || '') === '');
    });
    if (this.rig) {
      this.rig.setSelectionHighlight([], null, []);
      this.rig.setWiringHighlight(this.wiringHighlight, null);
    }
    this.updateInspActionButtons();
    const card = document.getElementById('rig3dInspector');
    if (card) card.style.display = 'none';
    this.wakeRender(200);
  }

  focusOrbitPivotOnPoint(pt) {
    if (!pt || !this.camera || !this.controls) return;
    const target = new THREE.Vector3(pt[0], pt[1], pt[2]);
    const dir = this._vec3.subVectors(this.camera.position, this.controls.target);
    const curDist = dir.length();
    if (curDist > 1e-4) dir.normalize();
    else dir.set(0.25, 0.45, 0.85).normalize();

    const nextDist = clamp(curDist * 0.58, 0.24, 1.35);
    const pos = target.clone().addScaledVector(dir, nextDist);
    pos.y = Math.max(0.10, pos.y);
    this.camVelocity.set(0, 0, 0);
    this.freeMoveImpulse.set(0, 0, 0);
    this.camFlyTargetLook = target;
    this.camFlyTargetPos = pos;
    this.wakeRender(950);
  }

  focusCameraOnPoint(pt) {
    if (!pt) return;
    const p = new THREE.Vector3(pt[0], pt[1], pt[2]);
    const off = computeSmartCameraOffset(pt);
    this.camVelocity.set(0, 0, 0);
    this.freeMoveImpulse.set(0, 0, 0);
    this.camFlyTargetLook = p.clone();
    this.camFlyTargetPos = p.clone().add(new THREE.Vector3(off[0], off[1], off[2]));
    this.wakeRender(950);
  }

  focusCameraOnWire(wireSpec) {
    if (!wireSpec?.points) return;
    const framed = computeWireFrameCamera(wireSpec.points);
    this.camVelocity.set(0, 0, 0);
    this.freeMoveImpulse.set(0, 0, 0);
    this.camFlyTargetLook = new THREE.Vector3(...framed.target);
    this.camFlyTargetPos = new THREE.Vector3(...framed.pos);
    this.wakeRender(950);
  }

  getWiresInCategory(category) {
    if (!this.rig?.wireById || !category) return [];
    const list = [];
    for (const entry of this.rig.wireById.values()) {
      if (!entry.stageActive) continue;
      if (entry.spec.category === category || (Array.isArray(entry.nets) && entry.nets.includes(category))) {
        list.push(entry.spec);
      }
    }
    return list;
  }

  /**
   * Selects a single 3D wire cable, illuminates it + both endpoint pin rings,
   * and shows an ultra-readable Dari (Asal) -> Ke (Tujuan) card + sibling chain chips.
   */
  selectWire(wireId, flyToFrame = false, skipHistory = false) {
    if (!this.sceneReady) this.ensureSceneReady();
    const entry = this.rig?.wireById?.get(wireId);
    if (!entry || !entry.stageActive) return false;
    const w = entry.spec;

    if (!skipHistory) this.pushCurrentToHistory({ type: 'wire', id: wireId });
    this.currentInspState = { type: 'wire', id: wireId };
    this.currentInspFocusFn = () => this.focusCameraOnWire(w);

    this.selectedWireId = w.id;
    this.selectedPinId = null;
    this.selectedHotspot = null;
    this.focusedWireNet = null;
    Object.values(this.hotspotButtons || {}).forEach((b) => b.classList.remove('selected'));

    const startPt = w.points[0];
    const endPt = w.points[w.points.length - 1];
    this.rig.setSelectionHighlight([w.id], startPt, [endPt]);

    const netMeta = getWireNetMetaForStage(w.category, this.currentStage);
    const canJumpFrom = !!(w.fromPinId && this.rig.pinById.has(w.fromPinId));
    const canJumpTo = !!(w.toPinId && this.rig.pinById.has(w.toPinId));

    const fromEl = canJumpFrom
      ? `<button type="button" class="route-node route-origin" data-jump-pin="${escapeHtml(w.fromPinId)}" title="Klik untuk inspeksi pin asal"><span class="route-lbl">DARI</span><strong>${escapeHtml(w.fromPin)}</strong></button>`
      : `<span class="route-node route-origin"><span class="route-lbl">DARI</span><strong>${escapeHtml(w.fromPin)}</strong></span>`;
    const toEl = canJumpTo
      ? `<button type="button" class="route-node route-dest" data-jump-pin="${escapeHtml(w.toPinId)}" title="Klik untuk inspeksi pin tujuan"><span class="route-lbl">KE</span><strong>${escapeHtml(w.toPin)}</strong></button>`
      : `<span class="route-node route-dest"><span class="route-lbl">KE</span><strong>${escapeHtml(w.toPin)}</strong></span>`;

    const netWires = this.getWiresInCategory(w.category);
    let relatedHtml = '';
    if (netMeta) {
      const chips = netWires.map((nw) => {
        const activeCls = nw.id === w.id ? ' active' : '';
        return `<button type="button" class="insp-wire-chip${activeCls}" data-jump-wire="${escapeHtml(nw.id)}" title="Inspeksi kabel ${escapeHtml(nw.fromPin)} → ${escapeHtml(nw.toPin)}">${escapeHtml(nw.fromPin)} → ${escapeHtml(nw.toPin)}</button>`;
      }).join('');
      const netBtn = `<button type="button" class="insp-wire-chip" data-jump-net="${escapeHtml(w.category)}"><span class="wire-dot" style="background:${escapeHtml(netMeta.colorHex)}"></span>Sorot Jalur: ${escapeHtml(netMeta.label)}</button>`;
      const netLblText = /kabel/i.test(netMeta.label) ? netMeta.label : `${netMeta.label} (${netWires.length} kabel)`;
      relatedHtml = `<span class="insp-rel-lbl">Jalur ${escapeHtml(netLblText)}</span><div class="insp-rel-list">${chips}${netBtn}</div>`;
    }

    this.renderInspectorCard({
      targetKey: `wire:${w.id}:s${this.currentStage}`,
      badgeText: 'KABEL',
      badgeColor: netMeta?.colorHex || '#0284c7',
      voltageText: w.voltage,
      titleText: `${w.fromPin} → ${w.toPin}`,
      routeHtml: `${fromEl}<span class="route-arrow" aria-hidden="true">→</span>${toEl}`,
      relatedHtml,
      extraMetrics: '',
      descText: w.description
    });

    if (flyToFrame) {
      this.focusCameraOnWire(w);
    }
    this.wakeRender(250);
    return true;
  }

  /**
   * Selects any physical pin/screw terminal and shows ALL connected wires & target pins!
   */
  selectPin(pinId, flyCamera = false, skipHistory = false) {
    if (!this.sceneReady) this.ensureSceneReady();
    const pin = this.rig?.pinById?.get(pinId);
    if (!pin) return false;

    if (!skipHistory) this.pushCurrentToHistory({ type: 'pin', id: pinId });
    this.currentInspState = { type: 'pin', id: pinId };
    this.currentInspFocusFn = () => this.focusCameraOnPoint(pin.pos);

    this.selectedPinId = pin.id;
    this.selectedWireId = null;
    this.selectedHotspot = null;
    this.focusedWireNet = null;
    Object.values(this.hotspotButtons || {}).forEach((b) => b.classList.remove('selected'));

    const targetPositions = [];
    const connectedWires = [];
    for (const wid of (pin.wireIds || [])) {
      const entry = this.rig.wireById.get(wid);
      if (!entry || !entry.stageActive) continue;
      const w = entry.spec;
      if (w.fromPinId === pin.id) {
        targetPositions.push(w.points[w.points.length - 1]);
        connectedWires.push({ wire: w, targetLabel: w.toPin, targetPinId: w.toPinId });
      } else if (w.toPinId === pin.id) {
        targetPositions.push(w.points[0]);
        connectedWires.push({ wire: w, targetLabel: w.fromPin, targetPinId: w.fromPinId });
      } else {
        targetPositions.push(w.points[w.points.length - 1]);
        connectedWires.push({ wire: w, targetLabel: `${w.fromPin} → ${w.toPin}`, targetPinId: w.toPinId });
      }
    }

    this.rig.setSelectionHighlight(connectedWires.map((cw) => cw.wire.id), pin.pos, targetPositions);

    const originNode = `<span class="route-node route-origin"><span class="route-lbl">DARI PIN</span><strong>${escapeHtml(pin.board)} · ${escapeHtml(pin.pinName)}</strong></span>`;
    let destHtml = '';
    if (connectedWires.length === 1) {
      const first = connectedWires[0];
      const canJump = !!(first.targetPinId && this.rig.pinById.has(first.targetPinId));
      destHtml = canJump
        ? `<button type="button" class="route-node route-dest" data-jump-pin="${escapeHtml(first.targetPinId)}" title="Klik untuk lompat ke pin tujuan"><span class="route-lbl">KE</span><strong>${escapeHtml(first.targetLabel)}</strong></button>`
        : `<span class="route-node route-dest"><span class="route-lbl">KE</span><strong>${escapeHtml(first.targetLabel)}</strong></span>`;
    } else if (connectedWires.length > 1) {
      const first = connectedWires[0];
      const canJump = !!(first.targetPinId && this.rig.pinById.has(first.targetPinId));
      destHtml = canJump
        ? `<button type="button" class="route-node route-dest" data-jump-pin="${escapeHtml(first.targetPinId)}" title="Klik untuk lompat ke sambungan utama"><span class="route-lbl">KE (${connectedWires.length} KABEL)</span><strong>${escapeHtml(first.targetLabel)}</strong></button>`
        : `<span class="route-node route-dest"><span class="route-lbl">KE (${connectedWires.length} KABEL)</span><strong>${escapeHtml(first.targetLabel)}</strong></span>`;
    } else {
      destHtml = `<span class="route-node route-empty"><span class="route-lbl">STATUS</span><strong>${escapeHtml(pin.connectedTo?.[0] || 'Kosong')}</strong></span>`;
    }

    let relatedHtml = '';
    if (connectedWires.length > 0) {
      const chips = connectedWires.map(({ wire, targetLabel }) => {
        const netColor = getWireNetMetaForStage(wire.category, this.currentStage)?.colorHex || '#38bdf8';
        return `<button type="button" class="insp-wire-chip" data-jump-wire="${escapeHtml(wire.id)}" title="Inspeksi kabel (${escapeHtml(wire.voltage)})"><span class="wire-dot" style="background:${escapeHtml(netColor)}"></span>Kabel → ${escapeHtml(targetLabel)}</button>`;
      }).join('');
      relatedHtml = `<span class="insp-rel-lbl">Kabel Terhubung (${connectedWires.length})</span><div class="insp-rel-list">${chips}</div>`;
    }

    const isActive = pin.status === 'AKTIF';
    this.renderInspectorCard({
      targetKey: `pin:${pin.id}:s${this.currentStage}`,
      badgeText: isActive ? 'PIN' : 'PIN KOSONG',
      badgeColor: isActive ? '#059669' : '#d97706',
      voltageText: pin.voltage,
      titleText: `${pin.board} · ${pin.pinName}`,
      routeHtml: `${originNode}<span class="route-arrow" aria-hidden="true">→</span>${destHtml}`,
      relatedHtml,
      extraMetrics: '',
      descText: pin.detail
    });

    if (flyCamera) {
      this.focusCameraOnPoint(pin.pos);
    }
    this.wakeRender(250);
    return true;
  }

  setWiringNetFocus(netKey, skipHistory = false) {
    if (!this.sceneReady) this.ensureSceneReady();
    if (netKey && !isWireNetVisibleAtStage(netKey, this.currentStage)) {
      return;
    }
    this.focusedWireNet = netKey || null;
    this.selectedWireId = null;
    this.selectedPinId = null;

    if (this.focusedWireNet && !this.wiringHighlight) {
      this.wiringHighlight = true;
      const btnWiring = document.getElementById('btnToggleWiring');
      if (btnWiring) btnWiring.classList.add('active');
    }
    if (this.rig) {
      this.rig.setSelectionHighlight([], null, []);
      this.rig.setWiringHighlight(this.wiringHighlight, this.focusedWireNet);
    }

    document.querySelectorAll('[data-wire-net]').forEach((chip) => {
      const k = chip.dataset.wireNet || '';
      chip.classList.toggle('active', k === (this.focusedWireNet || ''));
    });

    const netMeta = this.focusedWireNet ? getWireNetMetaForStage(this.focusedWireNet, this.currentStage) : null;
    if (this.focusedWireNet && netMeta) {
      if (!skipHistory) this.pushCurrentToHistory({ type: 'net', id: this.focusedWireNet });
      this.currentInspState = { type: 'net', id: this.focusedWireNet };
      this.currentInspFocusFn = () => this.flyToPreset(netMeta.preset || 'overview');

      this.selectedHotspot = null;
      Object.values(this.hotspotButtons || {}).forEach((b) => b.classList.remove('selected'));
      if (netMeta.preset && isPresetVisibleAtStage(netMeta.preset, this.currentStage)) {
        this.flyToPreset(netMeta.preset);
        document.querySelectorAll('[data-3d-cam]').forEach((b) => {
          b.classList.toggle('active', b.dataset['3dCam'] === netMeta.preset);
        });
      }

      const netWires = this.getWiresInCategory(this.focusedWireNet);
      const chipsHtml = netWires.map((w) => (
        `<button type="button" class="insp-wire-chip" data-jump-wire="${escapeHtml(w.id)}"><span class="wire-dot" style="background:${escapeHtml(netMeta.colorHex)}"></span>${escapeHtml(w.fromPin)} → ${escapeHtml(w.toPin)}</button>`
      )).join('');
      const relatedHtml = netWires.length
        ? `<span class="insp-rel-lbl">Daftar Kabel di Jalur Ini (${netWires.length}) · Klik untuk Detail Dari → Ke</span><div class="insp-rel-list">${chipsHtml}</div>`
        : '';

      this.renderInspectorCard({
        targetKey: `net:${this.focusedWireNet}:s${this.currentStage}`,
        badgeText: 'JALUR KABEL',
        badgeColor: netMeta.colorHex,
        voltageText: '',
        titleText: netMeta.label,
        routeHtml: '',
        relatedHtml,
        extraMetrics: netMeta.pins,
        descText: netMeta.summary
      });
    } else if (!this.selectedHotspot) {
      this.currentInspState = null;
      this.currentInspFocusFn = null;
      this._renderedInspKey = '';
      this.updateInspActionButtons();
      const card = document.getElementById('rig3dInspector');
      if (card) card.style.display = 'none';
    }
    this.wakeRender(300);
  }

  setSidePanelTab(tabName) {
    const next = (tabName === 'wires' || tabName === 'stages') ? tabName : 'focus';
    this.sidePanelTab = next;
    document.querySelectorAll('[data-panel-tab]').forEach((btn) => {
      const active = btn.dataset.panelTab === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-panel-pane]').forEach((pane) => {
      pane.classList.toggle('active', pane.dataset.panelPane === next);
    });
  }

  checkoutStage(nextStage, { recordHistory = true, focusCamera = true, force = false } = {}) {
    if (!this.sceneReady && !this.sceneBuilding) this.ensureSceneReady();
    if (recordHistory) {
      const next = checkoutStageInHistory(this.stageHistory, nextStage);
      if (!next.changed && !force) return false;
      this.stageHistory = {
        currentStage: next.currentStage,
        undoStack: next.undoStack,
        redoStack: next.redoStack
      };
    } else {
      this.stageHistory = createStageHistoryState(nextStage, this.stageHistory.undoStack, this.stageHistory.redoStack);
    }
    this.currentStage = this.stageHistory.currentStage;
    this.saveStageHistory();
    this.applyBuildStageToScene({ focusCamera });
    return true;
  }

  undoStage() {
    if (!this.sceneReady && !this.sceneBuilding) this.ensureSceneReady();
    const next = undoStageInHistory(this.stageHistory);
    if (!next.changed) return false;
    this.stageHistory = {
      currentStage: next.currentStage,
      undoStack: next.undoStack,
      redoStack: next.redoStack
    };
    this.currentStage = next.currentStage;
    this.saveStageHistory();
    this.applyBuildStageToScene({ focusCamera: false });
    return true;
  }

  redoStage() {
    if (!this.sceneReady && !this.sceneBuilding) this.ensureSceneReady();
    const next = redoStageInHistory(this.stageHistory);
    if (!next.changed) return false;
    this.stageHistory = {
      currentStage: next.currentStage,
      undoStack: next.undoStack,
      redoStack: next.redoStack
    };
    this.currentStage = next.currentStage;
    this.saveStageHistory();
    this.applyBuildStageToScene({ focusCamera: false });
    return true;
  }

  applyBuildStageToScene({ focusCamera = false } = {}) {
    if (!this.rig) {
      this.syncBuildStageUi();
      return;
    }
    const s = this.currentStage;
    if (this.rig?.setBuildStage) {
      this.rig.setBuildStage(s);
    }
    this.initPinCalloutDom(s);
    this._renderedInspKey = '';
    this._lastOverlaySig = '';

    // Prune inspection history entries that belong to hidden future stages
    if (Array.isArray(this.inspHistory) && this.inspHistory.length > 0) {
      this.inspHistory = this.inspHistory.filter((item) => {
        if (item.type === 'hotspot') return isHotspotVisibleAtStage(item.id, s);
        if (item.type === 'wire') {
          const entry = this.rig?.wireById?.get(item.id);
          return !!(entry && entry.stageActive);
        }
        if (item.type === 'pin') return !!this.rig?.pinById?.has(item.id);
        if (item.type === 'net') return isWireNetVisibleAtStage(item.id, s);
        return false;
      });
    }

    if (this.selectedHotspot) {
      if (!isHotspotVisibleAtStage(this.selectedHotspot, s)) {
        this.clearSelection();
      } else {
        this.refreshInspectorContent();
      }
    } else if (this.selectedWireId) {
      const entry = this.rig?.wireById?.get(this.selectedWireId);
      if (!entry || !entry.stageActive) {
        this.clearSelection();
      } else {
        this.selectWire(this.selectedWireId, false, true);
      }
    } else if (this.selectedPinId) {
      if (!this.rig?.pinById?.has(this.selectedPinId)) {
        this.clearSelection();
      } else {
        this.selectPin(this.selectedPinId, false, true);
      }
    } else if (this.focusedWireNet) {
      if (!isWireNetVisibleAtStage(this.focusedWireNet, s)) {
        this.clearSelection();
      } else {
        this.setWiringNetFocus(this.focusedWireNet, true);
      }
    }

    this.syncBuildStageUi();

    if (focusCamera) {
      const meta = getBuildStageMeta(s);
      const preset = meta?.focusPreset;
      if (preset && isPresetVisibleAtStage(preset, s)) {
        this.flyToPreset(preset);
        document.querySelectorAll('[data-3d-cam]').forEach((b) => {
          b.classList.toggle('active', b.dataset['3dCam'] === preset);
        });
      }
    }

    if (this.slot === 'full' && !this.contextLost && this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
      this.updateProjectedOverlays(true);
      this.wakeRender(400);
    }
  }

  syncBuildStageUi() {
    const s = this.currentStage;
    const meta = getBuildStageMeta(s);
    const activeWires = (this.rig?.wireEntries || []).filter((w) => w.stageActive).length;
    const canUndo = (this.stageHistory?.undoStack?.length || 0) > 0;
    const canRedo = (this.stageHistory?.redoStack?.length || 0) > 0;

    const stageBar = document.getElementById('rig3dStageBar');
    if (stageBar) {
      stageBar.dataset.stage = String(s);
      stageBar.dataset.wireCount = String(activeWires);
    }
    const barCode = document.getElementById('stageBarCode');
    const barLabel = document.getElementById('stageBarLabel');
    if (barCode) barCode.textContent = `${meta.code}/${FULL_BUILD_STAGE}`;
    if (barLabel) barLabel.textContent = meta.shortLabel;

    for (const id of ['btnStageUndo', 'btnPanelStageUndo']) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !canUndo;
    }
    for (const id of ['btnStageRedo', 'btnPanelStageRedo']) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !canRedo;
    }
    const btnPrev = document.getElementById('btnStagePrev');
    const btnNext = document.getElementById('btnStageNext');
    const btnHead = document.getElementById('btnPanelStageHead');
    if (btnPrev) btnPrev.disabled = s <= MIN_BUILD_STAGE;
    if (btnNext) btnNext.disabled = s >= FULL_BUILD_STAGE;
    if (btnHead) btnHead.disabled = s >= FULL_BUILD_STAGE;

    // Immediately hide disallowed hotspot buttons so overlays never lag behind stage state
    if (this.hotspotButtons) {
      for (const [id, btn] of Object.entries(this.hotspotButtons)) {
        if (!isHotspotVisibleAtStage(id, s)) {
          btn.style.opacity = '0';
          btn.style.pointerEvents = 'none';
        }
      }
    }

    // Camera presets
    document.querySelectorAll('[data-3d-cam]').forEach((btn) => {
      const presetName = btn.dataset['3dCam'];
      const visible = isPresetVisibleAtStage(presetName, s);
      btn.disabled = !visible;
      btn.title = visible ? '' : 'Modul belum dipasang pada tahap rakit ini';
      if (!visible) btn.classList.remove('active');
    });

    // Wire net filter chips
    document.querySelectorAll('[data-wire-net]').forEach((chip) => {
      const nk = chip.dataset.wireNet || '';
      if (!nk) {
        chip.textContent = `Semua Kabel (${activeWires})`;
        chip.style.display = 'flex';
        return;
      }
      const vis = isWireNetVisibleAtStage(nk, s);
      chip.style.display = vis ? 'flex' : 'none';
      if (vis) {
        const netMeta = getWireNetMetaForStage(nk, s);
        if (netMeta) {
          chip.innerHTML = `<span class="wire-dot" style="background:${escapeHtml(netMeta.colorHex)}"></span>${escapeHtml(netMeta.label)}`;
        }
      }
    });

    // Git-style vertical commit rail inside Tahap Rakit tab
    const railEl = document.getElementById('rig3dStageRail');
    if (railEl) {
      railEl.innerHTML = BUILD_STAGES.map((st) => {
        const stateCls = st.index < s ? 'done' : (st.index === s ? 'active' : 'future');
        const headBadge = st.index === FULL_BUILD_STAGE ? ' · HEAD' : '';
        return `<button type="button" class="stage-commit-btn ${stateCls}" data-checkout-stage="${st.index}" role="listitem" aria-current="${st.index === s ? 'step' : 'false'}">
          <span class="stage-commit-node" aria-hidden="true"></span>
          <span class="stage-commit-body">
            <span class="stage-commit-top">
              <span class="stage-commit-tag mono">${escapeHtml(st.code)}${headBadge}</span>
              <span class="stage-commit-delta mono">${escapeHtml(st.wireDeltaLabel)}</span>
            </span>
            <span class="stage-commit-title">${escapeHtml(st.title)}</span>
            <span class="stage-commit-sub">${escapeHtml(st.modulesLabel)}</span>
          </span>
        </button>`;
      }).join('');

      railEl.querySelectorAll('[data-checkout-stage]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.checkoutStage);
          this.checkoutStage(idx, { recordHistory: true, focusCamera: true });
        });
      });
    }

    // Active stage wiring table & safety checklist
    const detailEl = document.getElementById('rig3dStageDetail');
    if (detailEl) {
      const rowsHtml = (meta.wiringRows || []).map((row) => (
        `<div class="stage-wire-row"><span class="stage-wire-from">${escapeHtml(row.from)}</span><span class="stage-wire-arrow" aria-hidden="true">→</span><span class="stage-wire-to">${escapeHtml(row.to)}</span></div>`
      )).join('');
      const stepsHtml = (meta.safetySteps || []).map((step, idx) => {
        const text = /^\d+\./.test(step.trim()) ? step : `${idx + 1}. ${step}`;
        return `<div>${escapeHtml(text)}</div>`;
      }).join('');
      detailEl.innerHTML = `
        <div class="stage-detail-head">
          <span class="stage-code mono">${escapeHtml(meta.code)}/5</span>
          <span class="stage-commit-delta mono">${activeWires} kabel aktif</span>
        </div>
        <div class="stage-detail-title">${escapeHtml(meta.title)}</div>
        <div class="stage-detail-summary">${escapeHtml(meta.summary)}</div>
        <div class="stage-wire-table" aria-label="Tabel Koneksi Tahap Ini">${rowsHtml}</div>
        <div class="stage-safety-box">
          <div class="stage-safety-title">${escapeHtml(meta.safetyTitle)}</div>
          <div class="stage-safety-warn">${escapeHtml(meta.safetyWarning)}</div>
          <div class="stage-safety-steps">${stepsHtml}</div>
        </div>
      `;
    }
  }

  resetCameraOverview() {
    this.camVelocity.set(0, 0, 0);
    this.freeMoveImpulse.set(0, 0, 0);
    this.freeZoomImpulse = 0;
    this.flyToPreset('overview');
    document.querySelectorAll('[data-3d-cam]').forEach((b) => {
      b.classList.toggle('active', b.dataset['3dCam'] === 'overview');
    });
  }

  bindUiControls() {
    // Collapsible ? Panduan camera help popover
    const btnCamHelp = document.getElementById('btnCamHelp');
    const helpPopover = document.getElementById('rig3dHelpPopover');
    if (btnCamHelp && helpPopover) {
      btnCamHelp.addEventListener('click', (e) => {
        e.stopPropagation();
        this.helpOpen = !this.helpOpen;
        helpPopover.style.display = this.helpOpen ? 'flex' : 'none';
        btnCamHelp.setAttribute('aria-expanded', String(this.helpOpen));
      });
    }

    // Side panel 2-tab switching (Fokus Area | Jalur Kabel)
    document.querySelectorAll('[data-panel-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setSidePanelTab(btn.dataset.panelTab);
      });
    });

    document.querySelectorAll('[data-3d-env]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.applyEnvironment(btn.dataset['3dEnv']);
        document.querySelectorAll('[data-3d-env]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
      });
    });

    document.querySelectorAll('[data-3d-cam]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const camName = btn.dataset['3dCam'];
        this.flyToPreset(camName);
        document.querySelectorAll('[data-3d-cam]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
      });
    });

    document.querySelectorAll('[data-3d-lightmode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wantTest = btn.dataset['3dLightmode'] === 'test';
        this.setLightTestMode(wantTest);
        document.querySelectorAll('[data-3d-lightmode]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
      });
    });

    const lightSlider = document.getElementById('rig3dLightSlider');
    if (lightSlider) {
      const onSliderUpdate = (immediate) => {
        if (!this.lightTestMode) this.setLightTestMode(true);
        this.setManualLightAngle(Number(lightSlider.value), this.manualLightEl, true, immediate);
      };
      lightSlider.addEventListener('input', () => onSliderUpdate(false));
      lightSlider.addEventListener('change', () => onSliderUpdate(true));
    }

    const btnHotspots = document.getElementById('btnToggleHotspots');
    if (btnHotspots) {
      btnHotspots.addEventListener('click', () => {
        this.showHotspots = !this.showHotspots;
        btnHotspots.classList.toggle('active', this.showHotspots);
        if (this.hotspotLayer) this.hotspotLayer.style.display = this.showHotspots ? 'block' : 'none';
        this._lastOverlaySig = '';
        if (this.showHotspots && this.sceneReady) this.updateProjectedOverlays(true);
      });
    }

    const btnPinLabels = document.getElementById('btnTogglePinLabels');
    if (btnPinLabels) {
      btnPinLabels.addEventListener('click', () => {
        this.setPinLabelsVisible(!this.showPinLabels, null);
      });
    }

    const btnWiring = document.getElementById('btnToggleWiring');
    if (btnWiring) {
      btnWiring.addEventListener('click', () => {
        this.wiringHighlight = !this.wiringHighlight;
        if (!this.wiringHighlight) {
          this.focusedWireNet = null;
          this.selectedWireId = null;
          this.selectedPinId = null;
        }
        btnWiring.classList.toggle('active', this.wiringHighlight);
        if (this.rig) this.rig.setWiringHighlight(this.wiringHighlight, this.focusedWireNet);
        document.querySelectorAll('[data-wire-net]').forEach((c) => {
          c.classList.toggle('active', (c.dataset.wireNet || '') === '');
        });
        this.wakeRender(200);
      });
    }

    const btnResetSel = document.getElementById('btnResetSelection');
    if (btnResetSel) {
      btnResetSel.addEventListener('click', () => {
        this.wiringHighlight = false;
        const btnW = document.getElementById('btnToggleWiring');
        if (btnW) btnW.classList.remove('active');
        this.clearSelection();
      });
    }

    document.querySelectorAll('[data-wire-net]').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = chip.dataset.wireNet || null;
        this.setWiringNetFocus(key);
      });
    });

    // Right-Side Collapsible Control Panel
    const sidePanel = document.getElementById('rig3dSidePanel');
    const btnSideToggle = document.getElementById('btnSidePanelToggle');
    const btnSideReopen = document.getElementById('btnSidePanelReopen');
    const navPad = document.getElementById('rig3dNavPad');
    const stageBar = document.getElementById('rig3dStageBar');
    const setSideCollapsed = (collapsed) => {
      this.sideCollapsed = !!collapsed;
      if (sidePanel) sidePanel.classList.toggle('collapsed', this.sideCollapsed);
      if (btnSideReopen) btnSideReopen.style.display = this.sideCollapsed ? 'inline-flex' : 'none';
      if (btnSideToggle) btnSideToggle.setAttribute('aria-expanded', String(!this.sideCollapsed));
      if (navPad) navPad.classList.toggle('side-hidden', this.sideCollapsed);
      if (stageBar) stageBar.classList.toggle('side-hidden', this.sideCollapsed);
    };
    if (btnSideToggle) btnSideToggle.addEventListener('click', () => setSideCollapsed(true));
    if (btnSideReopen) btnSideReopen.addEventListener('click', () => setSideCollapsed(false));

    // Git-style Undo / Redo & Step-by-Step Build Stage Controls
    for (const id of ['btnStageUndo', 'btnPanelStageUndo']) {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => this.undoStage());
    }
    for (const id of ['btnStageRedo', 'btnPanelStageRedo']) {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => this.redoStage());
    }
    const btnStagePrev = document.getElementById('btnStagePrev');
    if (btnStagePrev) {
      btnStagePrev.addEventListener('click', () => {
        this.checkoutStage(this.currentStage - 1, { recordHistory: true, focusCamera: false });
      });
    }
    const btnStageNext = document.getElementById('btnStageNext');
    if (btnStageNext) {
      btnStageNext.addEventListener('click', () => {
        this.checkoutStage(this.currentStage + 1, { recordHistory: true, focusCamera: false });
      });
    }
    const btnPanelHead = document.getElementById('btnPanelStageHead');
    if (btnPanelHead) {
      btnPanelHead.addEventListener('click', () => {
        this.checkoutStage(FULL_BUILD_STAGE, { recordHistory: true, focusCamera: true });
      });
    }
    const btnStageBadge = document.getElementById('btnStageBadge');
    if (btnStageBadge) {
      btnStageBadge.addEventListener('click', () => {
        if (this.sideCollapsed) setSideCollapsed(false);
        this.setSidePanelTab('stages');
      });
    }

    // Compact Floating Freeform Camera Nav Pad (Maju/Mundur, Geser, Naik/Turun, Zoom, Reset)
    // Supports BOTH quick tap (smooth impulse) AND press-and-hold (continuous smooth flight)
    document.querySelectorAll('[data-cam-hold]').forEach((btn) => {
      const action = btn.dataset.camHold;
      const startHold = (e) => {
        e.preventDefault();
        if (!this.sceneReady) this.ensureSceneReady();
        this.camFlyTargetPos = null;
        this.camFlyTargetLook = null;
        this.navHeld.add(action);
        btn.classList.add('active');
        const dist = this.camera.position.distanceTo(this.controls.target);
        const step = clamp(dist * 0.14, 0.04, 0.28);
        if (action === 'fwd') this.queueFreeformMove(0, 0, step);
        else if (action === 'back') this.queueFreeformMove(0, 0, -step);
        else if (action === 'left') this.queueFreeformMove(-step, 0, 0);
        else if (action === 'right') this.queueFreeformMove(step, 0, 0);
        else if (action === 'up') this.queueFreeformMove(0, step, 0);
        else if (action === 'down') this.queueFreeformMove(0, -step, 0);
        this.wakeRender(450);
      };
      const endHold = () => {
        this.navHeld.delete(action);
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', startHold);
      btn.addEventListener('pointerup', endHold);
      btn.addEventListener('pointerleave', endHold);
      btn.addEventListener('pointercancel', endHold);
    });

    const btnZoomIn = document.getElementById('btnCamZoomIn');
    const btnZoomOut = document.getElementById('btnCamZoomOut');
    const btnCamReset = document.getElementById('btnCamReset');
    if (btnZoomIn) btnZoomIn.addEventListener('click', () => this.zoomCameraStep(-0.24));
    if (btnZoomOut) btnZoomOut.addEventListener('click', () => this.zoomCameraStep(0.28));
    if (btnCamReset) {
      btnCamReset.addEventListener('click', () => this.resetCameraOverview());
    }

    const navKeys = new Set(['w', 's', 'a', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
    window.addEventListener('keydown', (e) => {
      if (this.slot !== 'full') return;
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.undoStage();
        } else if ((k === 'z' && e.shiftKey) || k === 'y') {
          e.preventDefault();
          this.redoStage();
        }
        return;
      }
      if (k === 'h') setSideCollapsed(!this.sideCollapsed);
      else if (k === 'r') this.resetCameraOverview();
      else if (e.key === 'Escape') this.clearSelection();
      else if (navKeys.has(k)) {
        e.preventDefault();
        if (!this.sceneReady) this.ensureSceneReady();
        this.camFlyTargetPos = null;
        this.camFlyTargetLook = null;
        this.keysHeld.add(k);
        if (e.shiftKey) this.keysHeld.add('shift');
        this.wakeRender(450);
      } else if (e.key === 'Shift') {
        this.keysHeld.add('shift');
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this.zoomCameraStep(-0.22);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        this.zoomCameraStep(0.24);
      }
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keysHeld.delete(k);
      if (e.key === 'Shift') this.keysHeld.delete('shift');
    });

    window.addEventListener('blur', () => {
      this.keysHeld.clear();
      this.navHeld.clear();
      this.camVelocity.set(0, 0, 0);
      document.querySelectorAll('[data-cam-hold].active').forEach((b) => b.classList.remove('active'));
    });

    const btnInspBack = document.getElementById('btnInspBack');
    if (btnInspBack) {
      btnInspBack.addEventListener('click', (e) => {
        e.stopPropagation();
        this.goBackInspector();
      });
    }

    const btnInspFocus = document.getElementById('btnInspFocus');
    if (btnInspFocus) {
      btnInspFocus.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof this.currentInspFocusFn === 'function') {
          this.currentInspFocusFn();
        }
      });
    }

    const btnCloseInsp = document.getElementById('btnRig3dInspClose');
    if (btnCloseInsp) {
      btnCloseInsp.addEventListener('click', () => this.clearSelection());
    }
  }

  /**
   * Queues a frame-synchronized freeform translation in camera space:
   * rightAmt (+X right), upAmt (+Y world up), fwdAmt (+forward along camera look ray).
   * Applied smoothly inside stepScene(dt) BEFORE controls.update() so there is zero shake.
   */
  queueFreeformMove(rightAmt, upAmt, fwdAmt) {
    if (!this.sceneReady) this.ensureSceneReady();
    if (!this.camera || !this.controls) return;
    this.camFlyTargetPos = null;
    this.camFlyTargetLook = null;

    this.camera.getWorldDirection(this._camFwd).normalize();
    this._camRight.crossVectors(this._camFwd, this._upAxis);
    if (this._camRight.lengthSq() < 1e-6) {
      this._camRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    } else {
      this._camRight.normalize();
    }

    if (rightAmt) this.freeMoveImpulse.addScaledVector(this._camRight, rightAmt);
    if (upAmt) this.freeMoveImpulse.y += upAmt;
    if (fwdAmt) this.freeMoveImpulse.addScaledVector(this._camFwd, fwdAmt);
    this.wakeRender(500);
  }

  panCameraVertical(deltaY) {
    this.queueFreeformMove(0, deltaY, 0);
  }

  panCameraHorizontal(deltaX) {
    this.queueFreeformMove(deltaX, 0, 0);
  }

  moveCameraForward(deltaFwd) {
    this.queueFreeformMove(0, 0, deltaFwd);
  }

  /**
   * Queues a smooth logarithmic zoom delta (negative = zoom in, positive = zoom out).
   * Applied in stepScene(dt) BEFORE controls.update() so there is zero step jitter.
   */
  zoomCameraStep(logDelta) {
    if (!this.sceneReady) this.ensureSceneReady();
    if (!this.controls || !this.camera) return;
    this.camFlyTargetPos = null;
    this.camFlyTargetLook = null;
    this.freeZoomImpulse = clamp(this.freeZoomImpulse + logDelta, -1.2, 1.2);
    this.wakeRender(500);
  }

  applyEnvironment(mode) {
    this.envMode = mode === 'workshop' ? 'workshop' : 'outdoor';
    if (!this.scene) return;
    const isOut = this.envMode === 'outdoor';
    if (this.outdoorGroup) this.outdoorGroup.visible = isOut;
    if (this.workshopGroup) this.workshopGroup.visible = !isOut;
    if (this.sunVisual) this.sunVisual.visible = isOut;
    if (this.lampVisual) this.lampVisual.visible = !isOut;

    if (isOut) {
      this.scene.background = new THREE.Color(0xcce0f5);
      this.scene.fog = new THREE.FogExp2(0xd2e3f4, 0.048);
      this.hemiLight.color.setHex(0xd6ebff);
      this.hemiLight.groundColor.setHex(0x888479);
      this.hemiLight.intensity = 0.90;
      this.keyLight.color.setHex(0xfff0d1);
      this.keyLight.intensity = 2.25;
      if (this.beamMat) this.beamMat.color.setHex(0xffdf78);
    } else {
      this.scene.background = new THREE.Color(0xeae6dc);
      this.scene.fog = new THREE.FogExp2(0xeae6dc, 0.068);
      this.hemiLight.color.setHex(0xf6f8fc);
      this.hemiLight.groundColor.setHex(0x9a9386);
      this.hemiLight.intensity = 1.05;
      this.keyLight.color.setHex(0xfff7e6);
      this.keyLight.intensity = 1.85;
      if (this.beamMat) this.beamMat.color.setHex(0xfff3c4);
    }
    this.wakeRender(300);
  }

  setLightTestMode(active) {
    this.lightTestMode = !!active;
    if (this.guideArc) this.guideArc.visible = this.lightTestMode && this.slot === 'full';
    const sliderRow = document.getElementById('rig3dLightSliderWrap');
    if (sliderRow) sliderRow.style.display = this.lightTestMode ? 'flex' : 'none';
    const hintEl = document.getElementById('rig3dDragHint');
    if (hintEl) {
      hintEl.textContent = this.lightTestMode
        ? 'Seret bola matahari/senter 3D atau geser slider di panel kanan untuk uji sekat LDR'
        : 'Seret kiri = Putar bebas · Seret kanan = Geser · Scroll = Zoom · W/S / Shift+Scroll = Maju/Mundur · Q/E/↑↓ = Naik/Turun';
    }

    document.querySelectorAll('[data-3d-lightmode]').forEach((b) => {
      b.classList.toggle('active', b.dataset['3dLightmode'] === (this.lightTestMode ? 'test' : 'live'));
    });

    if (this.lightTestMode) {
      this.setManualLightAngle(this.manualLightDeg, this.manualLightEl, true, true);
    } else {
      if (this.pendingLightSyncTimer) {
        clearTimeout(this.pendingLightSyncTimer);
        this.pendingLightSyncTimer = 0;
      }
      this.postSimLight(false, this.manualLightDeg, this.manualLightEl);
    }
    this.wakeRender(300);
  }

  flushManualLightSync() {
    if (this.pendingLightSyncTimer) {
      clearTimeout(this.pendingLightSyncTimer);
      this.pendingLightSyncTimer = 0;
    }
    if (!this.lightTestMode) return;
    this.lastLightPostMs = performance.now();
    this.postSimLight(true, this.manualLightDeg, this.manualLightEl);
  }

  setManualLightAngle(deg, elevation, syncServer, immediate = false) {
    this.manualLightDeg = clamp(Math.round(deg), 12, 168);
    this.manualLightEl = clamp(Math.round(elevation), 14, 84);

    const slider = document.getElementById('rig3dLightSlider');
    if (slider && document.activeElement !== slider) slider.value = String(this.manualLightDeg);
    const valLbl = document.getElementById('rig3dLightDegVal');
    if (valLbl) valLbl.textContent = `${this.manualLightDeg}°`;

    const p = lightArcToWorldPos(this.manualLightDeg, this.manualLightEl, 1.65, 1.48);
    this.targetLightPos.set(p.x, p.y, p.z);
    this.wakeRender(400);

    if (syncServer) {
      const now = performance.now();
      const elapsed = now - this.lastLightPostMs;
      if (immediate || elapsed >= 110) {
        this.flushManualLightSync();
      } else if (!this.pendingLightSyncTimer) {
        this.pendingLightSyncTimer = window.setTimeout(() => {
          this.pendingLightSyncTimer = 0;
          this.flushManualLightSync();
        }, 115 - elapsed);
      }
    }
  }

  postSimLight(active, deg, elevation) {
    const isLocal = (
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1' ||
      location.hostname.endsWith('.run.app')
    );
    if (!isLocal) return;
    fetch('/api/sim/light', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active, deg, elevation, intensity: 0.9 })
    }).catch(() => {});
  }

  flyToPreset(name) {
    if (!this.sceneReady) this.ensureSceneReady();
    const p = CAMERA_PRESETS[name] || CAMERA_PRESETS.overview;
    this.camVelocity.set(0, 0, 0);
    this.freeMoveImpulse.set(0, 0, 0);
    this.camFlyTargetPos = new THREE.Vector3(...p.pos);
    this.camFlyTargetLook = new THREE.Vector3(...p.target);

    const macroGrp = MACRO_PRESET_GROUPS[name] || null;
    if (macroGrp) {
      this.setPinLabelsVisible(true, macroGrp);
    } else if (name === 'overview' || name === 'front') {
      this.setPinLabelsVisible(false, null);
    }
    this.wakeRender(950);
  }

  selectHotspot(id, skipHistory = false) {
    if (!this.sceneReady) this.ensureSceneReady();
    if (!id || !HOTSPOT_META[id] || !isHotspotVisibleAtStage(id, this.currentStage)) {
      this.selectedHotspot = null;
      this.selectedWireId = null;
      this.selectedPinId = null;
      this.currentInspState = null;
      this.currentInspFocusFn = null;
      this._renderedInspKey = '';
      this.updateInspActionButtons();
      if (this.rig) this.rig.setSelectionHighlight([], null, []);
      const card = document.getElementById('rig3dInspector');
      if (card) card.style.display = 'none';
      Object.values(this.hotspotButtons || {}).forEach((b) => b.classList.remove('selected'));
      return;
    }

    if (!skipHistory) this.pushCurrentToHistory({ type: 'hotspot', id });
    const meta = HOTSPOT_META[id];
    this.currentInspState = { type: 'hotspot', id };
    this.currentInspFocusFn = () => this.flyToPreset(meta.preset);

    this.selectedHotspot = id;
    this.selectedWireId = null;
    this.selectedPinId = null;
    if (this.rig) this.rig.setSelectionHighlight([], null, []);

    this.flyToPreset(meta.preset);
    document.querySelectorAll('[data-3d-cam]').forEach((b) => {
      b.classList.toggle('active', b.dataset['3dCam'] === meta.preset);
    });
    Object.entries(this.hotspotButtons || {}).forEach(([k, b]) => {
      b.classList.toggle('selected', k === id);
    });

    this.refreshInspectorContent();
    this.wakeRender(950);
  }

  refreshInspectorContent() {
    if (!this.selectedHotspot) return;
    const meta = HOTSPOT_META[this.selectedHotspot];
    if (!meta) return;

    const s = this.currentStage;
    const d = this.lastStatus;
    const e = this.lastElec;
    let titleText = meta.title;
    let wiringText = meta.wiring;
    let metrics = '';

    if (this.selectedHotspot === 'panel') {
      const deg = d?.servo?.deg ?? 90;
      const poseLbl = Math.abs(deg - 90) <= 6 ? 'Datar Horizontal (Zenith)' : (deg < 90 ? 'Miring Kiri (LDR1)' : 'Miring Kanan (LDR2)');
      const eff = e?.effPct ?? 100;
      metrics = `Sudut: ${deg}° (${poseLbl}) · Efisiensi Cos: ${eff}% · Daya Est.: ${e.watts.toFixed(1)} W (${e.panelVoltage.toFixed(1)} V)`;
    } else if (this.selectedHotspot === 'ldr') {
      const l1 = d?.ldr1 || { pct: 0, raw: 0, mv: 0 };
      const l2 = d?.ldr2 || { pct: 0, raw: 0, mv: 0 };
      const diff = d?.delta ?? 0;
      metrics = `LDR1 (GPIO34): ${l1.pct}% (${l1.raw} · ${l1.mv} mV) · LDR2 (GPIO35): ${l2.pct}% (${l2.raw} · ${l2.mv} mV) · Δ ${diff >= 0 ? '+' : ''}${diff}%`;
    } else if (this.selectedHotspot === 'servo') {
      const srv = d?.servo || { mode: 'AUTO', deg: 90, target: 90 };
      if (s < 2) {
        metrics = `MG996R (Belum disambung kabel) · Sudut: ${srv.deg}° · Jangan pasang kabel servo sebelum output XL4015 diukur = 6 V di Tahap c2.`;
        wiringText = 'Mekanis terpasang pada tiang. Jangan sambungkan kabel servo sebelum output XL4015 diatur tepat 6 V pada Tahap c2.';
      } else {
        metrics = `MG996R · Mode: ${srv.locked ? 'SAFE-LOCK' : srv.mode} · Sudut: ${srv.deg}° (Target ${srv.target}°) · Suplai XL4015: ${e.xl4015OutV.toFixed(2)} V / ${e.xl4015OutA.toFixed(2)} A`;
      }
    } else if (this.selectedHotspot === 'wattmeter') {
      metrics = `Tegangan Panel (Est.): ${e.panelVoltage.toFixed(2)} V · Arus (Est.): ${e.currentAmp.toFixed(2)} A · Daya: ${e.watts.toFixed(1)} W`;
    } else if (this.selectedHotspot === 'ina219') {
      metrics = `Bus 12V: ${e.ina219BusV.toFixed(2)} V · Arus Input XL4015: ${e.ina219CurrentA.toFixed(2)} A · Daya: ${e.ina219PowerW.toFixed(2)} W · Shunt R100: ${e.ina219ShuntMv.toFixed(1)} mV (0x40)`;
    } else if (this.selectedHotspot === 'breadboard') {
      if (s < 2) {
        titleText = 'Breadboard (Siap Common GND)';
        metrics = 'Belum ada kabel terpasang di Tahap c1 · Common GND disambung pada Tahap c2.';
        wiringText = 'Rail negatif biru (−) siap dipakai sebagai titik Common GND pada Tahap c2 (XL4015 OUT−, Servo Cokelat, ESP32 GND).';
      } else if (s < 3) {
        titleText = 'Breadboard Common GND (3 Kabel)';
        metrics = '3 kabel Common GND: XL4015 OUT− · Servo MG996R (Cokelat) · ESP32 GND';
        wiringText = 'Menyatukan 3 kabel Common GND (sebelum INA219): XL4015 OUT−, Servo MG996R (cokelat — sebaiknya langsung ke titik distribusi), dan ESP32 GND.';
      } else {
        metrics = '4 kabel Common GND: INA219 GND · XL4015 OUT− · Servo MG996R (Cokelat) · ESP32 GND';
      }
    } else if (this.selectedHotspot === 'esp32') {
      const fw = d?.firmwareVersion || '--';
      const rssi = d?.wifi?.ok ? `${d.wifi.rssi} dBm` : 'USB / Sim';
      const temp = typeof d?.tempC === 'number' ? `${d.tempC.toFixed(1)}°C` : '--°C';
      const heap = d?.freeHeap ? `${Math.round(d.freeHeap / 1024)} KB` : '--';
      metrics = `FW: ${fw} · WiFi: ${rssi} · Suhu: ${temp} · Heap: ${heap} · 3V3 Sag: ${d?.pwr?.sagMv ?? 0} mV`;
      if (s < 4) {
        wiringText = 'Daya uji via kabel USB laptop/charger (UPS belum dipasang). Penting: Jangan hubungkan output 6 V XL4015 ke pin 3V3 atau 5V ESP32!';
      } else if (s === 4) {
        wiringText = 'Suplai 5V langsung dari pad UPS+ → 5V dan UPS− → GND (Switch pemutus KCD11 dipasang di Tahap c5). Lepas UPS+ sebelum colok USB laptop.';
      }
    } else if (this.selectedHotspot === 'rtc') {
      const rtcTime = d?.rtc?.time || '--';
      const rtcState = (d?.rtc?.present && d?.rtc?.running) ? 'AKTIF (I2C OK)' : 'PERLU SINKRON';
      const eep = d?.eeprom ? 'AT24C32 (0x50) Siap' : '0x68 RTC';
      metrics = `Waktu RTC: ${rtcTime} · Status: ${rtcState} · ${eep} · I2C Err: ${d?.i2cErr ?? 0}`;
    } else if (this.selectedHotspot === 'xl4015') {
      const loadLbl = e.servoActive ? 'Aktif menggerakkan MG996R' : 'Siaga (Idle)';
      if (s < 3) {
        metrics = `IN (Langsung SCC LOAD+): ${e.xl4015InV.toFixed(1)} V → OUT (MG996R): ${e.xl4015OutV.toFixed(2)} V · Arus Est.: ${e.xl4015OutA.toFixed(2)} A (${loadLbl})`;
        wiringText = 'Tahap tanpa INA219: IN+ langsung dari SCC LOAD+, IN− langsung dari SCC LOAD− → atur 6 V dengan multimeter → OUT+ ke Servo Merah, OUT− ke Common GND. Jangan sambung 6 V ke ESP32!';
      } else {
        metrics = `IN (via INA219): ${e.xl4015InV.toFixed(1)} V → OUT (MG996R): ${e.xl4015OutV.toFixed(2)} V · Arus Est.: ${e.xl4015OutA.toFixed(2)} A (${loadLbl})`;
      }
    } else if (this.selectedHotspot === 'scc') {
      const loadRoute = s < 2 ? 'LOAD+/− Siap' : (s < 3 ? 'LOAD+/− → XL4015 (Langsung)' : 'LOAD+ → INA219 → XL4015');
      metrics = `Tegangan Aki (Est.): ${e.batteryVoltage.toFixed(1)} V · Status: ${e.charging ? 'Mengisi dari Panel' : 'Siaga / Gelap'} · ${loadRoute}`;
      if (s < 3) {
        wiringText = s < 2
          ? 'Posisi depan tengah (di bawah Watt Meter): +PV− (dari Watt Meter) · +BAT− (Aki INCOE 12V) · +LOAD− siap disambung ke XL4015 pada Tahap c2.'
          : 'Posisi depan tengah (di bawah Watt Meter): +PV− (dari Watt Meter) · +BAT− (Aki INCOE 12V) · LOAD+ & LOAD− langsung masuk ke XL4015 IN+/− (sebelum INA219).';
      }
    } else if (this.selectedHotspot === 'battery') {
      metrics = `INCOE SA-20 12V 22Ah · Tegangan Est.: ${e.batteryVoltage.toFixed(1)} V (${e.batterySoc}%) · 3V3 Sag: ${d?.pwr?.sagMv ?? 0} mV`;
    } else if (this.selectedHotspot === 'ups_switch') {
      metrics = this.upsSwitchOn
        ? `Status: ON (I) · UPS+ (${e.upsOutV.toFixed(2)} V) tersambung ke ESP32 5V · Matikan ke (O) sebelum flash USB laptop`
        : `Status: OFF (O) · Jalur 5V UPS diputus (0 V ke ESP32) · AMAN colok USB laptop untuk flash ESP32`;
    } else if (this.selectedHotspot === 'ups') {
      const swLbl = s < 5
        ? 'Langsung ke ESP32 5V (Switch di c5)'
        : (this.upsSwitchOn ? 'Switch ON (I) → ESP32' : 'Switch OFF (O · Diputus)');
      metrics = `IN USB-C: ${e.upsInV.toFixed(2)} V · Baterai 2×18650: ${e.upsBattV.toFixed(2)} V (${e.upsSocPct}%) · OUT Boost: ${e.upsOutV.toFixed(2)} V · ${swLbl}`;
      if (s === 4) {
        wiringText = 'USB-C 5V IN → Charger U1 & 2×18650 paralel → Boost 2R2/U4 → UPS+ langsung ke ESP32 5V · UPS− → GND (Switch 5V dipasang di Tahap c5).';
      }
    }

    let routeHtml = '';
    if (this.selectedHotspot === 'ups_switch' || (this.selectedHotspot === 'ups' && s >= 5)) {
      routeHtml = `<button type="button" class="route-node ${this.upsSwitchOn ? 'route-origin' : 'route-empty'}" data-toggle-ups-switch="1" title="Klik untuk simulasi tekan saklar I/O"><span class="route-lbl">SIMULASI SAKLAR 5V</span><strong>${this.upsSwitchOn ? 'Posisi I (ON) · Klik untuk Matikan (O)' : 'Posisi O (OFF) · Klik untuk Nyalakan (I)'}</strong></button>`;
    }

    const nets = getHotspotWireNetsForStage(this.selectedHotspot, s);
    let relatedHtml = '';
    if (nets.length > 0) {
      const netChips = nets
        .map((nk) => getWireNetMetaForStage(nk, s))
        .filter(Boolean)
        .map((nm, idx) => {
          const nk = nets[idx];
          return `<button type="button" class="insp-wire-chip" data-jump-net="${escapeHtml(nk)}"><span class="wire-dot" style="background:${escapeHtml(nm.colorHex)}"></span>${escapeHtml(nm.label)}</button>`;
        })
        .join('');
      if (netChips) {
        relatedHtml = `<span class="insp-rel-lbl">Telusuri Jalur Kabel Komponen Ini</span><div class="insp-rel-list">${netChips}</div>`;
      }
    }

    this.renderInspectorCard({
      targetKey: `hotspot:${this.selectedHotspot}:s${s}:sw${this.upsSwitchOn ? 1 : 0}`,
      badgeText: 'KOMPONEN',
      badgeColor: '#007aff',
      voltageText: '',
      titleText,
      routeHtml,
      relatedHtml,
      extraMetrics: metrics,
      descText: wiringText
    });
  }

  setActiveView(viewName) {
    if (viewName === 'twin3d') {
      this.slot = 'full';
      this.cancelIdleWarmup();
      if (this.scenePreparationFailed) return;
      this.setLoadingState(!this.hasRenderedScene);
      if (this.fullMount && this.renderer.domElement.parentNode !== this.fullMount) {
        this.fullMount.appendChild(this.renderer.domElement);
      }
      if (!this.sceneReady) {
        // Yield 1 animation frame so the Tab 4 UI transition paints immediately before first-time build
        requestAnimationFrame(() => {
          if (this.slot !== 'full') return;
          this.ensureSceneReady();
          if (this.controls) this.controls.enabled = true;
          if (this.guideArc) this.guideArc.visible = this.lightTestMode;
          this.handleResize(true);
          this.updateProjectedOverlays(true);
          this.wakeRender(120);
        });
        return;
      }
      if (this.controls) this.controls.enabled = true;
      if (this.guideArc) this.guideArc.visible = this.lightTestMode;
      if (this._statusDirty && this.lastStatus) {
        this.syncStatusToScene(this.lastStatus);
      }
      this._domRect = null;
      this.handleResize();
      this.wakeRender(120);
    } else {
      this.slot = 'hidden';
      this.hideHoverTip();
      this.keysHeld.clear();
      this.navHeld.clear();
      if (this.controls) this.controls.enabled = false;
      this.stopLoop();
    }
  }

  handleResize(force = false) {
    if (!this.fullMount || !this.renderer || !this.camera) return;
    if (!force && !this.sceneReady) return;
    const rect = this.fullMount.getBoundingClientRect();
    this._domRect = rect;
    const rawW = rect.width;
    const rawH = rect.height;
    if (rawW < 10 || rawH < 10) return;

    this._viewportW = rawW;
    this._viewportH = rawH;
    const w = Math.max(120, Math.round(rawW));
    const h = Math.max(120, Math.round(rawH));
    if (!force && w === this._lastCanvasW && h === this._lastCanvasH) return;

    this._lastCanvasW = w;
    this._lastCanvasH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this._lastOverlaySig = '';
    if (this.slot === 'full') this.wakeRender(200);
  }

  updateMouseNdc(event) {
    const rect = this.getCachedDomRect();
    if (!rect || rect.width < 1 || rect.height < 1) return;
    this._mouseNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouseNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  syncStatusToScene(d) {
    if (!d || !this.sceneReady) return;
    this._statusDirty = false;
    const srv = d.servo || { deg: 90, target: 90, mode: 'AUTO', trim: 0, invert: false };
    const lightPctMax = Math.max(d.ldr1?.pct || 0, d.ldr2?.pct || 0);

    if (!this.lightTestMode) {
      if (this.envMode === 'outdoor' && d.astro && Number(d.astro.el) > 3) {
        const azClamped = clamp((Number(d.astro.az) || 90) - 90, -75, 75);
        const arcDeg = clamp(90 + azClamped, 15, 165);
        const p = lightArcToWorldPos(arcDeg, Number(d.astro.el), 1.65, 1.48);
        this.targetLightPos.set(p.x, p.y, p.z);
      } else {
        const diff = (d.ldr2?.pct || 0) - (d.ldr1?.pct || 0);
        const dirSign = srv.invert ? -1 : 1;
        const estDeg = clamp((srv.deg ?? 90) + dirSign * diff * 0.65, 15, 165);
        const estEl = clamp(24 + lightPctMax * 0.45, 18, 62);
        const p = lightArcToWorldPos(estDeg, estEl, 1.65, 1.48);
        this.targetLightPos.set(p.x, p.y, p.z);
      }
    }

    if (this.envMode === 'outdoor') {
      const parkedOrDark = !!d.park?.on || lightPctMax < 12;
      const lowSun = !parkedOrDark && lightPctMax < 35;
      const wantTex = parkedOrDark ? this.skyTexNight : (lowSun ? this.skyTexSunset : this.skyTexDay);
      if (this.skyDomeMat.map !== wantTex) {
        this.skyDomeMat.map = wantTex;
        this.skyDomeMat.needsUpdate = true;
        this.scene.fog.color.setHex(parkedOrDark ? 0x162445 : (lowSun ? 0xdfba98 : 0xd2e3f4));
      }
    }

    const hudMeta = document.getElementById('rig3dHudTelemetry');
    if (hudMeta) {
      const modeStr = srv.locked ? 'SAFE-LOCK' : (srv.mode || 'AUTO');
      const srcStr = d.sourceMode === 'sim' ? `Sim (${d.preset || 'normal'})` : (d.serialPort || 'Live');
      const nextTxt = `Servo ${srv.deg ?? 90}° (${modeStr}) · LDR1 ${d.ldr1?.pct ?? 0}% / LDR2 ${d.ldr2?.pct ?? 0}% · ${srcStr}`;
      if (hudMeta.textContent !== nextTxt) hudMeta.textContent = nextTxt;
    }

    if (this.selectedHotspot) {
      this.refreshInspectorContent();
    }
  }

  updateFromStatus(d) {
    if (!d) return;
    this.lastStatus = d;
    if (!this.sceneReady) {
      this._statusDirty = true;
      return;
    }
    if (this.slot !== 'full') {
      this._statusDirty = true;
      return;
    }
    this.syncStatusToScene(d);
    this.wakeRender(160);
  }

  updateProjectedOverlays(force = false) {
    if (this.slot !== 'full' || !this.sceneReady) return;
    let w = this._viewportW;
    let h = this._viewportH;
    if (w < 10 || h < 10) {
      const rect = this.getCachedDomRect();
      if (!rect) return;
      w = rect.width;
      h = rect.height;
      this._viewportW = w;
      this._viewportH = h;
    }
    if (w < 10 || h < 10) return;

    const camDist = this.camera.position.distanceTo(this.controls.target);
    const m = this.camera.matrixWorldInverse.elements;
    const pm = this.camera.projectionMatrix.elements;
    const sig = `${m[0].toFixed(4)},${m[4].toFixed(4)},${m[8].toFixed(4)},${m[12].toFixed(3)},${m[13].toFixed(3)},${m[14].toFixed(3)},${pm[0].toFixed(3)},${this.curServoDeg.toFixed(2)},${this.currentStage},${this.showHotspots ? 1 : 0},${this.showPinLabels ? 1 : 0},${this.activeMacroGroup || ''},${w.toFixed(0)}x${h.toFixed(0)}`;
    if (!force && sig === this._lastOverlaySig) return;
    this._lastOverlaySig = sig;

    const isMacroClose = camDist < 0.45;

    if (this.showHotspots && this.hotspotLayer) {
      for (const [id, anchor] of Object.entries(this.rig.hotspotAnchors)) {
        const btn = this.hotspotButtons[id];
        if (!btn) continue;
        if (!isHotspotVisibleAtStage(id, this.currentStage) || (isMacroClose && this.showPinLabels)) {
          if (btn._ovis) {
            btn._ovis = false;
            btn.style.opacity = '0';
            btn.style.pointerEvents = 'none';
          }
          continue;
        }
        anchor.getWorldPosition(this._vec3);
        this._vec3.project(this.camera);
        const visible = this._vec3.z > -1 && this._vec3.z < 1;
        if (!visible) {
          if (btn._ovis) {
            btn._ovis = false;
            btn.style.opacity = '0';
            btn.style.pointerEvents = 'none';
          }
          continue;
        }
        const sx = (this._vec3.x * 0.5 + 0.5) * w;
        const sy = (-this._vec3.y * 0.5 + 0.5) * h;
        if (!btn._ovis) {
          btn._ovis = true;
          btn.style.opacity = '1';
          btn.style.pointerEvents = 'auto';
        }
        if (btn._ox === null || Math.abs(sx - btn._ox) >= 0.2 || Math.abs(sy - btn._oy) >= 0.2) {
          btn._ox = sx;
          btn._oy = sy;
          btn.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%)`;
        }
      }
    }

    if (this.showPinLabels && this.pinCalloutNodes) {
      for (const item of this.pinCalloutNodes) {
        const groupMatch = !this.activeMacroGroup || item.group === this.activeMacroGroup;
        if (!groupMatch) {
          if (item._ovis) {
            item._ovis = false;
            item.el.style.opacity = '0';
            item.el.style.visibility = 'hidden';
          }
          continue;
        }
        this._vec3.copy(item.anchorVec);
        const distToCam = this._vec3.distanceTo(this.camera.position);
        this._vec3.project(this.camera);
        const inView = this._vec3.z > -1 && this._vec3.z < 1 && distToCam < 1.35 &&
          this._vec3.x > -0.95 && this._vec3.x < 0.95 && this._vec3.y > -0.92 && this._vec3.y < 0.92;
        if (!inView) {
          if (item._ovis) {
            item._ovis = false;
            item.el.style.opacity = '0';
            item.el.style.visibility = 'hidden';
          }
          continue;
        }
        const sx = (this._vec3.x * 0.5 + 0.5) * w;
        const sy = (-this._vec3.y * 0.5 + 0.5) * h;
        if (!item._ovis) {
          item._ovis = true;
          item.el.style.visibility = 'visible';
          item.el.style.opacity = '1';
        }
        if (item._ox === null || Math.abs(sx - item._ox) >= 0.2 || Math.abs(sy - item._oy) >= 0.2) {
          item._ox = sx;
          item._oy = sy;
          item.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -115%)`;
        }
      }
    }
  }

  stepScene(dt) {
    const d = this.lastStatus;
    const targetDeg = d?.servo?.deg ?? 90;
    const targetTrim = d?.servo?.trim ?? 0;
    const invert = !!d?.servo?.invert;

    this.curServoDeg = THREE.MathUtils.damp(this.curServoDeg, targetDeg, 8.5, dt);
    this.curTrimDeg = THREE.MathUtils.damp(this.curTrimDeg, targetTrim, 8.5, dt);
    const hasServoMotion = Math.abs(this.curServoDeg - targetDeg) > 0.03 || Math.abs(this.curTrimDeg - targetTrim) > 0.03;

    const panelTiltRad = servoDegToPanelTiltRad(this.curServoDeg, this.curTrimDeg, invert);
    const hornRad = servoDegToHornRad(this.curServoDeg, this.curTrimDeg, invert);
    this.rig.updateMechanics(panelTiltRad, hornRad);

    this.curLightPos.lerp(this.targetLightPos, 1 - Math.exp(-8 * dt));
    const hasLightMotion = this.curLightPos.distanceToSquared(this.targetLightPos) > 1e-6;
    this.lightHandleGroup.position.copy(this.curLightPos);
    this.keyLight.position.copy(this.curLightPos).multiplyScalar(2.2);

    this._vec3.set(0, 1.48, 0);
    this.lampVisual.lookAt(this._vec3);
    this.sunHalo.lookAt(this.camera.position);

    this._vec3B.subVectors(this._vec3, this.curLightPos);
    const dist = this._vec3B.length();
    if (dist > 0.1) {
      this.lightBeam.position.copy(this.curLightPos).addScaledVector(this._vec3B, 0.5);
      this.lightBeam.scale.set(1, dist, 1);
      this._vec3B.normalize();
      this._quat.setFromUnitVectors(this._upAxis, this._vec3B);
      this.lightBeam.quaternion.copy(this._quat);
      const lPct = Math.max(d?.ldr1?.pct ?? 50, d?.ldr2?.pct ?? 50) / 100;
      this.beamMat.opacity = this.lightTestMode ? 0.22 : (0.06 + lPct * 0.12);
    }

    this.lastElec = computeElectricalEstimate(d, panelTiltRad, this.curLightPos, 1.48);
    this.rig.updateTelemetryVisuals(d, this.lastElec, dt);

    let hasFly = false;
    if (this.slot === 'full' && this.camFlyTargetPos && this.camFlyTargetLook) {
      hasFly = true;
      const k = 1 - Math.exp(-8.5 * dt);
      this.camera.position.lerp(this.camFlyTargetPos, k);
      this.controls.target.lerp(this.camFlyTargetLook, k);
      if (this.camera.position.distanceTo(this.camFlyTargetPos) < 0.006 && this.controls.target.distanceTo(this.camFlyTargetLook) < 0.006) {
        this.camera.position.copy(this.camFlyTargetPos);
        this.controls.target.copy(this.camFlyTargetLook);
        this.camFlyTargetPos = null;
        this.camFlyTargetLook = null;
        hasFly = false;
      }
    }

    let controlsMoved = false;
    let hasFreeMove = false;
    if (this.slot === 'full') {
      // 1) Smooth inertia-driven freeform held movement (W/S maju-mundur, A/D strafe, Q/E/arrows up-down)
      const moveFwd = (this.keysHeld.has('w') || this.navHeld.has('fwd') ? 1 : 0)
        - (this.keysHeld.has('s') || this.navHeld.has('back') ? 1 : 0);
      const moveRight = (this.keysHeld.has('d') || this.keysHeld.has('arrowright') || this.navHeld.has('right') ? 1 : 0)
        - (this.keysHeld.has('a') || this.keysHeld.has('arrowleft') || this.navHeld.has('left') ? 1 : 0);
      const moveUp = (this.keysHeld.has('e') || this.keysHeld.has('arrowup') || this.navHeld.has('up') ? 1 : 0)
        - (this.keysHeld.has('q') || this.keysHeld.has('arrowdown') || this.navHeld.has('down') ? 1 : 0);

      const desiredVel = this._vec3B.set(0, 0, 0);
      if (moveFwd || moveRight || moveUp) {
        const curDist = this.camera.position.distanceTo(this.controls.target);
        const speedBoost = this.keysHeld.has('shift') ? 1.9 : 1.0;
        const speed = clamp(curDist * 1.15, 0.24, 2.8) * speedBoost;

        this.camera.getWorldDirection(this._camFwd).normalize();
        this._camRight.crossVectors(this._camFwd, this._upAxis);
        if (this._camRight.lengthSq() < 1e-6) {
          this._camRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
        } else {
          this._camRight.normalize();
        }
        if (moveFwd) desiredVel.addScaledVector(this._camFwd, moveFwd * speed);
        if (moveRight) desiredVel.addScaledVector(this._camRight, moveRight * speed);
        if (moveUp) desiredVel.y += moveUp * speed;
      }

      const velAlpha = 1 - Math.exp(-12 * dt);
      this.camVelocity.lerp(desiredVel, velAlpha);
      if (this.camVelocity.lengthSq() < 1e-6 && desiredVel.lengthSq() === 0) {
        this.camVelocity.set(0, 0, 0);
      }

      this._moveVec.copy(this.camVelocity).multiplyScalar(dt);

      // 2) Apply smoothly damped one-shot freeform impulses (Shift+Scroll, Alt+Scroll, tap buttons)
      if (this.freeMoveImpulse.lengthSq() > 1e-8) {
        const kImp = 1 - Math.exp(-14 * dt);
        this._vec3.copy(this.freeMoveImpulse).multiplyScalar(kImp);
        this._moveVec.add(this._vec3);
        this.freeMoveImpulse.sub(this._vec3);
      } else {
        this.freeMoveImpulse.set(0, 0, 0);
      }

      if (this._moveVec.lengthSq() > 0) {
        hasFreeMove = true;
        // Keep freeform target inside generous 3D room bounds BEFORE OrbitControls.update()
        const nextTx = clamp(this.controls.target.x + this._moveVec.x, -4.5, 4.5);
        const nextTy = clamp(this.controls.target.y + this._moveVec.y, -0.15, 3.2);
        const nextTz = clamp(this.controls.target.z + this._moveVec.z, -4.5, 4.5);
        const dx = nextTx - this.controls.target.x;
        const dy = nextTy - this.controls.target.y;
        const dz = nextTz - this.controls.target.z;
        this.controls.target.set(nextTx, nextTy, nextTz);
        this.camera.position.x += dx;
        this.camera.position.y += dy;
        this.camera.position.z += dz;
      }

      // 3) Apply smoothly damped zoom impulse (from + / - buttons or keys) BEFORE controls.update()
      if (Math.abs(this.freeZoomImpulse) > 1e-4) {
        hasFreeMove = true;
        const kZoom = 1 - Math.exp(-14 * dt);
        const dzLog = this.freeZoomImpulse * kZoom;
        this.freeZoomImpulse -= dzLog;
        const offset = this._vec3.subVectors(this.camera.position, this.controls.target);
        const curLen = offset.length();
        if (curLen > 1e-5) {
          const nextLen = clamp(curLen * Math.exp(dzLog), this.controls.minDistance, this.controls.maxDistance);
          offset.multiplyScalar(nextLen / curLen);
          this.camera.position.copy(this.controls.target).add(offset);
        }
      } else {
        this.freeZoomImpulse = 0;
      }

      // 4) Single authoritative OrbitControls.update() per frame — zero post-update mutations = zero shake!
      controlsMoved = !!this.controls.update();
    }

    return Boolean(
      controlsMoved ||
      hasFly ||
      hasServoMotion ||
      hasLightMotion ||
      hasFreeMove ||
      this.draggingLight ||
      this.keysHeld.size > 0 ||
      this.navHeld.size > 0
    );
  }

  afterDraw(cb) {
    const gl = this.renderer.getContext();
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (!this.running) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const st = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (st === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 100);
    }
  }

  wakeRender(durationMs = 350) {
    this.activeUntilMs = Math.max(this.activeUntilMs, performance.now() + durationMs);
    if (this.slot === 'full' && this.sceneReady && this.sceneResourcesReady && !this.contextLost && !this.running) {
      this.startLoop();
    }
  }

  startLoop() {
    if (this.running || this.contextLost || !this.sceneReady || !this.sceneResourcesReady || this.slot !== 'full') return;
    this.running = true;
    this.lastFrameTime = performance.now();

    const tick = () => {
      if (!this.running || this.contextLost || this.slot !== 'full') {
        this.running = false;
        this.frameId = 0;
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0.001, (now - this.lastFrameTime) / 1000));
      this.lastFrameTime = now;

      const stillMoving = this.stepScene(dt);
      this.renderer.render(this.scene, this.camera);
      this.updateProjectedOverlays();
      if (!this.hasRenderedScene) {
        this.hasRenderedScene = true;
        this.setLoadingState(false);
      }

      if (stillMoving || now < this.activeUntilMs) {
        if (this.isSoftwareGl) {
          this.afterDraw(tick);
        } else {
          this.frameId = requestAnimationFrame(tick);
        }
      } else {
        this.running = false;
        this.frameId = 0;
      }
    };

    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(tick, 16);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  stopLoop() {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.frameId = 0;
  }
}

window.SolarRig3D = new SolarTrackerDigitalTwin();
