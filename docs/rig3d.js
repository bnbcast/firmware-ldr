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
import { WIRE_NET_META } from './rig3d-wiring.js';

const CAMERA_PRESETS = {
  overview:   { pos: [1.30, 1.86, 2.48],   target: [0.06, 0.80, 0.06] },
  front:      { pos: [0.08, 1.12, 2.32],   target: [0.05, 0.94, 0.06] },
  watt_scc:   { pos: [0.04, 1.02, 0.62],   target: [0.02, 1.00, 0.05] },
  xl4015:     { pos: [-0.215, 0.80, 0.25], target: [-0.215, 0.625, 0.118] },
  breadboard: { pos: [-0.042, 0.80, 0.26], target: [-0.042, 0.625, 0.126] },
  esp_pins:   { pos: [0.165, 0.78, 0.24],  target: [0.160, 0.628, 0.118] },
  tiny_rtc:   { pos: [0.308, 0.75, 0.195], target: [0.305, 0.628, 0.118] },
  ldr:        { pos: [-0.43, 0.81, 0.29],  target: [-0.43, 0.635, 0.115] },
  rear:       { pos: [0.36, 1.28, -0.76],  target: [0.02, 1.20, -0.03] },
  power:      { pos: [-0.56, 0.44, 0.90],  target: [-0.14, 0.30, -0.04] }
};

const MACRO_PRESET_GROUPS = {
  esp_pins: 'esp',
  tiny_rtc: 'esp',
  breadboard: 'breadboard',
  xl4015: 'xl4015',
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
    wiring: 'Posisi depan tengah (di bawah Watt Meter): +PV− (dari Watt Meter) · +BAT− (Aki INCOE 12V) · +LOAD− (12V ke XL4015)'
  },
  xl4015: {
    title: 'XL4015 CC/CV 5A (Merah)',
    preset: 'xl4015',
    wiring: 'IN+/IN− dari SCC LOAD (12V) → atur 6V → OUT+ ke Servo Merah, OUT− ke Breadboard Common GND. Jangan sambung 6V ke ESP32!'
  },
  breadboard: {
    title: 'Breadboard Common GND (3 Kabel)',
    preset: 'breadboard',
    wiring: 'Hanya menyatukan 3 kabel GND: XL4015 OUT−, Servo MG996R (cokelat), dan ESP32 GND.'
  },
  esp32: {
    title: 'ESP32 NodeMCU-32S + GOOUUU V4',
    preset: 'esp_pins',
    wiring: 'LDR 1 & 2 (AO, 3.3V, GND) dan Tiny RTC (SDA, SCL, 3.3V, GND) nyambung langsung ke ESP32. GPIO18 → Servo Oranye, GND → Breadboard.'
  },
  rtc: {
    title: 'Tiny RTC HW-111 (DS1307 + AT24C32)',
    preset: 'tiny_rtc',
    wiring: 'Nyambung langsung ke ESP32: SCL→GPIO22, SDA→GPIO21, VCC→3.3V, GND→ESP32 GND (SQ/DS/BAT kosong).'
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

    this.slot = 'hidden'; // 'full' | 'hidden' (3D renders exclusively in Tab 4 Kembaran 3D)
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
    this.freeMoveImpulse = new THREE.Vector3();
    this.freeZoomImpulse = 0;
    this.keysHeld = new Set();
    this.navHeld = new Set();
    this.draggingLight = false;
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.1);

    this.frameId = 0;
    this.running = false;
    this.lastFrameTime = performance.now();
    this.contextLost = false;

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
    this.initScene();
    this.initEnvironments();
    this.initRigAndLightVisuals();
    this.applyEnvironment('outdoor');
    this.initControlsAndEvents();
    this.initHotspotDom();
    this.initPinCalloutDom();
    this.bindUiControls();

    const activeTab = document.querySelector('.nav-tab.active')?.dataset?.view || 'live';
    this.setActiveView(activeTab);
  }

  renderFallbackMessage(msg) {
    const html = `<div class="rig3d-fallback">${msg}</div>`;
    if (this.fullMount) this.fullMount.innerHTML = html;
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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'rig3d-canvas';

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.stopLoop();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      if (this.slot !== 'hidden') this.startLoop();
    });
  }

  initScene() {
    this.scene = new THREE.Scene();

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(40, 1.6, 0.02, 60);
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

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  raycastInteractiveTarget(event) {
    this.updateMouseNdc(event);

    // Priority 1: Exact Physical Pin / Screw Terminal
    this._raycaster.layers.set(PIN_HIT_LAYER);
    this._raycaster.setFromCamera(this._mouseNdc, this.camera);
    const pinHits = this._raycaster.intersectObjects(this.rig.pinHitProxies, false);
    if (pinHits.length > 0 && pinHits[0].object.userData.pinData) {
      return { type: 'pin', data: pinHits[0].object.userData.pinData };
    }

    // Priority 2: Any 3D Wire Cable
    this._raycaster.layers.set(WIRE_HIT_LAYER);
    this._raycaster.setFromCamera(this._mouseNdc, this.camera);
    const wireHits = this._raycaster.intersectObjects(this.rig.wireHitProxies, false);
    if (wireHits.length > 0 && wireHits[0].object.userData.wireSpec) {
      return { type: 'wire', data: wireHits[0].object.userData.wireSpec };
    }

    // Priority 3: Component Body Hotspot
    this._raycaster.layers.set(HOTSPOT_LAYER);
    this._raycaster.setFromCamera(this._mouseNdc, this.camera);
    const hotHits = this._raycaster.intersectObjects(this.rig.hotspotProxies, false);
    if (hotHits.length > 0 && hotHits[0].object.userData.hotspotId) {
      return { type: 'hotspot', data: hotHits[0].object.userData.hotspotId };
    }

    return null;
  }

  showHoverTip(event, titleText, subText) {
    if (!this.hoverTipEl || !this.fullMount) return;
    const rect = this.fullMount.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left + 14, 12, Math.max(20, rect.width - 280));
    const y = clamp(event.clientY - rect.top - 12, 12, Math.max(20, rect.height - 64));
    this.hoverTipEl.innerHTML = `<div class="hover-tip-title">${escapeHtml(titleText)}</div><div class="hover-tip-sub">${escapeHtml(subText)}</div>`;
    this.hoverTipEl.style.transform = `translate3d(${x.toFixed(0)}px, ${y.toFixed(0)}px, 0)`;
    this.hoverTipEl.style.display = 'block';
  }

  hideHoverTip() {
    if (this.hoverTipEl) this.hoverTipEl.style.display = 'none';
  }

  initControlsAndEvents() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    // Disable zoomToCursor to eliminate OrbitControls cursor-ray jitter/shake during scroll zoom
    this.controls.zoomToCursor = false;
    this.controls.minDistance = 0.04;
    this.controls.maxDistance = 9.0;
    // Full freeform 360° spherical orbit without fighting floor clamp
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = Math.PI - 0.02;
    this.controls.zoomSpeed = 0.90;
    this.controls.panSpeed = 1.15;
    this.controls.rotateSpeed = 0.85;
    this.controls.target.set(...CAMERA_PRESETS.overview.target);

    this.controls.addEventListener('start', () => {
      this.camFlyTargetPos = null;
      this.camFlyTargetLook = null;
      this.hideHoverTip();
    });

    const dom = this.renderer.domElement;
    // Cancel camera fly-to on wheel. Plain scroll = smooth shake-free OrbitControls zoom.
    // Shift+Scroll = smooth freeform Maju/Mundur along camera look direction.
    // Alt+Scroll = smooth freeform Naik/Turun (vertical elevator).
    dom.addEventListener('wheel', (e) => {
      if (this.slot !== 'full') return;
      this.camFlyTargetPos = null;
      this.camFlyTargetLook = null;
      this.hideHoverTip();
      if (e.shiftKey || e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const dist = this.camera.position.distanceTo(this.controls.target);
        const dir = e.deltaY < 0 ? 1 : -1;
        const step = dir * clamp(dist * 0.16, 0.035, 0.36);
        if (e.altKey) {
          this.queueFreeformMove(0, step, 0);
        } else {
          this.queueFreeformMove(0, 0, step);
        }
      }
    }, { passive: false, capture: true });

    let downX = 0;
    let downY = 0;
    let isPointerDown = false;

    dom.addEventListener('pointerdown', (e) => {
      if (this.slot !== 'full') return;
      isPointerDown = true;
      downX = e.clientX;
      downY = e.clientY;
      this.hideHoverTip();

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

      if (isPointerDown) return;

      const now = performance.now();
      if (now - this.lastHoverCheckMs < 28) return;
      this.lastHoverCheckMs = now;

      const hit = this.raycastInteractiveTarget(e);
      if (hit?.type === 'pin') {
        const pin = hit.data;
        dom.style.cursor = 'pointer';
        this.rig.setHoverPreview(pin.wireIds?.[0] || null, pin.pos);
        const targetTxt = pin.connectedTo?.[0] || 'Kosong';
        this.showHoverTip(e, `${pin.board} · ${pin.pinName}`, `Nyambung ke: ${targetTxt} · Klik detail`);
      } else if (hit?.type === 'wire') {
        const w = hit.data;
        dom.style.cursor = 'pointer';
        this.rig.setHoverPreview(w.id, null);
        this.showHoverTip(e, `${w.fromPin} → ${w.toPin}`, `${w.voltage} · Klik untuk detail`);
      } else if (hit?.type === 'hotspot') {
        dom.style.cursor = 'pointer';
        this.rig.setHoverPreview(null, null);
        const meta = HOTSPOT_META[hit.data];
        if (meta) {
          this.showHoverTip(e, meta.title, 'Klik komponen untuk fokus kamera & detail pin');
        }
      } else {
        dom.style.cursor = '';
        this.rig.setHoverPreview(null, null);
        this.hideHoverTip();
      }
    });

    dom.addEventListener('pointerleave', () => {
      isPointerDown = false;
      this.hideHoverTip();
      if (this.rig) this.rig.setHoverPreview(null, null);
    });

    const endDrag = (e) => {
      isPointerDown = false;
      if (this.draggingLight) {
        this.draggingLight = false;
        this.controls.enabled = true;
        dom.style.cursor = '';
        this.flushManualLightSync();
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
    };
    dom.addEventListener('pointerup', endDrag);
    dom.addEventListener('pointercancel', endDrag);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    if (this.miniMount) this.resizeObserver.observe(this.miniMount);
    if (this.fullMount) this.resizeObserver.observe(this.fullMount);
  }

  initHotspotDom() {
    if (!this.hotspotLayer) return;
    this.hotspotLayer.innerHTML = '';
    this.hotspotButtons = {};
    const labels = {
      panel: 'Panel Surya',
      wattmeter: 'Watt Meter',
      scc: 'Charge Ctrl',
      xl4015: 'XL4015 Merah',
      breadboard: 'Breadboard GND',
      esp32: 'ESP32 + GOOUUU',
      rtc: 'Tiny RTC',
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
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectHotspot(id);
      });
      this.hotspotLayer.appendChild(btn);
      this.hotspotButtons[id] = btn;
    }
  }

  initPinCalloutDom() {
    if (!this.pinCalloutLayer || !this.rig?.pinCalloutAnchors) return;
    this.pinCalloutLayer.innerHTML = '';
    this.pinCalloutNodes = [];
    for (const item of this.rig.pinCalloutAnchors) {
      const el = document.createElement('div');
      el.className = 'rig3d-pin-callout mono';
      el.dataset.pinGroup = item.group;
      el.style.borderLeftColor = item.color;
      el.textContent = item.label;
      this.pinCalloutLayer.appendChild(el);
      this.pinCalloutNodes.push({ ...item, el });
    }
    this.pinCalloutLayer.style.display = 'none';
  }

  setPinLabelsVisible(active, macroGroup = null) {
    this.showPinLabels = !!active;
    this.activeMacroGroup = macroGroup;
    const btn = document.getElementById('btnTogglePinLabels');
    if (btn) btn.classList.toggle('active', this.showPinLabels);
    if (this.pinCalloutLayer) {
      this.pinCalloutLayer.style.display = this.showPinLabels ? 'block' : 'none';
    }
  }

  renderInspectorCard({ badgeText, badgeColor, voltageText, titleText, routeHtml, descText, extraMetrics }) {
    const card = document.getElementById('rig3dInspector');
    const badgeEl = document.getElementById('rig3dInspBadge');
    const voltEl = document.getElementById('rig3dInspVolt');
    const titleEl = document.getElementById('rig3dInspTitle');
    const routeEl = document.getElementById('rig3dInspRoute');
    const metricsEl = document.getElementById('rig3dInspMetrics');
    const wiringEl = document.getElementById('rig3dInspWiring');
    if (!card || !titleEl) return;

    if (badgeEl) {
      badgeEl.textContent = badgeText || 'INSPEKSI';
      badgeEl.style.background = badgeColor || '#0f172a';
    }
    if (voltEl) {
      voltEl.textContent = voltageText || '';
      voltEl.style.display = voltageText ? 'inline-flex' : 'none';
    }
    titleEl.textContent = titleText || '--';

    if (routeEl) {
      if (routeHtml) {
        routeEl.innerHTML = routeHtml;
        routeEl.style.display = 'flex';
        routeEl.querySelectorAll('[data-jump-pin]').forEach((btn) => {
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const pid = btn.dataset.jumpPin;
            if (pid) this.selectPin(pid, true);
          });
        });
      } else {
        routeEl.innerHTML = '';
        routeEl.style.display = 'none';
      }
    }

    if (metricsEl) {
      metricsEl.textContent = extraMetrics || '';
      metricsEl.style.display = extraMetrics ? 'block' : 'none';
    }
    if (wiringEl) {
      wiringEl.textContent = descText || '';
    }
    card.style.display = 'flex';
  }

  clearSelection() {
    this.selectedHotspot = null;
    this.selectedWireId = null;
    this.selectedPinId = null;
    this.focusedWireNet = null;
    Object.values(this.hotspotButtons || {}).forEach((b) => b.classList.remove('selected'));
    document.querySelectorAll('[data-wire-net]').forEach((c) => {
      c.classList.toggle('active', (c.dataset.wireNet || '') === '');
    });
    if (this.rig) {
      this.rig.setSelectionHighlight([], null, []);
      this.rig.setWiringHighlight(this.wiringHighlight, null);
    }
    const card = document.getElementById('rig3dInspector');
    if (card) card.style.display = 'none';
  }

  focusCameraOnPoint(pt) {
    if (!pt) return;
    const p = new THREE.Vector3(pt[0], pt[1], pt[2]);
    // Keep a gentle readable viewing angle slightly above and in front (+Z) of the selected pin
    const offset = new THREE.Vector3(0.05, 0.16, 0.22);
    this.camFlyTargetLook = p.clone();
    this.camFlyTargetPos = p.clone().add(offset);
  }

  /**
   * Selects a single 3D wire cable, illuminates it + both endpoint pin rings,
   * and shows an ultra-readable Dari (Asal) -> Ke (Tujuan) card.
   */
  selectWire(wireId, flyToMid = false) {
    const entry = this.rig?.wireById?.get(wireId);
    if (!entry) return false;
    const w = entry.spec;

    this.selectedWireId = w.id;
    this.selectedPinId = null;
    this.selectedHotspot = null;
    this.focusedWireNet = null;
    Object.values(this.hotspotButtons || {}).forEach((b) => b.classList.remove('selected'));

    const startPt = w.points[0];
    const endPt = w.points[w.points.length - 1];
    this.rig.setSelectionHighlight([w.id], startPt, [endPt]);

    const netMeta = WIRE_NET_META[w.category];
    const canJumpFrom = !!(w.fromPinId && this.rig.pinById.has(w.fromPinId));
    const canJumpTo = !!(w.toPinId && this.rig.pinById.has(w.toPinId));

    const fromEl = canJumpFrom
      ? `<button type="button" class="route-node route-origin" data-jump-pin="${escapeHtml(w.fromPinId)}" title="Klik untuk inspeksi pin asal"><span class="route-lbl">DARI</span><strong>${escapeHtml(w.fromPin)}</strong></button>`
      : `<span class="route-node route-origin"><span class="route-lbl">DARI</span><strong>${escapeHtml(w.fromPin)}</strong></span>`;
    const toEl = canJumpTo
      ? `<button type="button" class="route-node route-dest" data-jump-pin="${escapeHtml(w.toPinId)}" title="Klik untuk inspeksi pin tujuan"><span class="route-lbl">KE</span><strong>${escapeHtml(w.toPin)}</strong></button>`
      : `<span class="route-node route-dest"><span class="route-lbl">KE</span><strong>${escapeHtml(w.toPin)}</strong></span>`;

    this.renderInspectorCard({
      badgeText: 'KABEL',
      badgeColor: netMeta?.colorHex || '#0284c7',
      voltageText: w.voltage,
      titleText: `${w.fromPin} → ${w.toPin}`,
      routeHtml: `${fromEl}<span class="route-arrow" aria-hidden="true">→</span>${toEl}`,
      extraMetrics: '',
      descText: w.description
    });

    if (flyToMid) {
      const mid = [
        (startPt[0] + endPt[0]) * 0.5,
        (startPt[1] + endPt[1]) * 0.5,
        (startPt[2] + endPt[2]) * 0.5
      ];
      this.focusCameraOnPoint(mid);
    }
    return true;
  }

  /**
   * Selects any physical pin/screw terminal on ESP32, Breadboard, XL4015, RTC, LDR, SCC, Watt Meter, Servo, or Battery!
   */
  selectPin(pinId, flyCamera = false) {
    const pin = this.rig?.pinById?.get(pinId);
    if (!pin) return false;

    this.selectedPinId = pin.id;
    this.selectedWireId = null;
    this.selectedHotspot = null;
    this.focusedWireNet = null;
    Object.values(this.hotspotButtons || {}).forEach((b) => b.classList.remove('selected'));

    // Find all destination endpoint coordinates for connected wire(s)
    const targetPositions = [];
    const jumpTargets = [];
    for (const wid of (pin.wireIds || [])) {
      const entry = this.rig.wireById.get(wid);
      if (!entry) continue;
      const w = entry.spec;
      if (w.fromPinId === pin.id) {
        targetPositions.push(w.points[w.points.length - 1]);
        jumpTargets.push({ label: w.toPin, pinId: w.toPinId });
      } else if (w.toPinId === pin.id) {
        targetPositions.push(w.points[0]);
        jumpTargets.push({ label: w.fromPin, pinId: w.fromPinId });
      } else {
        targetPositions.push(w.points[w.points.length - 1]);
        jumpTargets.push({ label: `${w.fromPin} → ${w.toPin}`, pinId: w.toPinId });
      }
    }

    this.rig.setSelectionHighlight(pin.wireIds || [], pin.pos, targetPositions);

    const originNode = `<span class="route-node route-origin"><span class="route-lbl">DARI PIN</span><strong>${escapeHtml(pin.board)} · ${escapeHtml(pin.pinName)}</strong></span>`;
    let destHtml = '';
    if (jumpTargets.length > 0) {
      const first = jumpTargets[0];
      const canJump = !!(first.pinId && this.rig.pinById.has(first.pinId));
      destHtml = canJump
        ? `<button type="button" class="route-node route-dest" data-jump-pin="${escapeHtml(first.pinId)}" title="Klik untuk lompat ke pin tujuan"><span class="route-lbl">KE</span><strong>${escapeHtml(first.label)}</strong></button>`
        : `<span class="route-node route-dest"><span class="route-lbl">KE</span><strong>${escapeHtml(first.label)}</strong></span>`;
    } else {
      destHtml = `<span class="route-node route-empty"><span class="route-lbl">STATUS</span><strong>${escapeHtml(pin.connectedTo?.[0] || 'Kosong')}</strong></span>`;
    }

    const isActive = pin.status === 'AKTIF';
    this.renderInspectorCard({
      badgeText: isActive ? 'PIN' : 'PIN KOSONG',
      badgeColor: isActive ? '#059669' : '#d97706',
      voltageText: pin.voltage,
      titleText: `${pin.board} · ${pin.pinName}`,
      routeHtml: `${originNode}<span class="route-arrow" aria-hidden="true">→</span>${destHtml}`,
      extraMetrics: '',
      descText: pin.detail
    });

    if (flyCamera) {
      this.focusCameraOnPoint(pin.pos);
    }
    return true;
  }

  setWiringNetFocus(netKey) {
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

    if (this.focusedWireNet && WIRE_NET_META[this.focusedWireNet]) {
      const meta = WIRE_NET_META[this.focusedWireNet];
      this.selectedHotspot = null;
      Object.values(this.hotspotButtons || {}).forEach((b) => b.classList.remove('selected'));
      if (meta.preset) {
        this.flyToPreset(meta.preset);
        document.querySelectorAll('[data-3d-cam]').forEach((b) => {
          b.classList.toggle('active', b.dataset['3dCam'] === meta.preset);
        });
      }
      this.renderInspectorCard({
        badgeText: 'JALUR KABEL',
        badgeColor: meta.colorHex,
        voltageText: '',
        titleText: meta.label,
        routeHtml: '',
        extraMetrics: meta.pins,
        descText: meta.summary
      });
    } else if (!this.selectedHotspot) {
      const card = document.getElementById('rig3dInspector');
      if (card) card.style.display = 'none';
    }
  }

  bindUiControls() {

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
    const setSideCollapsed = (collapsed) => {
      this.sideCollapsed = !!collapsed;
      if (sidePanel) sidePanel.classList.toggle('collapsed', this.sideCollapsed);
      if (btnSideReopen) btnSideReopen.style.display = this.sideCollapsed ? 'inline-flex' : 'none';
      if (btnSideToggle) btnSideToggle.setAttribute('aria-expanded', String(!this.sideCollapsed));
      if (navPad) navPad.classList.toggle('side-hidden', this.sideCollapsed);
    };
    if (btnSideToggle) btnSideToggle.addEventListener('click', () => setSideCollapsed(true));
    if (btnSideReopen) btnSideReopen.addEventListener('click', () => setSideCollapsed(false));

    // Compact Floating Freeform Camera Nav Pad (Maju/Mundur, Geser, Naik/Turun, Zoom, Reset)
    // Supports BOTH quick tap (smooth impulse) AND press-and-hold (continuous smooth flight)
    document.querySelectorAll('[data-cam-hold]').forEach((btn) => {
      const action = btn.dataset.camHold;
      const startHold = (e) => {
        e.preventDefault();
        this.camFlyTargetPos = null;
        this.camFlyTargetLook = null;
        this.navHeld.add(action);
        btn.classList.add('active');
        // Small immediate impulse so a single tap moves smoothly too
        const dist = this.camera.position.distanceTo(this.controls.target);
        const step = clamp(dist * 0.14, 0.04, 0.28);
        if (action === 'fwd') this.queueFreeformMove(0, 0, step);
        else if (action === 'back') this.queueFreeformMove(0, 0, -step);
        else if (action === 'left') this.queueFreeformMove(-step, 0, 0);
        else if (action === 'right') this.queueFreeformMove(step, 0, 0);
        else if (action === 'up') this.queueFreeformMove(0, step, 0);
        else if (action === 'down') this.queueFreeformMove(0, -step, 0);
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
      btnCamReset.addEventListener('click', () => {
        this.freeMoveImpulse.set(0, 0, 0);
        this.freeZoomImpulse = 0;
        this.flyToPreset('overview');
        document.querySelectorAll('[data-3d-cam]').forEach((b) => {
          b.classList.toggle('active', b.dataset['3dCam'] === 'overview');
        });
      });
    }

    const navKeys = new Set(['w', 's', 'a', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
    window.addEventListener('keydown', (e) => {
      if (this.slot !== 'full') return;
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'h') setSideCollapsed(!this.sideCollapsed);
      else if (e.key === 'Escape') this.clearSelection();
      else if (navKeys.has(k)) {
        e.preventDefault();
        this.camFlyTargetPos = null;
        this.camFlyTargetLook = null;
        this.keysHeld.add(k);
        if (e.shiftKey) this.keysHeld.add('shift');
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
      document.querySelectorAll('[data-cam-hold].active').forEach((b) => b.classList.remove('active'));
    });

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
    if (!this.controls || !this.camera) return;
    this.camFlyTargetPos = null;
    this.camFlyTargetLook = null;
    this.freeZoomImpulse = clamp(this.freeZoomImpulse + logDelta, -1.2, 1.2);
  }

  applyEnvironment(mode) {
    this.envMode = mode === 'workshop' ? 'workshop' : 'outdoor';
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
  }

  setLightTestMode(active) {
    this.lightTestMode = !!active;
    this.guideArc.visible = this.lightTestMode && this.slot === 'full';
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
    const p = CAMERA_PRESETS[name] || CAMERA_PRESETS.overview;
    this.camFlyTargetPos = new THREE.Vector3(...p.pos);
    this.camFlyTargetLook = new THREE.Vector3(...p.target);

    const macroGrp = MACRO_PRESET_GROUPS[name] || null;
    if (macroGrp) {
      this.setPinLabelsVisible(true, macroGrp);
    } else if (name === 'overview' || name === 'front') {
      this.setPinLabelsVisible(false, null);
    }
  }

  selectHotspot(id) {
    this.selectedHotspot = id;
    this.selectedWireId = null;
    this.selectedPinId = null;
    if (this.rig) this.rig.setSelectionHighlight([], null, []);

    if (!id || !HOTSPOT_META[id]) {
      const card = document.getElementById('rig3dInspector');
      if (card) card.style.display = 'none';
      Object.values(this.hotspotButtons || {}).forEach((b) => b.classList.remove('selected'));
      return;
    }

    const meta = HOTSPOT_META[id];
    this.flyToPreset(meta.preset);
    document.querySelectorAll('[data-3d-cam]').forEach((b) => {
      b.classList.toggle('active', b.dataset['3dCam'] === meta.preset);
    });
    Object.entries(this.hotspotButtons || {}).forEach(([k, b]) => {
      b.classList.toggle('selected', k === id);
    });

    this.refreshInspectorContent();
  }

  refreshInspectorContent() {
    if (!this.selectedHotspot) return;
    const meta = HOTSPOT_META[this.selectedHotspot];
    if (!meta) return;

    const d = this.lastStatus;
    const e = this.lastElec;
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
      const s = d?.servo || { mode: 'AUTO', deg: 90, target: 90 };
      metrics = `MG996R · Mode: ${s.locked ? 'SAFE-LOCK' : s.mode} · Sudut: ${s.deg}° (Target ${s.target}°) · Suplai XL4015: ${e.xl4015OutV.toFixed(2)} V / ${e.xl4015OutA.toFixed(2)} A`;
    } else if (this.selectedHotspot === 'wattmeter') {
      metrics = `Tegangan Panel (Est.): ${e.panelVoltage.toFixed(2)} V · Arus (Est.): ${e.currentAmp.toFixed(2)} A · Daya: ${e.watts.toFixed(1)} W`;
    } else if (this.selectedHotspot === 'breadboard') {
      metrics = '3 kabel Common GND: XL4015 OUT− · Servo MG996R (Cokelat) · ESP32 GND';
    } else if (this.selectedHotspot === 'esp32') {
      const fw = d?.firmwareVersion || '--';
      const rssi = d?.wifi?.ok ? `${d.wifi.rssi} dBm` : 'USB / Sim';
      const temp = typeof d?.tempC === 'number' ? `${d.tempC.toFixed(1)}°C` : '--°C';
      const heap = d?.freeHeap ? `${Math.round(d.freeHeap / 1024)} KB` : '--';
      metrics = `FW: ${fw} · WiFi: ${rssi} · Suhu: ${temp} · Heap: ${heap} · 3V3 Sag: ${d?.pwr?.sagMv ?? 0} mV`;
    } else if (this.selectedHotspot === 'rtc') {
      const rtcTime = d?.rtc?.time || '--';
      const rtcState = (d?.rtc?.present && d?.rtc?.running) ? 'AKTIF (I2C OK)' : 'PERLU SINKRON';
      const eep = d?.eeprom ? 'AT24C32 (0x50) Siap' : '0x68 RTC';
      metrics = `Waktu RTC: ${rtcTime} · Status: ${rtcState} · ${eep} · I2C Err: ${d?.i2cErr ?? 0}`;
    } else if (this.selectedHotspot === 'xl4015') {
      const loadLbl = e.servoActive ? 'Aktif menggerakkan MG996R' : 'Siaga (Idle)';
      metrics = `IN (LOAD SCC): ${e.xl4015InV.toFixed(1)} V → OUT (MG996R): ${e.xl4015OutV.toFixed(2)} V · Arus Est.: ${e.xl4015OutA.toFixed(2)} A (${loadLbl})`;
    } else if (this.selectedHotspot === 'scc') {
      metrics = `Tegangan Aki (Est.): ${e.batteryVoltage.toFixed(1)} V · Status: ${e.charging ? 'Mengisi dari Panel' : 'Siaga / Gelap'} · LOAD 12V → XL4015`;
    } else if (this.selectedHotspot === 'battery') {
      metrics = `INCOE SA-20 12V 22Ah · Tegangan Est.: ${e.batteryVoltage.toFixed(1)} V (${e.batterySoc}%) · 3V3 Sag: ${d?.pwr?.sagMv ?? 0} mV`;
    }

    this.renderInspectorCard({
      badgeText: 'KOMPONEN',
      badgeColor: '#007aff',
      voltageText: '',
      titleText: meta.title,
      routeHtml: '',
      extraMetrics: metrics,
      descText: meta.wiring
    });
  }

  setActiveView(viewName) {
    if (viewName === 'twin3d') {
      this.slot = 'full';
      if (this.fullMount && this.renderer.domElement.parentNode !== this.fullMount) {
        this.fullMount.appendChild(this.renderer.domElement);
      }
      this.controls.enabled = true;
      this.guideArc.visible = this.lightTestMode;
      this.camera.fov = 38;
      this.handleResize();
      this.startLoop();
    } else {
      this.slot = 'hidden';
      this.stopLoop();
    }
  }

  handleResize() {
    if (this.slot !== 'full' || !this.fullMount) return;
    const rect = this.fullMount.getBoundingClientRect();
    const w = Math.max(120, Math.round(rect.width));
    const h = Math.max(120, Math.round(rect.height));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  updateMouseNdc(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._mouseNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouseNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  updateFromStatus(d) {
    if (!d) return;
    this.lastStatus = d;

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
      hudMeta.textContent = `Servo ${srv.deg ?? 90}° (${modeStr}) · LDR1 ${d.ldr1?.pct ?? 0}% / LDR2 ${d.ldr2?.pct ?? 0}% · ${srcStr}`;
    }

    if (this.selectedHotspot) {
      this.refreshInspectorContent();
    }
  }

  updateProjectedOverlays() {
    if (this.slot !== 'full') return;
    const rect = this.fullMount.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 10 || h < 10) return;

    const camDist = this.camera.position.distanceTo(this.controls.target);
    const isMacroClose = camDist < 0.45;

    if (this.showHotspots && this.hotspotLayer) {
      for (const [id, anchor] of Object.entries(this.rig.hotspotAnchors)) {
        const btn = this.hotspotButtons[id];
        if (!btn) continue;
        if (isMacroClose && this.showPinLabels) {
          btn.style.opacity = '0';
          btn.style.pointerEvents = 'none';
          continue;
        }
        anchor.getWorldPosition(this._vec3);
        this._vec3.project(this.camera);
        const visible = this._vec3.z > -1 && this._vec3.z < 1;
        if (!visible) {
          btn.style.opacity = '0';
          btn.style.pointerEvents = 'none';
          continue;
        }
        const sx = (this._vec3.x * 0.5 + 0.5) * w;
        const sy = (-this._vec3.y * 0.5 + 0.5) * h;
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%)`;
      }
    }

    if (this.showPinLabels && this.pinCalloutNodes) {
      for (const item of this.pinCalloutNodes) {
        const groupMatch = !this.activeMacroGroup || item.group === this.activeMacroGroup;
        if (!groupMatch) {
          item.el.style.opacity = '0';
          continue;
        }
        item.anchor.getWorldPosition(this._vec3);
        const distToCam = this._vec3.distanceTo(this.camera.position);
        this._vec3.project(this.camera);
        const inView = this._vec3.z > -1 && this._vec3.z < 1 && distToCam < 1.35 &&
          this._vec3.x > -0.95 && this._vec3.x < 0.95 && this._vec3.y > -0.92 && this._vec3.y < 0.92;
        if (!inView) {
          item.el.style.opacity = '0';
          continue;
        }
        const sx = (this._vec3.x * 0.5 + 0.5) * w;
        const sy = (-this._vec3.y * 0.5 + 0.5) * h;
        item.el.style.opacity = '1';
        item.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -115%)`;
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

    const panelTiltRad = servoDegToPanelTiltRad(this.curServoDeg, this.curTrimDeg, invert);
    const hornRad = servoDegToHornRad(this.curServoDeg, this.curTrimDeg, invert);
    this.rig.updateMechanics(panelTiltRad, hornRad);

    this.curLightPos.lerp(this.targetLightPos, 1 - Math.exp(-8 * dt));
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

    if (this.slot === 'full' && this.camFlyTargetPos && this.camFlyTargetLook) {
      const k = 1 - Math.exp(-6.5 * dt);
      this.camera.position.lerp(this.camFlyTargetPos, k);
      this.controls.target.lerp(this.camFlyTargetLook, k);
      if (this.camera.position.distanceTo(this.camFlyTargetPos) < 0.008) {
        this.camera.position.copy(this.camFlyTargetPos);
        this.controls.target.copy(this.camFlyTargetLook);
        this.camFlyTargetPos = null;
        this.camFlyTargetLook = null;
      }
    }

    if (this.slot === 'full') {
      // 1) Apply continuous freeform held movement (W/S maju-mundur, A/D strafe, Q/E/arrows up-down)
      const moveFwd = (this.keysHeld.has('w') || this.navHeld.has('fwd') ? 1 : 0)
        - (this.keysHeld.has('s') || this.navHeld.has('back') ? 1 : 0);
      const moveRight = (this.keysHeld.has('d') || this.keysHeld.has('arrowright') || this.navHeld.has('right') ? 1 : 0)
        - (this.keysHeld.has('a') || this.keysHeld.has('arrowleft') || this.navHeld.has('left') ? 1 : 0);
      const moveUp = (this.keysHeld.has('e') || this.keysHeld.has('arrowup') || this.navHeld.has('up') ? 1 : 0)
        - (this.keysHeld.has('q') || this.keysHeld.has('arrowdown') || this.navHeld.has('down') ? 1 : 0);

      this._moveVec.set(0, 0, 0);
      if (moveFwd || moveRight || moveUp) {
        const curDist = this.camera.position.distanceTo(this.controls.target);
        const speedBoost = this.keysHeld.has('shift') ? 2.0 : 1.0;
        const speed = clamp(curDist * 0.95, 0.20, 2.2) * speedBoost * dt;

        this.camera.getWorldDirection(this._camFwd).normalize();
        this._camRight.crossVectors(this._camFwd, this._upAxis);
        if (this._camRight.lengthSq() < 1e-6) {
          this._camRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
        } else {
          this._camRight.normalize();
        }
        if (moveFwd) this._moveVec.addScaledVector(this._camFwd, moveFwd * speed);
        if (moveRight) this._moveVec.addScaledVector(this._camRight, moveRight * speed);
        if (moveUp) this._moveVec.y += moveUp * speed;
      }

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
      this.controls.update();
    }
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

  startLoop() {
    if (this.running || this.contextLost) return;
    this.running = true;
    this.lastFrameTime = performance.now();

    const tick = () => {
      if (!this.running || this.contextLost) return;
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0.001, (now - this.lastFrameTime) / 1000));
      this.lastFrameTime = now;

      this.stepScene(dt);
      this.renderer.render(this.scene, this.camera);
      this.updateProjectedOverlays();

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
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
