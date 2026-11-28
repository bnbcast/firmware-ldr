'use strict';

import * as THREE from 'three';
import {
  createPowderCoatBumpMap,
  createBrushedMetalBumpMap,
  createPcbFiberglassBumpMap,
  createSolarFrontTexture,
  createSolarBackTexture,
  createJunctionBoxTexture,
  createIncoeBatteryTexture,
  createContactShadowTexture,
  createSccDisplay,
  createWattMeterDisplay,
  createXl4015Texture,
  createCap220TopTexture,
  createCap47TopTexture,
  createBreadboardTexture,
  createTinyRtcTexture,
  createGoouuuTexture,
  createNodeMcuTopTexture,
  createEspRfShieldTexture,
  createIcLabelTexture,
  createMicroUsbTopTexture,
  createUsbCTopTexture,
  createCoinCellTopTexture,
  createLm393Texture,
  createCdsPhotoresistorTexture,
  createMg996rLabelTexture
} from './rig3d-textures.js';
import { computePushrodGeometry } from './rig3d-math.js';
import {
  RIG_DIMS,
  BOARD_ORIGINS,
  GOOUUU_GEO,
  BREADBOARD_GEO,
  ACTIVE_DUPONT_PLUGS,
  SERVO_PLUG_PINS,
  getGoouuuPinPos,
  getBreadboardGndPinPos,
  getTinyRtcPinPos,
  getLdrPinPos,
  getXl4015PinPos,
  getSccTerminalPos,
  buildPinAccurateWireSpecs,
  buildClickablePinRegistry,
  buildMacroPinCallouts
} from './rig3d-wiring.js';

export { RIG_DIMS };
export const HOTSPOT_LAYER = 1;
export const WIRE_HIT_LAYER = 2;
export const PIN_HIT_LAYER = 3;

function makeCableEntry(spec) {
  const curve = new THREE.CatmullRomCurve3(spec.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const segs = Math.max(20, spec.points.length * 7);
  const geo = new THREE.TubeGeometry(curve, segs, spec.radius, 8, false);
  const mat = new THREE.MeshStandardMaterial({
    color: spec.baseColor,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.42,
    metalness: 0.08
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.wireId = spec.id;
  mesh.userData.wireCategory = spec.category;
  mesh.userData.wireSpec = spec;

  // Wider invisible tube proxy on WIRE_HIT_LAYER makes clicking any thin jumper wire effortless!
  const hitRadius = Math.max(spec.radius * 3.1, 0.0072);
  const hitGeo = new THREE.TubeGeometry(curve, Math.max(14, Math.floor(segs * 0.7)), hitRadius, 6, false);
  const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
  hitMesh.layers.set(WIRE_HIT_LAYER);
  hitMesh.userData.wireId = spec.id;
  hitMesh.userData.wireSpec = spec;

  return {
    id: spec.id,
    spec,
    fromPin: spec.fromPin,
    toPin: spec.toPin,
    mesh,
    hitMesh,
    mat,
    baseColor: spec.baseColor,
    highlightHex: spec.highlightHex,
    category: spec.category
  };
}

function addHotspotProxy(parent, id, size, offset = [0, 0, 0]) {
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  proxy.position.set(offset[0], offset[1], offset[2]);
  proxy.userData.hotspotId = id;
  proxy.layers.set(HOTSPOT_LAYER);
  parent.add(proxy);
  return proxy;
}

function buildInstancedBatch(geometry, material, matrices, name) {
  if (!matrices.length) return null;
  const inst = new THREE.InstancedMesh(geometry, material, matrices.length);
  inst.name = name;
  for (let i = 0; i < matrices.length; i++) {
    inst.setMatrixAt(i, matrices[i]);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  return inst;
}

function createPinHaloMarker(colorHex) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.0056, 0.0011, 10, 24),
    new THREE.MeshBasicMaterial({ color: colorHex, depthTest: false, transparent: true, opacity: 0.96 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.renderOrder = 20;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.0023, 12, 12),
    new THREE.MeshBasicMaterial({ color: colorHex, depthTest: false, transparent: true, opacity: 0.94 })
  );
  core.renderOrder = 21;

  group.add(ring, core);
  group.visible = false;
  return group;
}

/**
 * Builds the ultra-realistic front-stacked 3D SolarTracker Digital Twin:
 * - TOP:    Monocrystalline Solar Panel pitched slightly forward (+Z) facing same side as Watt Meter & SCC
 * - UPPER:  Blue Digital Watt Meter on front (+Z) post directly above Charge Controller
 * - MIDDLE: Blue PWM Solar Charge Controller (6 recessed green terminals + brass screws)
 * - LOWER:  Horizontal White Electronics Deck holding:
 *             LDR Baffle & 2x LM393 | Red XL4015 CC/CV (2 blue terminals, 220 50V VT caps, W103 trimpots)
 *             | White Solderless Breadboard (Common GND Bus) | Purple GOOUUU ESP32-S V4 | Tiny RTC DS1307
 * - FLOOR:  INCOE SA-20 12V VRLA Battery + 4-leg '+' steel stand
 * - INTERACTIVE: Every physical pin & every 3D cable is directly hoverable & clickable with 3D halo rings!
 */
export function buildSolarTrackerRig(renderer, isSoftwareGl) {
  const maxAniso = isSoftwareGl ? 1 : Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const root = new THREE.Group();
  root.name = 'SolarTrackerRigRoot';

  const hotspotAnchors = {};
  const hotspotProxies = [];
  const pinCalloutAnchors = [];
  const wireEntries = [];
  const wireHitProxies = [];
  const pinHitProxies = [];
  const structuralMats = [];
  const disposables = [];

  const trackStructMat = (mat) => {
    structuralMats.push({
      mat,
      origTransparent: !!mat.transparent,
      origOpacity: mat.opacity ?? 1
    });
    return mat;
  };

  // Micro-surface procedural bump maps (linear NoColorSpace)
  const powderBump = createPowderCoatBumpMap(maxAniso);
  const brushedBump = createBrushedMetalBumpMap(maxAniso);
  const pcbBump = createPcbFiberglassBumpMap(maxAniso);
  disposables.push(powderBump, brushedBump, pcbBump);

  // Shared PBR Materials
  const blackSteelMat = trackStructMat(new THREE.MeshStandardMaterial({
    color: 0x16191f,
    roughness: 0.42,
    metalness: 0.64,
    bumpMap: powderBump,
    bumpScale: 0.0018
  }));
  const darkPlasticMat = trackStructMat(new THREE.MeshStandardMaterial({
    color: 0x1e2127,
    roughness: 0.56,
    metalness: 0.12
  }));
  const dupontHousingMat = new THREE.MeshStandardMaterial({
    color: 0x14161a,
    roughness: 0.44,
    metalness: 0.10
  });
  const matteRubberMat = new THREE.MeshStandardMaterial({
    color: 0x17191d,
    roughness: 0.84,
    metalness: 0.04
  });
  const whiteDeckMat = trackStructMat(new THREE.MeshStandardMaterial({
    color: 0xe6eaf1,
    roughness: 0.46,
    metalness: 0.04,
    bumpMap: powderBump,
    bumpScale: 0.0006
  }));
  const brushedSteelMat = new THREE.MeshStandardMaterial({
    color: 0xd8dee6,
    roughness: 0.22,
    metalness: 0.90,
    bumpMap: brushedBump,
    bumpScale: 0.0012
  });
  const goldPinMat = new THREE.MeshStandardMaterial({
    color: 0xf0c752,
    roughness: 0.20,
    metalness: 0.94
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd8a842,
    roughness: 0.28,
    metalness: 0.88
  });
  const copperCoilMat = new THREE.MeshStandardMaterial({
    color: 0xd16c33,
    roughness: 0.22,
    metalness: 0.90
  });
  const greenTermMat = new THREE.MeshStandardMaterial({
    color: 0x197a46,
    roughness: 0.42,
    metalness: 0.06
  });
  const blueTermMat = new THREE.MeshStandardMaterial({
    color: 0x1b63d6,
    roughness: 0.34,
    metalness: 0.08
  });
  const smdDarkMat = new THREE.MeshStandardMaterial({
    color: 0x1b1e24,
    roughness: 0.35,
    metalness: 0.22
  });

  // Procedural High-DPI Textures & Live LCD Canvases
  const solarFrontTex = createSolarFrontTexture(maxAniso);
  const solarBackTex = createSolarBackTexture(maxAniso);
  const jboxTex = createJunctionBoxTexture(maxAniso);
  const incoeTex = createIncoeBatteryTexture(maxAniso);
  const contactShadowTex = createContactShadowTexture();
  const sccDisplay = createSccDisplay(maxAniso);
  const wattDisplay = createWattMeterDisplay(maxAniso);
  const xl4015Tex = createXl4015Texture(maxAniso);
  const cap220TopTex = createCap220TopTexture(maxAniso);
  const cap47TopTex = createCap47TopTexture(maxAniso);
  const breadboardTex = createBreadboardTexture(maxAniso);
  const tinyRtcTex = createTinyRtcTexture(maxAniso);
  const goouuuTex = createGoouuuTexture(maxAniso);
  const nodeMcuTex = createNodeMcuTopTexture(maxAniso);
  const rfShieldTex = createEspRfShieldTexture(maxAniso);
  const ams33Tex = createIcLabelTexture(maxAniso, {
    lines: ['AMS1117', '3.3', 'H550PY'],
    bgHex: '#1c2026',
    textHex: '#cbd5e1'
  });
  const cp2102Tex = createIcLabelTexture(maxAniso, {
    lines: ['SILABS', 'CP2102', 'DCL00X', '1708+'],
    bgHex: '#181c22',
    textHex: '#d1d9e4',
    pinDot: true
  });
  const tant107Tex = createIcLabelTexture(maxAniso, {
    lines: ['107J', '6841'],
    bgHex: '#e8a428',
    textHex: '#7c2d12',
    stripeSide: 'left',
    stripeHex: '#9a3412'
  });
  const c226Tex = createIcLabelTexture(maxAniso, {
    lines: ['C226'],
    bgHex: '#1c2026',
    textHex: '#e2e8f0'
  });
  const res103Tex = createIcLabelTexture(maxAniso, {
    lines: ['103'],
    bgHex: '#16191f',
    textHex: '#f1f5f9'
  });
  const reg5vTex = createIcLabelTexture(maxAniso, {
    lines: ['1117', '5.0', 'A251'],
    bgHex: '#1c2026',
    textHex: '#cbd5e1',
    rotateDeg: -90
  });
  const ss24Tex = createIcLabelTexture(maxAniso, {
    lines: ['SS24'],
    bgHex: '#191c22',
    textHex: '#d1d9e4',
    stripeSide: 'left',
    stripeHex: '#94a3b8'
  });
  const res102Tex = createIcLabelTexture(maxAniso, {
    lines: ['102'],
    bgHex: '#16191f',
    textHex: '#f8fafc'
  });
  const microUsbTopTex = createMicroUsbTopTexture(maxAniso);
  const usbCTopTex = createUsbCTopTexture(maxAniso);
  const ds1307Tex = createIcLabelTexture(maxAniso, {
    lines: ['DS1307Z', '1932A4'],
    bgHex: '#181c22',
    textHex: '#d5dde8',
    pinDot: true
  });
  const at24c32Tex = createIcLabelTexture(maxAniso, {
    lines: ['ATMLH', '24C32N'],
    bgHex: '#181c22',
    textHex: '#d5dde8',
    pinDot: true
  });
  const res332Tex = createIcLabelTexture(maxAniso, { lines: ['332'], bgHex: '#16191f', textHex: '#f1f5f9' });
  const res201Tex = createIcLabelTexture(maxAniso, { lines: ['201'], bgHex: '#16191f', textHex: '#f1f5f9' });
  const res514Tex = createIcLabelTexture(maxAniso, { lines: ['514'], bgHex: '#16191f', textHex: '#f1f5f9', rotateDeg: 90 });
  const res155Tex = createIcLabelTexture(maxAniso, { lines: ['155'], bgHex: '#16191f', textHex: '#f1f5f9', rotateDeg: 90 });
  const coinCellTopTex = createCoinCellTopTexture(maxAniso);
  const lm393Ldr1Tex = createLm393Texture(maxAniso, 'LDR1');
  const lm393Ldr2Tex = createLm393Texture(maxAniso, 'LDR2');
  const cdsTex = createCdsPhotoresistorTexture(maxAniso);
  const mg996rLabelTex = createMg996rLabelTexture(maxAniso);
  disposables.push(
    solarFrontTex, solarBackTex, jboxTex, incoeTex, contactShadowTex,
    sccDisplay.texture, wattDisplay.texture, xl4015Tex, cap220TopTex, cap47TopTex,
    breadboardTex, tinyRtcTex, goouuuTex, nodeMcuTex, rfShieldTex,
    ams33Tex, cp2102Tex, tant107Tex, c226Tex, res103Tex, reg5vTex, ss24Tex, res102Tex,
    microUsbTopTex, usbCTopTex, coinCellTopTex, ds1307Tex, at24c32Tex, res332Tex, res201Tex, res514Tex, res155Tex,
    lm393Ldr1Tex, lm393Ldr2Tex, cdsTex, mg996rLabelTex
  );

  // Instanced geometry matrix collectors (world-space relative to root)
  const goldPinMats = [];
  const dupontMats = [];
  const crimpMats = [];
  const brassScrewMats = [];
  const boltMats = [];
  const smdMats = [];

  const _dummy = new THREE.Object3D();
  const pushInst = (list, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    _dummy.position.set(x, y, z);
    _dummy.rotation.set(rx, ry, rz);
    _dummy.scale.set(sx, sy, sz);
    _dummy.updateMatrix();
    list.push(_dummy.matrix.clone());
  };

  const pushDupontPlug = (pinWorld) => {
    pushInst(dupontMats, pinWorld[0], pinWorld[1] - 0.0052, pinWorld[2], 0, 0, 0, 1, 1, 1);
    pushInst(crimpMats, pinWorld[0], pinWorld[1] - 0.0046, pinWorld[2] + 0.00145, 0, 0, 0, 1, 1, 1);
  };

  // ==========================================================================
  // 1. BLACK STEEL 4-LEG '+' FLOOR STAND & VERTICAL POST (grounded at y = 0)
  // ==========================================================================
  const standGroup = new THREE.Group();
  standGroup.name = 'SteelStandGroup';
  root.add(standGroup);

  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.18, 1.18),
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.52
    })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.002;
  standGroup.add(shadowPlane);

  const legX = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.032, 0.046), blackSteelMat);
  legX.position.set(0, 0.016, 0);
  legX.castShadow = true;
  legX.receiveShadow = true;
  const legZ = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.032, 0.68), blackSteelMat);
  legZ.position.set(0, 0.016, 0);
  legZ.castShadow = true;
  legZ.receiveShadow = true;
  standGroup.add(legX, legZ);

  for (const [cx, cz] of [[-0.34, 0], [0.34, 0], [0, -0.34], [0, 0.34]]) {
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(cx !== 0 ? 0.010 : 0.050, 0.036, cz !== 0 ? 0.010 : 0.050),
      matteRubberMat
    );
    cap.position.set(cx, 0.018, cz);
    standGroup.add(cap);
  }

  const postMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.048, RIG_DIMS.postHeight, 0.048),
    blackSteelMat
  );
  postMesh.position.set(0, RIG_DIMS.postHeight / 2 + 0.016, 0);
  postMesh.castShadow = true;
  postMesh.receiveShadow = true;
  standGroup.add(postMesh);

  for (const ty of [0.42, 0.75, 1.02, 1.24]) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.006, 0.056), matteRubberMat);
    tie.position.set(0, ty, 0);
    standGroup.add(tie);
  }

  // Top hinge clevis plates flank left/right (-X/+X) with horizontal X axle so panel pitches +Z (Watt Meter) <-> -Z (opposite)!
  const clevisLeft = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.056, 0.044), blackSteelMat);
  clevisLeft.position.set(-0.024, RIG_DIMS.pivotPos.y, 0);
  const clevisRight = clevisLeft.clone();
  clevisRight.position.x = 0.024;
  standGroup.add(clevisLeft, clevisRight);

  const hingeBolt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.082, 16),
    brushedSteelMat
  );
  hingeBolt.rotation.z = Math.PI / 2;
  hingeBolt.position.set(0, RIG_DIMS.pivotPos.y, 0);
  standGroup.add(hingeBolt);

  pushInst(boltMats, 0.042, RIG_DIMS.pivotPos.y, 0, 0, 0, Math.PI / 2, 2.4, 1.5, 2.4);
  pushInst(boltMats, -0.042, RIG_DIMS.pivotPos.y, 0, 0, 0, Math.PI / 2, 2.4, 1.5, 2.4);

  // ==========================================================================
  // 2. INCOE SA-20 12V 22Ah VRLA BATTERY (grounded at y = 0)
  // ==========================================================================
  const batteryGroup = new THREE.Group();
  batteryGroup.name = 'BatteryIncoeGroup';
  batteryGroup.position.set(BOARD_ORIGINS.bat.x, BOARD_ORIGINS.bat.y, BOARD_ORIGINS.bat.z);
  batteryGroup.rotation.y = BOARD_ORIGINS.bat.rotY;
  root.add(batteryGroup);

  const batShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.38, 0.28),
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.42
    })
  );
  batShadow.rotation.x = -Math.PI / 2;
  batShadow.position.y = 0.003;
  batteryGroup.add(batShadow);

  const batTealMat = trackStructMat(new THREE.MeshStandardMaterial({
    color: 0x0d5c5f,
    roughness: 0.46,
    metalness: 0.05
  }));
  const batFrontMat = trackStructMat(new THREE.MeshStandardMaterial({
    map: incoeTex,
    roughness: 0.42,
    metalness: 0.04
  }));

  const batBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.175, 0.125),
    [batTealMat, batTealMat, batTealMat, batTealMat, batFrontMat, batTealMat]
  );
  batBody.position.y = 0.088;
  batBody.castShadow = true;
  batBody.receiveShadow = true;
  batteryGroup.add(batBody);

  const batLid = new THREE.Mesh(new THREE.BoxGeometry(0.226, 0.032, 0.13), darkPlasticMat);
  batLid.position.y = 0.191;
  batLid.castShadow = true;
  batteryGroup.add(batLid);

  const termNeg = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.016, 0.018), brushedSteelMat);
  termNeg.position.set(-0.075, 0.214, 0);
  const termPos = termNeg.clone();
  termPos.position.x = 0.075;
  batteryGroup.add(termNeg, termPos);

  const clipBlackMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.52 });
  const clipRedMat = new THREE.MeshStandardMaterial({ color: 0xd92c2c, roughness: 0.46 });

  const buildAlligatorClip = (xPos, tiltZ, bootMat) => {
    const g = new THREE.Group();
    g.position.set(xPos, 0.232, 0);
    g.rotation.z = tiltZ;
    const jaw1 = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.028, 0.005), brushedSteelMat);
    jaw1.position.set(0, -0.004, 0.005);
    const jaw2 = jaw1.clone();
    jaw2.position.z = -0.005;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.044, 0.022), bootMat);
    handle.position.y = 0.022;
    g.add(jaw1, jaw2, handle);
    return g;
  };
  batteryGroup.add(buildAlligatorClip(-0.075, 0.22, clipBlackMat));
  batteryGroup.add(buildAlligatorClip(0.075, -0.18, clipRedMat));

  hotspotAnchors.battery = new THREE.Object3D();
  hotspotAnchors.battery.position.set(0, 0.15, 0.08);
  batteryGroup.add(hotspotAnchors.battery);
  hotspotProxies.push(addHotspotProxy(batteryGroup, 'battery', [0.28, 0.28, 0.18], [0, 0.14, 0]));

  // ==========================================================================
  // 3. BLUE ANODIZED DIGITAL WATT METER (UPPER FRONT +Z, ABOVE CHARGE CONTROLLER!)
  // ==========================================================================
  const wattGroup = new THREE.Group();
  wattGroup.name = 'WattMeterGroup';
  wattGroup.position.set(BOARD_ORIGINS.watt.x, BOARD_ORIGINS.watt.y, BOARD_ORIGINS.watt.z);
  wattGroup.rotation.y = BOARD_ORIGINS.watt.rotY;
  root.add(wattGroup);

  const wattMountBracket = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.068, 0.014), blackSteelMat);
  wattMountBracket.position.set(0, 0, -0.021);
  wattGroup.add(wattMountBracket);

  const anodizedBlueMat = new THREE.MeshStandardMaterial({
    color: 0x0784cf,
    roughness: 0.26,
    metalness: 0.80,
    bumpMap: brushedBump,
    bumpScale: 0.0009
  });
  const wattBody = new THREE.Mesh(new THREE.BoxGeometry(0.148, 0.084, 0.036), anodizedBlueMat);
  wattBody.castShadow = true;
  wattBody.receiveShadow = true;
  wattGroup.add(wattBody);

  for (const sx of [-0.074, 0.074]) {
    for (const sy of [-0.012, 0.012]) {
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.008, 10), matteRubberMat);
      boot.rotation.z = Math.PI / 2;
      boot.position.set(sx, sy, 0);
      wattGroup.add(boot);
    }
  }

  const wattFaceMat = new THREE.MeshStandardMaterial({
    map: wattDisplay.texture,
    emissive: 0x093159,
    emissiveMap: wattDisplay.texture,
    emissiveIntensity: 0.42,
    roughness: 0.24,
    metalness: 0.20
  });
  const wattFace = new THREE.Mesh(new THREE.PlaneGeometry(0.142, 0.078), wattFaceMat);
  wattFace.position.z = 0.0186;
  wattGroup.add(wattFace);

  for (const sx of [-0.066, 0.066]) {
    for (const sy of [-0.035, 0.035]) {
      pushInst(boltMats, BOARD_ORIGINS.watt.x + sx, BOARD_ORIGINS.watt.y + sy, BOARD_ORIGINS.watt.z + 0.019, Math.PI / 2, 0, 0, 0.9, 1.0, 0.9);
    }
  }

  hotspotAnchors.wattmeter = new THREE.Object3D();
  hotspotAnchors.wattmeter.position.set(0.108, 0.034, 0.024);
  wattGroup.add(hotspotAnchors.wattmeter);
  hotspotProxies.push(addHotspotProxy(wattGroup, 'wattmeter', [0.18, 0.11, 0.07]));

  // ==========================================================================
  // 4. BLUE PWM SOLAR CHARGE CONTROLLER (MIDDLE FRONT +Z, DIRECTLY BELOW WATT METER!)
  // ==========================================================================
  const sccGroup = new THREE.Group();
  sccGroup.name = 'SolarChargeControllerGroup';
  sccGroup.position.set(BOARD_ORIGINS.scc.x, BOARD_ORIGINS.scc.y, BOARD_ORIGINS.scc.z);
  root.add(sccGroup);

  const sccBody = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.118, 0.046), darkPlasticMat);
  sccBody.castShadow = true;
  sccBody.receiveShadow = true;
  sccGroup.add(sccBody);

  const flangeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.214, 0.095, 0.008), darkPlasticMat);
  flangeMesh.position.z = -0.018;
  sccGroup.add(flangeMesh);

  const sccFaceMat = new THREE.MeshStandardMaterial({
    map: sccDisplay.texture,
    roughness: 0.34,
    metalness: 0.05
  });
  const sccFace = new THREE.Mesh(new THREE.PlaneGeometry(0.172, 0.104), sccFaceMat);
  sccFace.position.z = 0.0236;
  sccGroup.add(sccFace);

  for (let b = 0; b < 3; b++) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.005, 14), matteRubberMat);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(-0.012 + b * 0.022, -0.021, 0.025);
    sccGroup.add(btn);
  }

  const usbShell = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.032, 0.008), brushedSteelMat);
  usbShell.position.set(0.066, 0.016, 0.022);
  const usbSlot1 = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.007, 0.004), matteRubberMat);
  usbSlot1.position.set(0.066, 0.023, 0.027);
  const usbSlot2 = usbSlot1.clone();
  usbSlot2.position.y = 0.009;
  sccGroup.add(usbShell, usbSlot1, usbSlot2);

  // 6 individual green recessed screw terminals (+PV-, +BAT-, +LOAD-) cleanly proud of body
  for (let i = 0; i < 6; i++) {
    const tx = -0.055 + i * 0.022;
    const tBlock = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.015, 0.018), greenTermMat);
    tBlock.position.set(tx, -0.0525, 0.0165);
    sccGroup.add(tBlock);
    const termW = getSccTerminalPos(i).world;
    pushInst(brassScrewMats, termW[0], termW[1] + 0.004, termW[2] + 0.013, Math.PI / 2, 0, 0, 1.35, 1.1, 1.35);
    pushInst(boltMats, termW[0], termW[1] - 0.003, termW[2], 0, 0, 0, 0.85, 1.8, 0.85);
  }

  for (const [fx, fy] of [[-0.098, 0.034], [-0.098, -0.034], [0.098, 0.034], [0.098, -0.034]]) {
    pushInst(boltMats, BOARD_ORIGINS.scc.x + fx, BOARD_ORIGINS.scc.y + fy, BOARD_ORIGINS.scc.z - 0.012, Math.PI / 2, 0, 0, 1.1, 1.1, 1.1);
  }

  hotspotAnchors.scc = new THREE.Object3D();
  hotspotAnchors.scc.position.set(0.125, 0.012, 0.032);
  sccGroup.add(hotspotAnchors.scc);
  hotspotProxies.push(addHotspotProxy(sccGroup, 'scc', [0.22, 0.14, 0.08]));

  // ==========================================================================
  // 5. SERVO MG996R (METAL GEAR) + DECAL + 3-PIN PIGTAIL + PUSHROD LINKAGE
  // ==========================================================================
  const servoGroup = new THREE.Group();
  servoGroup.name = 'ServoMg996rGroup';
  root.add(servoGroup);

  const mgLabelMat = new THREE.MeshStandardMaterial({
    map: mg996rLabelTex,
    roughness: 0.42,
    metalness: 0.12
  });
  const servoCase = new THREE.Mesh(
    new THREE.BoxGeometry(0.044, 0.086, 0.042),
    [mgLabelMat, mgLabelMat, darkPlasticMat, darkPlasticMat, darkPlasticMat, mgLabelMat]
  );
  servoCase.position.set(RIG_DIMS.servoBodyPos.x, RIG_DIMS.servoBodyPos.y, RIG_DIMS.servoBodyPos.z);
  servoCase.castShadow = true;
  servoGroup.add(servoCase);

  const mgBand = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.022, 0.044), brushedSteelMat);
  mgBand.position.set(RIG_DIMS.servoBodyPos.x, RIG_DIMS.servoBodyPos.y - 0.008, RIG_DIMS.servoBodyPos.z);
  servoGroup.add(mgBand);

  const servoFlange = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.009, 0.044), darkPlasticMat);
  servoFlange.position.set(RIG_DIMS.servoBodyPos.x, RIG_DIMS.servoBodyPos.y + 0.022, RIG_DIMS.servoBodyPos.z);
  servoGroup.add(servoFlange);

  for (const dx of [-0.025, 0.025]) {
    for (const dz of [-0.014, 0.014]) {
      pushInst(boltMats, RIG_DIMS.servoBodyPos.x + dx, RIG_DIMS.servoBodyPos.y + 0.028, RIG_DIMS.servoBodyPos.z + dz, 0, 0, 0, 0.85, 1.0, 0.85);
    }
  }

  const servoPlugBlock = new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.012, 0.007), dupontHousingMat);
  servoPlugBlock.position.set(RIG_DIMS.servoBodyPos.x, RIG_DIMS.servoBodyPos.y - 0.050, RIG_DIMS.servoBodyPos.z - 0.004);
  servoGroup.add(servoPlugBlock);

  for (const [wireHex, px] of [[0xf97316, SERVO_PLUG_PINS.PWM[0]], [0xe11d48, SERVO_PLUG_PINS.VCC[0]], [0x6b3e1b, SERVO_PLUG_PINS.GND[0]]]) {
    const stub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0018, 0.0018, 0.012, 8),
      new THREE.MeshStandardMaterial({ color: wireHex, roughness: 0.45 })
    );
    stub.position.set(px, RIG_DIMS.servoBodyPos.y - 0.042, RIG_DIMS.servoBodyPos.z - 0.004);
    servoGroup.add(stub);
  }

  // Servo spline shaft protrudes along +X so horn rotates in Y-Z plane (pitching panel +Z Watt Meter <-> -Z opposite)
  const splineHub = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.016, 16), brassMat);
  splineHub.rotation.z = Math.PI / 2;
  splineHub.position.set(RIG_DIMS.hornOrigin.x - 0.004, RIG_DIMS.hornOrigin.y, RIG_DIMS.hornOrigin.z);
  servoGroup.add(splineHub);

  const hornPivot = new THREE.Group();
  hornPivot.position.set(RIG_DIMS.hornOrigin.x, RIG_DIMS.hornOrigin.y, RIG_DIMS.hornOrigin.z);
  servoGroup.add(hornPivot);

  const hornArm = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.013, RIG_DIMS.hornLength + 0.014), matteRubberMat);
  hornArm.position.set(0.002, 0, -RIG_DIMS.hornLength * 0.5);
  hornPivot.add(hornArm);

  const hornPin = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.012, 12), brushedSteelMat);
  hornPin.rotation.z = Math.PI / 2;
  hornPin.position.set(0.002, 0, -RIG_DIMS.hornLength);
  hornPivot.add(hornPin);

  const pushrodMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 10), brushedSteelMat);
  pushrodMesh.castShadow = true;
  servoGroup.add(pushrodMesh);

  hotspotAnchors.servo = new THREE.Object3D();
  hotspotAnchors.servo.position.set(RIG_DIMS.servoBodyPos.x + 0.088, RIG_DIMS.servoBodyPos.y + 0.01, RIG_DIMS.servoBodyPos.z - 0.02);
  servoGroup.add(hotspotAnchors.servo);
  hotspotProxies.push(
    addHotspotProxy(servoGroup, 'servo', [0.14, 0.24, 0.11], [RIG_DIMS.servoBodyPos.x + 0.02, RIG_DIMS.servoBodyPos.y + 0.06, RIG_DIMS.servoBodyPos.z])
  );

  // ==========================================================================
  // 6. HORIZONTAL WHITE ELECTRONICS DECK (BELOW CHARGE CONTROLLER!)
  //    LDR Baffle | Red XL4015 CC/CV | Breadboard Common GND | GOOUUU ESP32 | Tiny RTC
  // ==========================================================================
  const deckGroup = new THREE.Group();
  deckGroup.name = 'ElectronicsDeckGroup';
  root.add(deckGroup);

  const deckCenterX = -0.068;
  const deckCenterZ = RIG_DIMS.deckZ + 0.008;
  const deckPlate = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.012, 0.168), whiteDeckMat);
  deckPlate.position.set(deckCenterX, RIG_DIMS.deckY, deckCenterZ);
  deckPlate.castShadow = true;
  deckPlate.receiveShadow = true;
  const deckTrim = new THREE.Mesh(new THREE.BoxGeometry(0.924, 0.004, 0.172), darkPlasticMat);
  deckTrim.position.set(deckCenterX, RIG_DIMS.deckY - 0.006, deckCenterZ);
  deckGroup.add(deckPlate, deckTrim);

  const deckCollar = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.036, 0.068), blackSteelMat);
  deckCollar.position.set(0, RIG_DIMS.deckY - 0.016, 0);
  const deckStrut = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.018, 0.155), blackSteelMat);
  deckStrut.position.set(0, RIG_DIMS.deckY - 0.015, 0.068);
  const armSpine = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.012, 0.022), blackSteelMat);
  armSpine.position.set(deckCenterX, RIG_DIMS.deckY - 0.012, deckCenterZ);
  deckGroup.add(deckCollar, deckStrut, armSpine);

  // --- 6A. AUTHENTIC RED XL4015 CC/CV 5A BUCK CONVERTER (Matches User's Uploaded Photo!) ---
  const xlGroup = new THREE.Group();
  xlGroup.name = 'Xl4015RedBuckGroup';
  xlGroup.position.set(BOARD_ORIGINS.xl.x, BOARD_ORIGINS.xl.y, BOARD_ORIGINS.xl.z);
  deckGroup.add(xlGroup);

  const xlRedPcbMat = new THREE.MeshStandardMaterial({
    color: 0xa1151d,
    roughness: 0.36,
    metalness: 0.16,
    bumpMap: pcbBump,
    bumpScale: 0.0007
  });
  const xlTopFaceMat = new THREE.MeshStandardMaterial({
    map: xl4015Tex,
    roughness: 0.34,
    metalness: 0.12,
    bumpMap: pcbBump,
    bumpScale: 0.0005
  });
  const xlPcb = new THREE.Mesh(
    new THREE.BoxGeometry(0.098, 0.004, 0.052),
    [xlRedPcbMat, xlRedPcbMat, xlTopFaceMat, xlRedPcbMat, xlRedPcbMat, xlRedPcbMat]
  );
  xlPcb.castShadow = true;
  xlGroup.add(xlPcb);

  // 2x Royal-Blue 2-Pin Screw Terminal Blocks (left IN+/IN-, right OUT+/OUT-)
  const xlTermIn = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.015, 0.026), blueTermMat);
  xlTermIn.position.set(-0.044, 0.0095, -0.003);
  xlTermIn.castShadow = true;
  const xlTermOut = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.015, 0.026), blueTermMat);
  xlTermOut.position.set(0.044, 0.0095, 0.003);
  xlTermOut.castShadow = true;
  xlGroup.add(xlTermIn, xlTermOut);

  // Dark wire-entry slots on side + shiny silver Phillips screw heads on top of the blue terminals
  for (const termName of ['IN+', 'IN-', 'OUT+', 'OUT-']) {
    const loc = getXl4015PinPos(termName).local;
    const isLeft = termName.startsWith('IN');
    const screwX = isLeft ? -0.044 : 0.044;
    const screwTop = new THREE.Mesh(new THREE.CylinderGeometry(0.0036, 0.0036, 0.0022, 14), brushedSteelMat);
    screwTop.position.set(screwX, 0.0172, loc[2]);
    const phillipsA = new THREE.Mesh(new THREE.BoxGeometry(0.0048, 0.0007, 0.0010), smdDarkMat);
    phillipsA.position.set(screwX, 0.0185, loc[2]);
    const phillipsB = new THREE.Mesh(new THREE.BoxGeometry(0.0010, 0.0007, 0.0048), smdDarkMat);
    phillipsB.position.set(screwX, 0.0185, loc[2]);
    xlGroup.add(screwTop, phillipsA, phillipsB);
  }

  // Yellow iron-powder toroidal core + 18 individual copper wire windings at top-center!
  const toroidGroup = new THREE.Group();
  toroidGroup.position.set(-0.004, 0.0145, -0.013);
  toroidGroup.rotation.x = Math.PI * 0.08;
  xlGroup.add(toroidGroup);

  const toroidCore = new THREE.Mesh(
    new THREE.TorusGeometry(0.0115, 0.0045, 12, 24),
    new THREE.MeshStandardMaterial({ color: 0xe9cb3b, roughness: 0.44, metalness: 0.08 })
  );
  toroidGroup.add(toroidCore);

  const coilTurns = 18;
  const coilGeo = new THREE.TorusGeometry(0.0052, 0.00095, 8, 16);
  const coilInst = new THREE.InstancedMesh(coilGeo, copperCoilMat, coilTurns);
  const _coilDummy = new THREE.Object3D();
  for (let i = 0; i < coilTurns; i++) {
    const a = (i / coilTurns) * Math.PI * 2;
    _coilDummy.position.set(Math.cos(a) * 0.0115, Math.sin(a) * 0.0115, 0);
    _coilDummy.rotation.set(Math.PI / 2, a, 0);
    _coilDummy.updateMatrix();
    coilInst.setMatrixAt(i, _coilDummy.matrix);
  }
  coilInst.instanceMatrix.needsUpdate = true;
  coilInst.computeBoundingSphere();
  toroidGroup.add(coilInst);

  // 2x Large Brushed-Silver SMD Electrolytic Capacitors (220 50V VT) placed diagonally like photo!
  const capTopMat = new THREE.MeshStandardMaterial({
    map: cap220TopTex,
    roughness: 0.26,
    metalness: 0.65
  });
  for (const [cx, cz, rotY] of [[-0.030, 0.013, 0], [0.028, -0.013, Math.PI]]) {
    const capBase = new THREE.Mesh(new THREE.BoxGeometry(0.0175, 0.0024, 0.0175), matteRubberMat);
    capBase.position.set(cx, 0.0032, cz);
    const capCan = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0080, 0.0080, 0.0145, 22),
      [brushedSteelMat, capTopMat, brushedSteelMat]
    );
    capCan.position.set(cx, 0.0112, cz);
    capCan.rotation.y = rotY;
    capCan.castShadow = true;
    xlGroup.add(capBase, capCan);
  }

  // 2x Blue Multi-Turn Precision Trimpots (W 103) side-by-side + slotted brass adjustment screws!
  const trimpotBlueMat = new THREE.MeshStandardMaterial({ color: 0x297bd6, roughness: 0.34, metalness: 0.08 });
  for (const tx of [-0.0135, -0.0025]) {
    const potBody = new THREE.Mesh(new THREE.BoxGeometry(0.0092, 0.0135, 0.0125), trimpotBlueMat);
    potBody.position.set(tx, 0.0088, 0.0125);
    potBody.castShadow = true;
    xlGroup.add(potBody);
    pushInst(brassScrewMats, BOARD_ORIGINS.xl.x + tx, BOARD_ORIGINS.xl.y + 0.0165, BOARD_ORIGINS.xl.z + 0.0095, 0, 0, 0, 1.05, 0.9, 1.05);
  }

  // Black TO-263-5 XL4015E1 Switching IC + silver thermal tab + 5 gull-wing legs!
  const xlIcBody = new THREE.Mesh(new THREE.BoxGeometry(0.0145, 0.0046, 0.0140), smdDarkMat);
  xlIcBody.position.set(0.0165, 0.0044, 0.0105);
  const xlIcTab = new THREE.Mesh(new THREE.BoxGeometry(0.0032, 0.0024, 0.0142), brushedSteelMat);
  xlIcTab.position.set(0.0082, 0.0034, 0.0105);
  xlGroup.add(xlIcBody, xlIcTab);
  for (let li = -2; li <= 2; li++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.0048, 0.0012, 0.0012), brushedSteelMat);
    leg.position.set(0.0258, 0.0028, 0.0105 + li * 0.0025);
    xlGroup.add(leg);
  }

  // Schottky diode SS54 behind IC + SOIC-8 LM358 on upper-left + live CC/CV status LED
  const xlDiode = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.0040, 0.0075), smdDarkMat);
  xlDiode.position.set(0.013, 0.0040, -0.0065);
  const xlLm358 = new THREE.Mesh(new THREE.BoxGeometry(0.0075, 0.0026, 0.0062), smdDarkMat);
  xlLm358.position.set(-0.024, 0.0033, -0.0095);
  const xlLedMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.1,
    roughness: 0.2
  });
  const xlLed = new THREE.Mesh(new THREE.SphereGeometry(0.0024, 10, 10), xlLedMat);
  xlLed.position.set(0.025, 0.0036, 0.020);
  xlGroup.add(xlDiode, xlLm358, xlLed);

  hotspotAnchors.xl4015 = new THREE.Object3D();
  hotspotAnchors.xl4015.position.set(-0.005, 0.056, -0.032);
  xlGroup.add(hotspotAnchors.xl4015);
  hotspotProxies.push(addHotspotProxy(xlGroup, 'xl4015', [0.11, 0.045, 0.068], [0, 0.014, 0]));

  // --- 6B. WHITE SOLDERLESS BREADBOARD (COMMON GROUND BUS HUB!) ---
  const breadGroup = new THREE.Group();
  breadGroup.name = 'BreadboardCommonGndGroup';
  breadGroup.position.set(BOARD_ORIGINS.bread.x, BOARD_ORIGINS.bread.y, BOARD_ORIGINS.bread.z);
  deckGroup.add(breadGroup);

  const breadSideMat = new THREE.MeshStandardMaterial({
    color: 0xedf0f5,
    roughness: 0.42,
    metalness: 0.03
  });
  const breadTopMat = new THREE.MeshStandardMaterial({
    map: breadboardTex,
    roughness: 0.44,
    metalness: 0.02
  });
  const breadBody = new THREE.Mesh(
    new THREE.BoxGeometry(BREADBOARD_GEO.width, BREADBOARD_GEO.thick, BREADBOARD_GEO.depth),
    [breadSideMat, breadSideMat, breadTopMat, breadSideMat, breadSideMat, breadSideMat]
  );
  breadBody.position.y = BREADBOARD_GEO.thick * 0.5 - 0.002;
  breadBody.castShadow = true;
  breadBody.receiveShadow = true;
  breadGroup.add(breadBody);

  // Subtle side dovetail interlock tabs characteristic of real solderless breadboards
  for (const tx of [-0.034, 0.034]) {
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.007, 0.003), breadSideMat);
    tab.position.set(tx, 0.002, BREADBOARD_GEO.depth * 0.5 + 0.0012);
    breadGroup.add(tab);
  }

  // 6 Black 1-Pin DuPont Jumper Plugs inserted into the front Blue (−) Common Ground Bus Rail!
  for (const plug of ACTIVE_DUPONT_PLUGS.breadboard) {
    const pw = getBreadboardGndPinPos(plug.slot).world;
    pushInst(goldPinMats, pw[0], BOARD_ORIGINS.bread.y + 0.0082, pw[2], 0, 0, 0, 0.8, 0.7, 0.8);
    pushDupontPlug(pw);
  }

  hotspotAnchors.breadboard = new THREE.Object3D();
  hotspotAnchors.breadboard.position.set(-0.012, 0.014, 0.056);
  breadGroup.add(hotspotAnchors.breadboard);
  hotspotProxies.push(addHotspotProxy(breadGroup, 'breadboard', [0.125, 0.045, 0.085], [0, 0.012, 0]));

  // --- 6C. GOOUUU ESP32-S V4 (PURPLE) + 114 GOLD PINS + S/V/G SHROUDS + NODEMCU-32S ---
  const espGroup = new THREE.Group();
  espGroup.name = 'Esp32GoouuuGroup';
  espGroup.position.set(BOARD_ORIGINS.esp.x, BOARD_ORIGINS.esp.y, BOARD_ORIGINS.esp.z);
  deckGroup.add(espGroup);

  const purplePcbMat = new THREE.MeshStandardMaterial({
    color: 0x5c2e86,
    roughness: 0.36,
    metalness: 0.14,
    bumpMap: pcbBump,
    bumpScale: 0.0006
  });
  const goouuuTopMat = new THREE.MeshStandardMaterial({
    map: goouuuTex,
    roughness: 0.34,
    metalness: 0.12,
    bumpMap: pcbBump,
    bumpScale: 0.0005
  });
  const espPcb = new THREE.Mesh(
    new THREE.BoxGeometry(GOOUUU_GEO.width, GOOUUU_GEO.thick, GOOUUU_GEO.depth),
    [purplePcbMat, purplePcbMat, goouuuTopMat, purplePcbMat, purplePcbMat, purplePcbMat]
  );
  espPcb.castShadow = true;
  espGroup.add(espPcb);

  // Silver mounting standoffs matching the 4 plated holes on Photos 2 & 3
  for (const [bx, bz] of [[-0.0655, -0.0415], [-0.0655, 0.0415], [0.0485, -0.0415], [0.0485, 0.0415]]) {
    pushInst(boltMats, BOARD_ORIGINS.esp.x + bx, BOARD_ORIGINS.esp.y + 0.0040, BOARD_ORIGINS.esp.z + bz, 0, 0, 0, 0.85, 0.7, 0.85);
  }

  // Exact GOOUUU V4 3-row color-coded header strips moving OUTWARD from center NodeMCU:
  // Inner = Black (G), Middle = Red (V), Outer = Bright Yellow (S)
  const pinOffX = GOOUUU_GEO.pinOffsetX;
  const shroudS = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.38 });
  const shroudV = new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.40 });
  const shroudG = new THREE.MeshStandardMaterial({ color: 0x181b22, roughness: 0.46 });
  const shroudLen = 19 * GOOUUU_GEO.pinPitch + 0.0014;
  for (const zSign of [1, -1]) {
    for (const [rowKey, mat] of [['G', shroudG], ['V', shroudV], ['S', shroudS]]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(shroudLen, 0.0028, 0.0038), mat);
      strip.position.set(pinOffX, 0.0044, zSign * GOOUUU_GEO.rowZ[rowKey]);
      espGroup.add(strip);
    }
  }

  // 19 x 3 x 2 = 114 upright gold header pins
  for (const side of ['front', 'rear']) {
    for (let i = 0; i < 19; i++) {
      for (const rowKey of ['G', 'V', 'S']) {
        const pw = getGoouuuPinPos(side, i, rowKey).world;
        pushInst(goldPinMats, pw[0], BOARD_ORIGINS.esp.y + 0.0085, pw[2], 0, 0, 0, 1, 1, 1);
      }
    }
  }

  // Authentic Photo B YELLOW FEMALE SOCKETS:
  // Single strip on rear (-Z: z = -0.0155), DOUBLE strips on front (+Z: z = +0.0142 & +0.0182 for 24.00mm/25.500mm)!
  const yellowSocketMat = new THREE.MeshStandardMaterial({ color: 0xe9b814, roughness: 0.34, metalness: 0.06 });
  const socketHoleMat = new THREE.MeshStandardMaterial({ color: 0x181612, roughness: 0.85 });
  const socketLen = 19 * GOOUUU_GEO.pinPitch + 0.0025;
  for (const sz of [-0.0155, 0.0142, 0.0182]) {
    const sock = new THREE.Mesh(new THREE.BoxGeometry(socketLen, 0.0094, 0.0033), yellowSocketMat);
    sock.position.set(pinOffX, 0.0076, sz);
    sock.castShadow = true;
    espGroup.add(sock);
  }
  // Tiny dark female pin-receptacle holes along the exposed outer front yellow socket row (25.500mm slot)
  for (let i = 0; i < 19; i++) {
    const hx = pinOffX + (i - 9) * GOOUUU_GEO.pinPitch;
    const hole = new THREE.Mesh(new THREE.BoxGeometry(0.0017, 0.0005, 0.0017), socketHoleMat);
    hole.position.set(hx, 0.0124, 0.0182);
    espGroup.add(hole);
  }

  // Helper for micro-3D SMD ceramic capacitors & labeled SMD resistors/diodes with shiny silver solder ends
  const espTanCapMat = new THREE.MeshStandardMaterial({ color: 0xc2935c, roughness: 0.36, metalness: 0.14 });
  const addSmdPart = (parent, x, y, z, lenX, hY, lenZ, bodyTopMat, bodySideMat, endAlongX = true) => {
    const mats = bodyTopMat
      ? [bodySideMat, bodySideMat, bodyTopMat, bodySideMat, bodySideMat, bodySideMat]
      : bodySideMat;
    const body = new THREE.Mesh(new THREE.BoxGeometry(lenX, hY, lenZ), mats);
    body.position.set(x, y, z);
    parent.add(body);
    if (endAlongX) {
      const capW = Math.max(0.0006, lenX * 0.18);
      for (const sgn of [-1, 1]) {
        const end = new THREE.Mesh(new THREE.BoxGeometry(capW, hY * 1.04, lenZ * 1.02), brushedSteelMat);
        end.position.set(x + sgn * (lenX * 0.5 + capW * 0.28), y, z);
        parent.add(end);
      }
    } else {
      const capD = Math.max(0.0006, lenZ * 0.18);
      for (const sgn of [-1, 1]) {
        const end = new THREE.Mesh(new THREE.BoxGeometry(lenX * 1.02, hY * 1.04, capD), brushedSteelMat);
        end.position.set(x, y, z + sgn * (lenZ * 0.5 + capD * 0.28));
        parent.add(end);
      }
    }
  };

  // Matte-black NodeMCU-32S 38-pin daughterboard seated on top of the inner 24.00mm yellow sockets!
  const mcuCenterZ = -0.0006;
  const mcuTopY = 0.0156; // 0.0140 + 0.0032 / 2
  const mcuTopMat = new THREE.MeshStandardMaterial({
    map: nodeMcuTex,
    roughness: 0.36,
    metalness: 0.14,
    bumpMap: pcbBump,
    bumpScale: 0.0005
  });
  const mcuBoard = new THREE.Mesh(
    new THREE.BoxGeometry(0.100, 0.0032, 0.035),
    [darkPlasticMat, darkPlasticMat, mcuTopMat, darkPlasticMat, darkPlasticMat, darkPlasticMat]
  );
  mcuBoard.position.set(pinOffX, 0.0140, mcuCenterZ);
  mcuBoard.castShadow = true;
  espGroup.add(mcuBoard);

  // Silver soldered pin tips peeking cleanly along both 19-pin rows of NodeMCU-32S (Photo A)
  const solderPinMat = new THREE.MeshStandardMaterial({ color: 0xdce4ee, roughness: 0.22, metalness: 0.90 });
  for (let i = 0; i < 19; i++) {
    const px = pinOffX + (i - 9) * GOOUUU_GEO.pinPitch;
    for (const pz of [mcuCenterZ - 0.0156, mcuCenterZ + 0.0156]) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.00065, 0.00095, 0.0014, 8), solderPinMat);
      tip.position.set(px, mcuTopY + 0.0006, pz);
      espGroup.add(tip);
    }
  }

  // 1) Brushed nickel-silver ESP-WROOM-32 RF shield on left (-X) side of NodeMCU-32S (Photo A)
  const rfTopMat = new THREE.MeshStandardMaterial({
    map: rfShieldTex,
    roughness: 0.30,
    metalness: 0.52,
    bumpMap: brushedBump,
    bumpScale: 0.0006
  });
  const rfCan = new THREE.Mesh(
    new THREE.BoxGeometry(0.030, 0.0042, 0.0226),
    [brushedSteelMat, brushedSteelMat, rfTopMat, brushedSteelMat, brushedSteelMat, brushedSteelMat]
  );
  rfCan.position.set(pinOffX - 0.0185, mcuTopY + 0.0021, mcuCenterZ);
  rfCan.castShadow = true;
  espGroup.add(rfCan);

  // 2) Row of 6x micro SMD pull-up/shunt resistors ('103') & tan ceramic caps immediately behind (+X of) RF shield!
  const res103TopMat = new THREE.MeshStandardMaterial({ map: res103Tex, roughness: 0.40, metalness: 0.14 });
  for (let r = 0; r < 6; r++) {
    const rz = mcuCenterZ - 0.0088 + r * 0.0035;
    const isCap = r === 2 || r === 5;
    addSmdPart(
      espGroup,
      pinOffX + 0.0038,
      mcuTopY + 0.0007,
      rz,
      0.0036,
      0.0014,
      0.0018,
      isCap ? null : res103TopMat,
      isCap ? espTanCapMat : smdDarkMat,
      true
    );
  }

  // 3) Black rectangular 'C226' SMD cap + tan bypass cap + Iconic BRIGHT YELLOW '107J' Tantalum Capacitor (Photo A!)
  const c226TopMat = new THREE.MeshStandardMaterial({ map: c226Tex, roughness: 0.36, metalness: 0.15 });
  addSmdPart(espGroup, pinOffX + 0.0112, mcuTopY + 0.0009, mcuCenterZ + 0.0044, 0.0044, 0.0018, 0.0026, c226TopMat, smdDarkMat, true);
  addSmdPart(espGroup, pinOffX + 0.0102, mcuTopY + 0.0008, mcuCenterZ + 0.0088, 0.0026, 0.0016, 0.0018, null, espTanCapMat, true);

  const tant107BodyMat = new THREE.MeshStandardMaterial({ color: 0xe6a124, roughness: 0.34, metalness: 0.08 });
  const tant107TopMat = new THREE.MeshStandardMaterial({ map: tant107Tex, roughness: 0.34, metalness: 0.08 });
  addSmdPart(espGroup, pinOffX + 0.0170, mcuTopY + 0.0012, mcuCenterZ + 0.0060, 0.0048, 0.0024, 0.0034, tant107TopMat, tant107BodyMat, true);

  // 4) Large Black SOT-223 'AMS1117 3.3 H550PY' Voltage Regulator IC (wide silver heatsink tab + 3 silver legs!)
  const ams33TopMat = new THREE.MeshStandardMaterial({ map: ams33Tex, roughness: 0.36, metalness: 0.18 });
  const mcuReg = new THREE.Mesh(
    new THREE.BoxGeometry(0.0068, 0.0024, 0.0074),
    [smdDarkMat, smdDarkMat, ams33TopMat, smdDarkMat, smdDarkMat, smdDarkMat]
  );
  mcuReg.position.set(pinOffX + 0.0256, mcuTopY + 0.0012, mcuCenterZ + 0.0068);
  const mcuRegTab = new THREE.Mesh(new THREE.BoxGeometry(0.0020, 0.0010, 0.0046), brushedSteelMat);
  mcuRegTab.position.set(pinOffX + 0.0214, mcuTopY + 0.0005, mcuCenterZ + 0.0068);
  espGroup.add(mcuReg, mcuRegTab);
  for (const lz of [-0.0022, 0, 0.0022]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0008, 0.0010), brushedSteelMat);
    leg.position.set(pinOffX + 0.0298, mcuTopY + 0.0004, mcuCenterZ + 0.0068 + lz);
    espGroup.add(leg);
  }

  // 5) Square Black QFN-28 'SILABS CP2102 DCL00X 1708+' USB-UART IC with tiny silver pin strips on all 4 sides!
  const cp2102TopMat = new THREE.MeshStandardMaterial({ map: cp2102Tex, roughness: 0.34, metalness: 0.20 });
  const cp2102 = new THREE.Mesh(
    new THREE.BoxGeometry(0.0074, 0.0018, 0.0074),
    [smdDarkMat, smdDarkMat, cp2102TopMat, smdDarkMat, smdDarkMat, smdDarkMat]
  );
  cp2102.position.set(pinOffX + 0.0268, mcuTopY + 0.0009, mcuCenterZ - 0.0022);
  espGroup.add(cp2102);
  for (let p = 0; p < 7; p++) {
    const off = (p - 3) * 0.00095;
    for (const sgn of [-1, 1]) {
      const pX = new THREE.Mesh(new THREE.BoxGeometry(0.0009, 0.0005, 0.00045), brushedSteelMat);
      pX.position.set(pinOffX + 0.0268 + sgn * 0.0040, mcuTopY + 0.00025, mcuCenterZ - 0.0022 + off);
      const pZ = new THREE.Mesh(new THREE.BoxGeometry(0.00045, 0.0005, 0.0009), brushedSteelMat);
      pZ.position.set(pinOffX + 0.0268 + off, mcuTopY + 0.00025, mcuCenterZ - 0.0022 + sgn * 0.0040);
      espGroup.add(pX, pZ);
    }
  }

  // 6) 2x SOT-23 3-pin auto-reset transistors + Rear (-Z) row of 5x tan ceramic SMD caps & '103' shunt resistors (Photo A!)
  for (const tx of [0.0128, 0.0182]) {
    const tr = new THREE.Mesh(new THREE.BoxGeometry(0.0032, 0.0014, 0.0020), smdDarkMat);
    tr.position.set(pinOffX + tx, mcuTopY + 0.0007, mcuCenterZ - 0.0025);
    espGroup.add(tr);
    for (const [lx, lz] of [[-0.0010, -0.0012], [0.0010, -0.0012], [0, 0.0012]]) {
      const tleg = new THREE.Mesh(new THREE.BoxGeometry(0.0006, 0.0005, 0.0008), brushedSteelMat);
      tleg.position.set(pinOffX + tx + lx, mcuTopY + 0.00025, mcuCenterZ - 0.0025 + lz);
      espGroup.add(tleg);
    }
  }
  for (let k = 0; k < 5; k++) {
    const xm = pinOffX + 0.0105 + k * 0.0052;
    const isCap = k >= 2;
    addSmdPart(
      espGroup,
      xm,
      mcuTopY + 0.0007,
      mcuCenterZ - 0.0085,
      0.0024,
      0.0014,
      0.0032,
      isCap ? null : res103TopMat,
      isCap ? espTanCapMat : smdDarkMat,
      false
    );
  }

  // 7) SMD Schottky diode behind Micro-USB + Metallic-Frame RST & BOOT tactile pushbuttons + Silver Micro-USB w/ 5 legs!
  addSmdPart(espGroup, pinOffX + 0.0362, mcuTopY + 0.0008, mcuCenterZ + 0.0006, 0.0038, 0.0016, 0.0022, null, smdDarkMat, true);

  for (const bz of [-0.0084, 0.0084]) {
    const swBase = new THREE.Mesh(new THREE.BoxGeometry(0.0052, 0.0020, 0.0044), brushedSteelMat);
    swBase.position.set(pinOffX + 0.0412, mcuTopY + 0.0010, mcuCenterZ + bz);
    const swCap = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0014, 0.0016, 12), matteRubberMat);
    swCap.position.set(pinOffX + 0.0412, mcuTopY + 0.0024, mcuCenterZ + bz);
    espGroup.add(swBase, swCap);
  }
  const microUsbTopMat = new THREE.MeshStandardMaterial({
    map: microUsbTopTex,
    roughness: 0.24,
    metalness: 0.82
  });
  const portCavityMat = new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.92, metalness: 0.05 });
  const portTongueMat = new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.55, metalness: 0.15 });

  const mcuMicroUsb = new THREE.Mesh(
    new THREE.BoxGeometry(0.0078, 0.0038, 0.0098),
    [brushedSteelMat, brushedSteelMat, microUsbTopMat, brushedSteelMat, brushedSteelMat, brushedSteelMat]
  );
  mcuMicroUsb.position.set(pinOffX + 0.0472, mcuTopY + 0.0019, mcuCenterZ);
  espGroup.add(mcuMicroUsb);
  for (let p = 0; p < 5; p++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.0018, 0.0005, 0.00055), brushedSteelMat);
    leg.position.set(pinOffX + 0.0426, mcuTopY + 0.0003, mcuCenterZ - 0.0026 + p * 0.0013);
    espGroup.add(leg);
  }
  // Open dark hollow mouth + contact tongue on the unplugged ESP32S NodeMCU Micro-USB receptacle
  const mcuUsbHole = new THREE.Mesh(new THREE.BoxGeometry(0.0010, 0.0020, 0.0076), portCavityMat);
  mcuUsbHole.position.set(pinOffX + 0.0508, mcuTopY + 0.0019, mcuCenterZ);
  const mcuUsbTongue = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0005, 0.0056), portTongueMat);
  mcuUsbTongue.position.set(pinOffX + 0.0506, mcuTopY + 0.0019, mcuCenterZ);
  espGroup.add(mcuUsbHole, mcuUsbTongue);

  // --- RIGHT-HAND POWER & EXPANSION DECK (+X end of Purple GOOUUU V4 — exact Photo B match!) ---
  const goTopY = GOOUUU_GEO.thick * 0.5; // 0.0028

  // 1) 2x Brushed-Silver SMD Electrolytic Capacitors ('CS 47 35V') with black chamfered SMD base seats
  const cap47TopMat = new THREE.MeshStandardMaterial({ map: cap47TopTex, roughness: 0.26, metalness: 0.64 });
  for (const cz of [-0.0172, 0.0008]) {
    const capSeat = new THREE.Mesh(new THREE.BoxGeometry(0.0132, 0.0016, 0.0132), dupontHousingMat);
    capSeat.position.set(0.0440, goTopY + 0.0008, cz);
    const capCan = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0063, 0.0063, 0.0086, 22),
      [brushedSteelMat, cap47TopMat, brushedSteelMat]
    );
    capCan.position.set(0.0440, goTopY + 0.0056, cz);
    capCan.castShadow = true;
    espGroup.add(capSeat, capCan);
  }

  // 2) Black SOT-223 '1117 5.0 A251' 5V Voltage Regulator IC (wide silver tab on -X + 3 silver legs on +X!)
  const reg5vTopMat = new THREE.MeshStandardMaterial({ map: reg5vTex, roughness: 0.36, metalness: 0.18 });
  const vRegBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.0074, 0.0032, 0.0108),
    [smdDarkMat, smdDarkMat, reg5vTopMat, smdDarkMat, smdDarkMat, smdDarkMat]
  );
  vRegBody.position.set(0.0585, goTopY + 0.0016, 0.0000);
  const vRegTab = new THREE.Mesh(new THREE.BoxGeometry(0.0024, 0.0012, 0.0062), brushedSteelMat);
  vRegTab.position.set(0.0538, goTopY + 0.0006, 0.0000);
  espGroup.add(vRegBody, vRegTab);
  for (const lz of [-0.0036, 0.0000, 0.0036]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.0028, 0.0010, 0.0014), brushedSteelMat);
    leg.position.set(0.0634, goTopY + 0.0005, lz);
    espGroup.add(leg);
  }

  // 3) 2x Tan Ceramic SMD Capacitors + 2x Black 'SS24' SMD Schottky Diodes with silver cathode bands & tabs (Photo B!)
  addSmdPart(espGroup, 0.0585, goTopY + 0.0009, -0.0102, 0.0024, 0.0018, 0.0038, null, espTanCapMat, false);
  addSmdPart(espGroup, 0.0504, goTopY + 0.0009,  0.0068, 0.0036, 0.0018, 0.0022, null, espTanCapMat, true);

  const ss24TopMatH = new THREE.MeshStandardMaterial({ map: ss24Tex, roughness: 0.34, metalness: 0.16 });
  addSmdPart(espGroup, 0.0538, goTopY + 0.0013, 0.0125, 0.0068, 0.0026, 0.0042, ss24TopMatH, smdDarkMat, true);
  addSmdPart(espGroup, 0.0663, goTopY + 0.0013, 0.0018, 0.0042, 0.0026, 0.0068, ss24TopMatH, smdDarkMat, false);

  // 4) Vertical 3-Pin JUMP (3.3V / V / 5V) Voltage Selector Header + Lime-Yellow Jumper Cap bridging 3.3V & V (Photo B!)
  const jumpBase = new THREE.Mesh(new THREE.BoxGeometry(0.0044, 0.0030, 0.0138), dupontHousingMat);
  jumpBase.position.set(0.0555, goTopY + 0.0015, 0.0252);
  espGroup.add(jumpBase);
  for (const jz of [0.0205, 0.0252, 0.0299]) {
    pushInst(goldPinMats, BOARD_ORIGINS.esp.x + 0.0555, BOARD_ORIGINS.esp.y + 0.0082, BOARD_ORIGINS.esp.z + jz, 0, 0, 0, 0.9, 1.0, 0.9);
  }
  const jumpCapYellow = new THREE.Mesh(
    new THREE.BoxGeometry(0.0046, 0.0092, 0.0090),
    new THREE.MeshStandardMaterial({ color: 0xd4df2a, roughness: 0.30, metalness: 0.05 })
  );
  jumpCapYellow.position.set(0.0555, goTopY + 0.0064, 0.0228); // Bridging top 2 pins (3.3V + V), leaving 5V pin open!
  espGroup.add(jumpCapYellow);

  // 5) Auxiliary Black Pin Headers: Rear-Right 1x4 (TX/RX/VCC/GND & D22/D21/VCC/GND) & Front-Right 2x4 (5V|3V / GND)
  const rearAuxBlock = new THREE.Mesh(new THREE.BoxGeometry(0.0168, 0.0030, 0.0076), dupontHousingMat);
  rearAuxBlock.position.set(0.0408, goTopY + 0.0015, -0.0355);
  espGroup.add(rearAuxBlock);
  for (let k = 0; k < 4; k++) {
    const px = BOARD_ORIGINS.esp.x + 0.0345 + k * 0.0042;
    for (const rz of [-0.0372, -0.0338]) {
      pushInst(goldPinMats, px, BOARD_ORIGINS.esp.y + 0.0084, BOARD_ORIGINS.esp.z + rz, 0, 0, 0, 0.82, 0.95, 0.82);
    }
  }

  const frontAuxBlock = new THREE.Mesh(new THREE.BoxGeometry(0.0156, 0.0030, 0.0102), dupontHousingMat);
  frontAuxBlock.position.set(0.0395, goTopY + 0.0015, 0.0345);
  espGroup.add(frontAuxBlock);
  for (let ax = 0; ax < 4; ax++) {
    for (let az = 0; az < 2; az++) {
      const px = BOARD_ORIGINS.esp.x + 0.0338 + ax * 0.0038;
      const pz = BOARD_ORIGINS.esp.z + 0.0322 + az * 0.0046;
      pushInst(goldPinMats, px, BOARD_ORIGINS.esp.y + 0.0084, pz, 0, 0, 0, 0.82, 0.95, 0.82);
    }
  }

  // 6) Right-Edge (+X) Triple Open Power Connectors (exact Photo B match: DC6.5-16V Barrel, Micro-USB, USB5V Type-C!)
  // 6a. Black DC6.5-16V Barrel Jack (5.5x2.1mm): rear rectangular housing + protruding round cylindrical barrel + silver center pin
  const dcRearBox = new THREE.Mesh(new THREE.BoxGeometry(0.0118, 0.0124, 0.0114), matteRubberMat);
  dcRearBox.position.set(0.0622, goTopY + 0.0062, -0.0342);
  dcRearBox.castShadow = true;
  const dcCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.0086, 20), matteRubberMat);
  dcCyl.rotation.z = Math.PI / 2;
  dcCyl.position.set(0.0706, goTopY + 0.0062, -0.0342);
  dcCyl.castShadow = true;
  const dcFlange = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0126, 0.0122), dupontHousingMat);
  dcFlange.position.set(0.0736, goTopY + 0.0063, -0.0342);
  const dcRimRing = new THREE.Mesh(new THREE.TorusGeometry(0.0044, 0.00055, 10, 20), brushedSteelMat);
  dcRimRing.rotation.y = Math.PI / 2;
  dcRimRing.position.set(0.0748, goTopY + 0.0062, -0.0342);
  const dcBore = new THREE.Mesh(new THREE.CylinderGeometry(0.0041, 0.0041, 0.0032, 18), portCavityMat);
  dcBore.rotation.z = Math.PI / 2;
  dcBore.position.set(0.0735, goTopY + 0.0062, -0.0342);
  const dcPin = new THREE.Mesh(new THREE.CylinderGeometry(0.00135, 0.00135, 0.0050, 12), brushedSteelMat);
  dcPin.rotation.z = Math.PI / 2;
  dcPin.position.set(0.0726, goTopY + 0.0062, -0.0342);
  // Subtle silver top spring-contact lug peeking out of the rear-left notch of the DC jack (visible in Photo B)
  const dcTopTab = new THREE.Mesh(new THREE.BoxGeometry(0.0034, 0.0010, 0.0040), brushedSteelMat);
  dcTopTab.position.set(0.0582, goTopY + 0.0125, -0.0342);
  espGroup.add(dcRearBox, dcCyl, dcFlange, dcRimRing, dcBore, dcPin, dcTopTab);

  // 6b. Middle-Right Brushed-Stainless Micro-USB Receptacle (open dark hollow mouth + top T-cutouts + 5 rear legs!)
  const boardMicroUsb = new THREE.Mesh(
    new THREE.BoxGeometry(0.0086, 0.0042, 0.0102),
    [brushedSteelMat, brushedSteelMat, microUsbTopMat, brushedSteelMat, brushedSteelMat, brushedSteelMat]
  );
  boardMicroUsb.position.set(0.0676, goTopY + 0.0021, -0.0110);
  boardMicroUsb.castShadow = true;
  const microLip = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0046, 0.0110), brushedSteelMat);
  microLip.position.set(0.0718, goTopY + 0.0022, -0.0110);
  const microCavity = new THREE.Mesh(new THREE.BoxGeometry(0.0014, 0.0028, 0.0084), portCavityMat);
  microCavity.position.set(0.0720, goTopY + 0.0022, -0.0110);
  const microTongue = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0007, 0.0060), portTongueMat);
  microTongue.position.set(0.0714, goTopY + 0.0020, -0.0110);
  const microGold = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.00025, 0.0046), goldPinMat);
  microGold.position.set(0.0715, goTopY + 0.00245, -0.0110);
  espGroup.add(boardMicroUsb, microLip, microCavity, microTongue, microGold);
  for (let p = 0; p < 5; p++) {
    const uleg = new THREE.Mesh(new THREE.BoxGeometry(0.0020, 0.0006, 0.0006), brushedSteelMat);
    uleg.position.set(0.0626, goTopY + 0.0003, -0.0138 + p * 0.0014);
    espGroup.add(uleg);
  }

  // 6c. Front-Right Wide Brushed-Stainless USB5V Type-C Receptacle (100% OPEN, rounded sides, top spring cutouts, hollow oval mouth + tongue + 12 SMD pins!)
  const usbCTopMat = new THREE.MeshStandardMaterial({
    map: usbCTopTex,
    roughness: 0.24,
    metalness: 0.84
  });
  const usbCBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.0114, 0.0048, 0.0112),
    [brushedSteelMat, brushedSteelMat, usbCTopMat, brushedSteelMat, brushedSteelMat, brushedSteelMat]
  );
  usbCBody.position.set(0.0672, goTopY + 0.0024, 0.0220);
  usbCBody.castShadow = true;
  // Rounded stainless left/right edges so silhouette reads unmistakably as rounded-oval USB Type-C
  for (const sgn of [-1, 1]) {
    const roundEdge = new THREE.Mesh(new THREE.CylinderGeometry(0.0024, 0.0024, 0.0114, 14), brushedSteelMat);
    roundEdge.rotation.z = Math.PI / 2;
    roundEdge.position.set(0.0672, goTopY + 0.0024, 0.0220 + sgn * 0.0052);
    espGroup.add(roundEdge);
  }
  // Open dark rounded-oval front mouth on +X face + thin black central contact tongue & gold pin strip!
  const usbCCavity = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.0032, 0.0102), portCavityMat);
  usbCCavity.position.set(0.0726, goTopY + 0.0024, 0.0220);
  for (const sgn of [-1, 1]) {
    const cavEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.0016, 12), portCavityMat);
    cavEnd.rotation.z = Math.PI / 2;
    cavEnd.position.set(0.0726, goTopY + 0.0024, 0.0220 + sgn * 0.0046);
    espGroup.add(cavEnd);
  }
  const usbCTongue = new THREE.Mesh(new THREE.BoxGeometry(0.0028, 0.00075, 0.0082), portTongueMat);
  usbCTongue.position.set(0.0718, goTopY + 0.0024, 0.0220);
  const usbCGold = new THREE.Mesh(new THREE.BoxGeometry(0.0020, 0.00025, 0.0068), goldPinMat);
  usbCGold.position.set(0.0719, goTopY + 0.00285, 0.0220);
  espGroup.add(usbCBody, usbCCavity, usbCTongue, usbCGold);
  // 12 crisp shiny silver rear SMD pins along -X edge (exact Photo B!)
  for (let p = 0; p < 12; p++) {
    const cleg = new THREE.Mesh(new THREE.BoxGeometry(0.0018, 0.00055, 0.00042), brushedSteelMat);
    cleg.position.set(0.0608, goTopY + 0.0003, 0.0170 + p * 0.00091);
    espGroup.add(cleg);
  }
  // Sleek rounded-pill USB Type-C connector plugged cleanly into GOOUUU USB5V port (leaves entire silver Type-C shell 100% visible!)
  const usbCPlugMat = new THREE.MeshStandardMaterial({ color: 0x1e232b, roughness: 0.28, metalness: 0.42 });
  const usbCNeck = new THREE.Mesh(new THREE.BoxGeometry(0.0040, 0.0036, 0.0094), brushedSteelMat);
  usbCNeck.position.set(0.0746, goTopY + 0.0024, 0.0220);
  const usbCCollar = new THREE.Mesh(new THREE.BoxGeometry(0.0024, 0.0056, 0.0108), brushedSteelMat);
  usbCCollar.position.set(0.0774, goTopY + 0.0026, 0.0220);
  const usbCPlugCore = new THREE.Mesh(new THREE.BoxGeometry(0.0115, 0.0058, 0.0074), usbCPlugMat);
  usbCPlugCore.position.set(0.0842, goTopY + 0.0026, 0.0220);
  for (const sgn of [-1, 1]) {
    const plugSide = new THREE.Mesh(new THREE.CylinderGeometry(0.0029, 0.0029, 0.0115, 14), usbCPlugMat);
    plugSide.rotation.z = Math.PI / 2;
    plugSide.position.set(0.0842, goTopY + 0.0026, 0.0220 + sgn * 0.0037);
    espGroup.add(plugSide);
  }
  const usbCBoot = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0032, 0.0055, 12), matteRubberMat);
  usbCBoot.rotation.z = Math.PI / 2;
  usbCBoot.position.set(0.0924, goTopY + 0.0026, 0.0220);
  espGroup.add(usbCNeck, usbCCollar, usbCPlugCore, usbCBoot);

  // 7) Bottom-right '102' SMD Current-Limiting / Shunt Resistor + Glowing 'RPW-LED' + Onboard ESP32 Red/Blue SMD LEDs!
  const res102TopMat = new THREE.MeshStandardMaterial({ map: res102Tex, roughness: 0.38, metalness: 0.14 });
  addSmdPart(espGroup, 0.0594, goTopY + 0.0008, 0.0399, 0.0036, 0.0015, 0.0020, res102TopMat, smdDarkMat, true);

  const espLedMat = new THREE.MeshStandardMaterial({
    color: 0x34c759,
    emissive: 0x34c759,
    emissiveIntensity: 1.5,
    roughness: 0.2
  });
  const pwrBoardLed = new THREE.Mesh(new THREE.BoxGeometry(0.0030, 0.0016, 0.0020), espLedMat);
  pwrBoardLed.position.set(0.0649, goTopY + 0.0008, 0.0399);
  const espLed = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0012, 0.0014), espLedMat);
  espLed.position.set(pinOffX + 0.0332, mcuTopY + 0.0007, mcuCenterZ + 0.0080);
  const espBlueLed = new THREE.Mesh(
    new THREE.BoxGeometry(0.0022, 0.0012, 0.0014),
    new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x2563eb, emissiveIntensity: 1.35, roughness: 0.2 })
  );
  espBlueLed.position.set(pinOffX + 0.0332, mcuTopY + 0.0007, mcuCenterZ - 0.0076);
  espGroup.add(pwrBoardLed, espLed, espBlueLed);

  for (const plug of ACTIVE_DUPONT_PLUGS.goouuu) {
    pushDupontPlug(getGoouuuPinPos(plug.side, plug.index, plug.row).world);
  }

  hotspotAnchors.esp32 = new THREE.Object3D();
  hotspotAnchors.esp32.position.set(0.015, 0.068, -0.030);
  espGroup.add(hotspotAnchors.esp32);
  hotspotProxies.push(addHotspotProxy(espGroup, 'esp32', [0.155, 0.065, 0.11], [0.004, 0.018, 0]));

  // --- 6D. PHOTOREALISTIC HW-111 TINY RTC DS1307 + AT24C32 + TOP CR2032 COIN CELL ---
  const rtcGroup = new THREE.Group();
  rtcGroup.name = 'TinyRtcGroup';
  rtcGroup.position.set(BOARD_ORIGINS.rtc.x, BOARD_ORIGINS.rtc.y, BOARD_ORIGINS.rtc.z);
  deckGroup.add(rtcGroup);

  const rtcBluePcbMat = new THREE.MeshStandardMaterial({
    color: 0x083e6d,
    roughness: 0.36,
    metalness: 0.14,
    bumpMap: pcbBump,
    bumpScale: 0.0006
  });
  const rtcTopMat = new THREE.MeshStandardMaterial({
    map: tinyRtcTex,
    roughness: 0.34,
    metalness: 0.12,
    bumpMap: pcbBump,
    bumpScale: 0.0005
  });
  // Widened 0.076m x 0.056m PCB shifted +0.010m so left P2 pins stay 1:1 with getTinyRtcPinPos(-0.023)
  // while leaving generous dedicated space for both ALL HW-111 ICs/resistors AND the top-mounted CR2032 coin cell!
  const rtcPcb = new THREE.Mesh(
    new THREE.BoxGeometry(0.076, 0.0044, 0.056),
    [rtcBluePcbMat, rtcBluePcbMat, rtcTopMat, rtcBluePcbMat, rtcBluePcbMat, rtcBluePcbMat]
  );
  rtcPcb.position.set(0.010, 0.0022, 0);
  rtcPcb.castShadow = true;
  rtcGroup.add(rtcPcb);
  const rtcTopY = 0.0044;

  // Left (-X) P2 Black Pin Header Shroud facing ESP32 (7 pins aligned 1:1 with getTinyRtcPinPos!)
  const rtcHdrBase = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.0028, 0.044), dupontHousingMat);
  rtcHdrBase.position.set(-0.023, rtcTopY + 0.0014, 0);
  rtcGroup.add(rtcHdrBase);

  for (let i = 0; i < 7; i++) {
    const pw = getTinyRtcPinPos(i).world;
    pushInst(goldPinMats, pw[0], BOARD_ORIGINS.rtc.y + 0.0086, pw[2], 0, 0, 0, 1, 1, 1);
  }
  for (const plug of ACTIVE_DUPONT_PLUGS.rtc) {
    pushDupontPlug(getTinyRtcPinPos(plug.index).world);
  }

  const rtcOx = -0.0020;

  // 1) X1 — Cylindrical Silver 32.768 kHz Quartz Watch Crystal + twin bent wire leads
  const x1Can = new THREE.Mesh(new THREE.CylinderGeometry(0.0023, 0.0023, 0.0142, 16), brushedSteelMat);
  x1Can.rotation.x = Math.PI / 2;
  x1Can.position.set(-0.0085 + rtcOx, rtcTopY + 0.0023, -0.0112);
  x1Can.castShadow = true;
  rtcGroup.add(x1Can);
  for (const lx of [-0.0095 + rtcOx, -0.0075 + rtcOx]) {
    const x1Lead = new THREE.Mesh(new THREE.CylinderGeometry(0.00036, 0.00036, 0.0045, 8), brushedSteelMat);
    x1Lead.rotation.x = Math.PI / 2;
    x1Lead.position.set(lx, rtcTopY + 0.0011, -0.0022);
    rtcGroup.add(x1Lead);
  }

  // 2) D1 — Red-Orange Glass MELF SMD Diode (1N4148) with black cathode band & silver end caps
  const d1GlassMat = new THREE.MeshStandardMaterial({ color: 0xd94826, roughness: 0.20, metalness: 0.12 });
  const d1Body = new THREE.Mesh(new THREE.CylinderGeometry(0.00155, 0.00155, 0.0052, 14), d1GlassMat);
  d1Body.rotation.z = Math.PI / 2;
  d1Body.position.set(0.0092 + rtcOx, rtcTopY + 0.0016, -0.0166);
  const d1Cathode = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.0013, 14), smdDarkMat);
  d1Cathode.rotation.z = Math.PI / 2;
  d1Cathode.position.set(0.0076 + rtcOx, rtcTopY + 0.0016, -0.0166);
  rtcGroup.add(d1Body, d1Cathode);
  for (const dx of [0.0059 + rtcOx, 0.0125 + rtcOx]) {
    const d1Cap = new THREE.Mesh(new THREE.CylinderGeometry(0.00165, 0.00165, 0.0014, 14), brushedSteelMat);
    d1Cap.rotation.z = Math.PI / 2;
    d1Cap.position.set(dx, rtcTopY + 0.0016, -0.0166);
    rtcGroup.add(d1Cap);
  }

  // 3) 7 Labeled SMD Resistors: R6(514), R4(155), R5(102), R8(201), R1(332), R3(332), R2(332)
  const res332TopMat = new THREE.MeshStandardMaterial({ map: res332Tex, roughness: 0.38, metalness: 0.14 });
  const res201TopMat = new THREE.MeshStandardMaterial({ map: res201Tex, roughness: 0.38, metalness: 0.14 });
  const res514TopMat = new THREE.MeshStandardMaterial({ map: res514Tex, roughness: 0.38, metalness: 0.14 });
  const res155TopMat = new THREE.MeshStandardMaterial({ map: res155Tex, roughness: 0.38, metalness: 0.14 });
  addSmdPart(rtcGroup, 0.0004 + rtcOx, rtcTopY + 0.0008, -0.0141, 0.0025, 0.0015, 0.0048, res514TopMat, smdDarkMat, false);
  addSmdPart(rtcGroup, 0.0004 + rtcOx, rtcTopY + 0.0008, -0.0037, 0.0025, 0.0015, 0.0048, res155TopMat, smdDarkMat, false);
  addSmdPart(rtcGroup, 0.0092 + rtcOx, rtcTopY + 0.0008, -0.0109, 0.0050, 0.0015, 0.0025, res102TopMat, smdDarkMat, true);
  addSmdPart(rtcGroup, 0.0092 + rtcOx, rtcTopY + 0.0008, -0.0053, 0.0050, 0.0015, 0.0025, res201TopMat, smdDarkMat, true);
  addSmdPart(rtcGroup, 0.0092 + rtcOx, rtcTopY + 0.0008,  0.0003, 0.0050, 0.0015, 0.0025, res332TopMat, smdDarkMat, true);
  addSmdPart(rtcGroup, -0.0102 + rtcOx, rtcTopY + 0.0008, 0.0223, 0.0048, 0.0015, 0.0024, res332TopMat, smdDarkMat, true);
  addSmdPart(rtcGroup,  0.0090 + rtcOx, rtcTopY + 0.0008, 0.0223, 0.0048, 0.0015, 0.0024, res332TopMat, smdDarkMat, true);

  // 4) C1 & C2 — 2x Tan/Brown MLCC Bypass Ceramic Capacitors
  addSmdPart(rtcGroup, -0.0021 + rtcOx, rtcTopY + 0.0010, 0.0105, 0.0023, 0.0019, 0.0045, null, espTanCapMat, false);
  addSmdPart(rtcGroup,  0.0021 + rtcOx, rtcTopY + 0.0010, 0.0105, 0.0023, 0.0019, 0.0045, null, espTanCapMat, false);

  // 5) U2 (DS1307Z) & U3 (24C32N) — Black SOIC-8 ICs with 8 shiny silver gull-wing legs each
  const ds1307TopMat = new THREE.MeshStandardMaterial({ map: ds1307Tex, roughness: 0.34, metalness: 0.18 });
  const at24c32TopMat = new THREE.MeshStandardMaterial({ map: at24c32Tex, roughness: 0.34, metalness: 0.18 });
  for (const [ucx, topMat] of [[-0.0098 + rtcOx, ds1307TopMat], [0.0096 + rtcOx, at24c32TopMat]]) {
    const ic = new THREE.Mesh(
      new THREE.BoxGeometry(0.0088, 0.0028, 0.0078),
      [smdDarkMat, smdDarkMat, topMat, smdDarkMat, smdDarkMat, smdDarkMat]
    );
    ic.position.set(ucx, rtcTopY + 0.0015, 0.0106);
    ic.castShadow = true;
    rtcGroup.add(ic);
    for (let k = 0; k < 4; k++) {
      const lx = ucx - 0.0031 + k * 0.0021;
      for (const lz of [0.0052, 0.0160]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.00085, 0.0009, 0.0025), brushedSteelMat);
        leg.position.set(lx, rtcTopY + 0.0005, lz);
        rtcGroup.add(leg);
      }
    }
  }

  // 6) Prominent Top-Mounted CR2032 3V Coin Cell Battery Holder + Engraved Silver Coin Cell + Rear-Rim Spring Clip
  const coinX = 0.0242;
  const coinTopMat = new THREE.MeshStandardMaterial({
    map: coinCellTopTex,
    roughness: 0.24,
    metalness: 0.78
  });
  const coinHolderBase = new THREE.Mesh(new THREE.CylinderGeometry(0.0110, 0.0114, 0.0052, 26), matteRubberMat);
  coinHolderBase.position.set(coinX, rtcTopY + 0.0026, 0.000);
  coinHolderBase.castShadow = true;
  // Side black plastic retention lugs characteristic of real CR2032 holders
  for (const sz of [-0.0108, 0.0108]) {
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.0068, 0.0058, 0.0022), dupontHousingMat);
    lug.position.set(coinX, rtcTopY + 0.0029, sz);
    rtcGroup.add(lug);
  }
  const coinCellMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0096, 0.0096, 0.0036, 28),
    [brushedSteelMat, coinTopMat, brushedSteelMat]
  );
  coinCellMesh.position.set(coinX, rtcTopY + 0.0055, 0.000);
  coinCellMesh.rotation.y = Math.PI / 2;
  coinCellMesh.castShadow = true;
  // Slim stainless-steel positive retention tab gripping the rear rim so engraved CR2032 text stays 100% legible
  const coinClipBar = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.0009, 0.0056), brushedSteelMat);
  coinClipBar.position.set(coinX, rtcTopY + 0.0077, -0.0084);
  const coinClipLeg = new THREE.Mesh(new THREE.BoxGeometry(0.0044, 0.0078, 0.0013), brushedSteelMat);
  coinClipLeg.position.set(coinX, rtcTopY + 0.0039, -0.0116);
  rtcGroup.add(coinHolderBase, coinCellMesh, coinClipBar, coinClipLeg);

  hotspotAnchors.rtc = new THREE.Object3D();
  hotspotAnchors.rtc.position.set(0.044, 0.028, 0.034);
  rtcGroup.add(hotspotAnchors.rtc);
  hotspotProxies.push(addHotspotProxy(rtcGroup, 'rtc', [0.088, 0.045, 0.068], [0.010, 0.014, 0]));

  // --- 6E. FIXED SIDE-ARM: BLACK SHADOW BAFFLE + 2x LM393 (4-PIN VCC/GND/DO/AO + CdS + DIFFUSER) ---
  const ldrGroup = new THREE.Group();
  ldrGroup.name = 'LdrBaffleFixedArm';
  ldrGroup.position.set(BOARD_ORIGINS.ldr.x, BOARD_ORIGINS.ldr.y, BOARD_ORIGINS.ldr.z);
  deckGroup.add(ldrGroup);

  const blackBaffleMat = new THREE.MeshStandardMaterial({
    color: 0x111317,
    roughness: 0.76,
    metalness: 0.06,
    bumpMap: powderBump,
    bumpScale: 0.0014
  });
  const ldrBase = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.006, 0.106), blackBaffleMat);
  ldrBase.castShadow = true;
  ldrBase.receiveShadow = true;
  ldrGroup.add(ldrBase);

  const baffleFin = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.098, 0.102), blackBaffleMat);
  baffleFin.position.set(0, 0.052, 0);
  baffleFin.castShadow = true;
  baffleFin.receiveShadow = true;
  ldrGroup.add(baffleFin);

  const lm393SideMat = new THREE.MeshStandardMaterial({ color: 0x06527a, roughness: 0.34, metalness: 0.16 });
  const trimpotMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.34, metalness: 0.08 });
  const cdsCeramicRimMat = new THREE.MeshStandardMaterial({ color: 0xe8b594, roughness: 0.42, metalness: 0.05 });
  const tanCapMat = new THREE.MeshStandardMaterial({ color: 0x9c7248, roughness: 0.38, metalness: 0.15 });
  const whiteLedBodyMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.35, metalness: 0.06 });
  const ldr1LedMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0ea5e9, emissiveIntensity: 0.9, roughness: 0.2 });
  const ldr2LedMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0ea5e9, emissiveIntensity: 0.9, roughness: 0.2 });
  const pwrLedGreenMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 1.0, roughness: 0.2 });

  // Live light-reactive CdS terracotta-orange top face materials (facing straight UP +Y, matching Photo 1!)
  const diffuser1Mat = new THREE.MeshStandardMaterial({
    map: cdsTex,
    emissive: 0xff6e38,
    emissiveIntensity: 0.16,
    roughness: 0.28,
    metalness: 0.14
  });
  const diffuser2Mat = diffuser1Mat.clone();

  function buildLm393Detailed(sideSign, pcbTex, ledMat, cdsTopMat, activePlugs) {
    const mod = new THREE.Group();
    const modX = sideSign * 0.044;
    mod.position.set(modX, 0.0055, 0);

    // 1) Deep ocean-teal blue LM393 PCB matching Photo 1
    const pcbTopMat = new THREE.MeshStandardMaterial({
      map: pcbTex,
      roughness: 0.34,
      metalness: 0.12,
      bumpMap: pcbBump,
      bumpScale: 0.0005
    });
    const pcb = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.004, 0.062),
      [lm393SideMat, lm393SideMat, pcbTopMat, lm393SideMat, lm393SideMat, lm393SideMat]
    );
    pcb.castShadow = true;
    mod.add(pcb);

    // 2) UPRIGHT (+Y) CdS Photoresistor at Rear (-Z, z = -0.0245) — POINTING STRAIGHT UP, NOT SIDEWAYS!
    const ldrZ = -0.0245;
    for (const lx of [-0.0034, 0.0034]) {
      // Silver solder dome on − / + pad
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.0012, 10, 8), brushedSteelMat);
      dome.scale.set(1, 0.55, 1);
      dome.position.set(lx, 0.0022, ldrZ);
      // Straight vertical metal leg rising cleanly UP (+Y)
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.00055, 0.00055, 0.0175, 8), brushedSteelMat);
      leg.position.set(lx, 0.0110, ldrZ);
      leg.castShadow = true;
      mod.add(dome, leg);
    }
    // Flat oval terracotta-orange CdS sensor disk facing STRAIGHT UP (+Y) on top of the 2 vertical legs!
    const ldrHead = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0054, 0.0054, 0.0030, 22),
      [cdsCeramicRimMat, cdsTopMat, cdsCeramicRimMat]
    );
    ldrHead.scale.set(1.20, 1.0, 0.92);
    ldrHead.position.set(0, 0.0205, ldrZ);
    ldrHead.castShadow = true;
    mod.add(ldrHead);

    // 3) Upper-mid SMD components (Photo 1): 2x black '103' resistors (left) + 2x tan ceramic caps (right)
    for (const rz of [-0.0152, -0.0102]) {
      // Left 103 SMD resistor + silver end caps
      const resBody = new THREE.Mesh(new THREE.BoxGeometry(0.0044, 0.0014, 0.0024), smdDarkMat);
      resBody.position.set(-0.0056, 0.0027, rz);
      const resCapL = new THREE.Mesh(new THREE.BoxGeometry(0.0010, 0.0015, 0.0025), brushedSteelMat);
      resCapL.position.set(-0.0080, 0.0027, rz);
      const resCapR = resCapL.clone();
      resCapR.position.x = -0.0032;
      mod.add(resBody, resCapL, resCapR);

      // Right tan ceramic SMD capacitor + silver end caps
      const capBody = new THREE.Mesh(new THREE.BoxGeometry(0.0044, 0.0016, 0.0026), tanCapMat);
      capBody.position.set(0.0056, 0.0028, rz);
      const capEndL = new THREE.Mesh(new THREE.BoxGeometry(0.0010, 0.0017, 0.0027), brushedSteelMat);
      capEndL.position.set(0.0032, 0.0028, rz);
      const capEndR = capEndL.clone();
      capEndR.position.x = 0.0080;
      mod.add(capBody, capEndL, capEndR);
    }

    // 4) Center-LEFT: Black 8-pin SOIC LM393 comparator IC with 8 shiny silver gull-wing legs (Photo 1!)
    const ic = new THREE.Mesh(new THREE.BoxGeometry(0.0068, 0.0024, 0.0088), smdDarkMat);
    ic.position.set(-0.0058, 0.0032, 0.0005);
    mod.add(ic);
    for (let pin = 0; pin < 4; pin++) {
      const lz = -0.0027 + pin * 0.0021;
      for (const sx of [-0.0099, -0.0017]) {
        const icLeg = new THREE.Mesh(new THREE.BoxGeometry(0.0018, 0.0008, 0.0009), brushedSteelMat);
        icLeg.position.set(sx, 0.0024, lz);
        mod.add(icLeg);
      }
    }

    // 5) Center-RIGHT: Flat square royal-blue open-frame trimmer pot with silver recessed '+' dial (Photo 1!)
    const potBase = new THREE.Mesh(new THREE.BoxGeometry(0.0098, 0.0046, 0.0098), trimpotMat);
    potBase.position.set(0.0056, 0.0043, 0.0005);
    potBase.castShadow = true;
    const potDial = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0008, 16), brushedSteelMat);
    potDial.position.set(0.0056, 0.0067, 0.0005);
    const slotH = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.0006, 0.0010), smdDarkMat);
    slotH.position.set(0.0056, 0.0070, 0.0005);
    const slotV = new THREE.Mesh(new THREE.BoxGeometry(0.0010, 0.0006, 0.0042), smdDarkMat);
    slotV.position.set(0.0056, 0.0070, 0.0005);
    mod.add(potBase, potDial, slotH, slotV);

    // 6) Lower-mid: PWR-LED (left) & DO-LED (right) flanking center mounting hole + tiny '102' resistors
    const pwrLedBase = new THREE.Mesh(new THREE.BoxGeometry(0.0040, 0.0016, 0.0026), whiteLedBodyMat);
    pwrLedBase.position.set(-0.0082, 0.0028, 0.0145);
    const pwrLedLens = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0010, 0.0016), pwrLedGreenMat);
    pwrLedLens.position.set(-0.0082, 0.0038, 0.0145);

    const doLedBase = new THREE.Mesh(new THREE.BoxGeometry(0.0040, 0.0016, 0.0026), whiteLedBodyMat);
    doLedBase.position.set(0.0082, 0.0028, 0.0145);
    const doLedLens = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0010, 0.0016), ledMat);
    doLedLens.position.set(0.0082, 0.0038, 0.0145);

    const r102L = new THREE.Mesh(new THREE.BoxGeometry(0.0034, 0.0012, 0.0018), smdDarkMat);
    r102L.position.set(-0.0068, 0.0026, 0.0095);
    const r102R = new THREE.Mesh(new THREE.BoxGeometry(0.0034, 0.0012, 0.0018), smdDarkMat);
    r102R.position.set(0.0068, 0.0026, 0.0095);
    mod.add(pwrLedBase, pwrLedLens, doLedBase, doLedLens, r102L, r102R);

    // 7) Front (+Z) black 4-pin header block + 4 metallic pins matching getLdrPinPos()
    const hdrBase = new THREE.Mesh(new THREE.BoxGeometry(0.0235, 0.0028, 0.0044), dupontHousingMat);
    hdrBase.position.set(0, 0.0034, 0.027);
    mod.add(hdrBase);

    for (let pi = 0; pi < 4; pi++) {
      const pw = getLdrPinPos(sideSign, pi).world;
      pushInst(goldPinMats, pw[0], BOARD_ORIGINS.ldr.y + 0.0095, pw[2], 0, 0, 0, 1, 1, 1);
    }
    for (const plug of activePlugs) {
      pushDupontPlug(getLdrPinPos(sideSign, plug.index).world);
    }

    return mod;
  }

  ldrGroup.add(buildLm393Detailed(-1, lm393Ldr1Tex, ldr1LedMat, diffuser1Mat, ACTIVE_DUPONT_PLUGS.ldr1));
  ldrGroup.add(buildLm393Detailed(1,  lm393Ldr2Tex, ldr2LedMat, diffuser2Mat, ACTIVE_DUPONT_PLUGS.ldr2));

  hotspotAnchors.ldr = new THREE.Object3D();
  hotspotAnchors.ldr.position.set(0, 0.118, 0.01);
  ldrGroup.add(hotspotAnchors.ldr);
  hotspotProxies.push(addHotspotProxy(ldrGroup, 'ldr', [0.19, 0.13, 0.13], [0, 0.05, 0]));

  // ==========================================================================
  // 7. OVERHEAD SOLAR PANEL (FRONT CELLS PITCHED TOWARD +Z, SAME SIDE AS WATT METER & SCC!)
  // ==========================================================================
  const panelPivot = new THREE.Group();
  panelPivot.name = 'PanelTiltPivot';
  panelPivot.position.set(RIG_DIMS.pivotPos.x, RIG_DIMS.pivotPos.y, RIG_DIMS.pivotPos.z);
  root.add(panelPivot);

  // Hinge tongue & rear (-Z) servo pushrod anchor rotate around X-axis (+Z Watt Meter <-> -Z opposite)
  const pivotTongue = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.044, 0.024), blackSteelMat);
  pivotTongue.position.set(0, 0.016, 0);
  panelPivot.add(pivotTongue);

  const anchorBracketArm = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.010, 0.016), blackSteelMat);
  anchorBracketArm.position.set(RIG_DIMS.bracketAnchorLocal.x * 0.5, RIG_DIMS.bracketAnchorLocal.y, RIG_DIMS.bracketAnchorLocal.z);
  panelPivot.add(anchorBracketArm);

  const anchorPin = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.020, 12), brushedSteelMat);
  anchorPin.rotation.z = Math.PI / 2;
  anchorPin.position.set(
    RIG_DIMS.bracketAnchorLocal.x,
    RIG_DIMS.bracketAnchorLocal.y,
    RIG_DIMS.bracketAnchorLocal.z
  );
  panelPivot.add(anchorPin);

  // Panel holder sits flat at 90° and rotates around X directly toward Watt Meter (+Z) and opposite (-Z)!
  const panelFaceHolder = new THREE.Group();
  panelFaceHolder.name = 'PanelFrontFacingHolder';
  panelFaceHolder.position.set(0, 0.028, 0);
  panelFaceHolder.rotation.x = RIG_DIMS.panelFrontPitchRad;
  panelPivot.add(panelFaceHolder);

  const crossBarX = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.014, 0.028), blackSteelMat);
  crossBarX.position.set(0, 0.004, 0);
  crossBarX.castShadow = true;
  const crossBarZ = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.014, 0.58), blackSteelMat);
  crossBarZ.position.set(0, 0.004, 0);
  crossBarZ.castShadow = true;
  panelFaceHolder.add(crossBarX, crossBarZ);

  const panelEdgeMat = trackStructMat(new THREE.MeshStandardMaterial({ color: 0xe2e5ea, roughness: 0.52, metalness: 0.05 }));
  const panelFrontMat = trackStructMat(new THREE.MeshPhysicalMaterial({
    map: solarFrontTex,
    roughness: 0.16,
    metalness: 0.16,
    clearcoat: 0.90,
    clearcoatRoughness: 0.12
  }));
  const panelBackMat = trackStructMat(new THREE.MeshStandardMaterial({
    map: solarBackTex,
    roughness: 0.56,
    metalness: 0.04
  }));

  const panelMesh = new THREE.Mesh(
    new THREE.BoxGeometry(RIG_DIMS.panelWidth, RIG_DIMS.panelThick, RIG_DIMS.panelDepth),
    [panelEdgeMat, panelEdgeMat, panelFrontMat, panelBackMat, panelEdgeMat, panelEdgeMat]
  );
  panelMesh.position.set(0, 0.018, 0);
  panelMesh.castShadow = true;
  panelMesh.receiveShadow = true;
  panelFaceHolder.add(panelMesh);

  const gromGeo = new THREE.TorusGeometry(0.011, 0.003, 10, 20);
  const gx = RIG_DIMS.panelWidth * 0.5 - 0.022;
  const gz = RIG_DIMS.panelDepth * 0.5 - 0.022;
  for (const [cx, cz] of [[-gx, -gz], [gx, -gz], [-gx, gz], [gx, gz]]) {
    const grom = new THREE.Mesh(gromGeo, brushedSteelMat);
    grom.rotation.x = Math.PI / 2;
    grom.position.set(cx, 0.025, cz);
    panelFaceHolder.add(grom);
  }

  const jboxFaceMat = new THREE.MeshStandardMaterial({ map: jboxTex, roughness: 0.24, metalness: 0.12 });
  const jboxMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.084, 0.022, 0.084),
    [darkPlasticMat, darkPlasticMat, darkPlasticMat, jboxFaceMat, darkPlasticMat, darkPlasticMat]
  );
  jboxMesh.position.set(0, 0.001, -0.155);
  jboxMesh.castShadow = true;
  panelFaceHolder.add(jboxMesh);

  hotspotAnchors.panel = new THREE.Object3D();
  hotspotAnchors.panel.position.set(0, 0.068, 0.03);
  panelFaceHolder.add(hotspotAnchors.panel);
  hotspotProxies.push(
    addHotspotProxy(panelFaceHolder, 'panel', [RIG_DIMS.panelWidth, 0.08, RIG_DIMS.panelDepth], [0, 0.018, 0])
  );

  // ==========================================================================
  // 8. COMMIT ALL INSTANCED HARDWARE BATCHES
  // ==========================================================================
  const instGroup = new THREE.Group();
  instGroup.name = 'InstancedPinsAndHardware';
  root.add(instGroup);

  const batches = [
    buildInstancedBatch(new THREE.BoxGeometry(0.0012, 0.0096, 0.0012), goldPinMat, goldPinMats, 'GoldHeaderPins'),
    buildInstancedBatch(new THREE.BoxGeometry(0.0029, 0.0112, 0.0029), dupontHousingMat, dupontMats, 'DupontHousings'),
    buildInstancedBatch(new THREE.BoxGeometry(0.0013, 0.0036, 0.0005), brushedSteelMat, crimpMats, 'DupontCrimps'),
    buildInstancedBatch(new THREE.CylinderGeometry(0.0028, 0.0028, 0.0022, 12), brassMat, brassScrewMats, 'BrassTerminalScrews'),
    buildInstancedBatch(new THREE.CylinderGeometry(0.0024, 0.0024, 0.0028, 6), brushedSteelMat, boltMats, 'HexFasteners'),
    buildInstancedBatch(new THREE.BoxGeometry(0.0032, 0.0012, 0.0018), smdDarkMat, smdMats, 'SmdComponents')
  ];
  for (const b of batches) {
    if (b) instGroup.add(b);
  }

  // ==========================================================================
  // 9. CLICKABLE 3D WIRING HARNESS (24 Exact Pin-to-Pin Wires + Hit Proxies!)
  // ==========================================================================
  const cablesGroup = new THREE.Group();
  cablesGroup.name = 'WiringHarnessGroup';
  root.add(cablesGroup);

  const wireSpecs = buildPinAccurateWireSpecs();
  const wireById = new Map();
  for (const spec of wireSpecs) {
    const entry = makeCableEntry(spec);
    cablesGroup.add(entry.mesh);
    cablesGroup.add(entry.hitMesh);
    wireEntries.push(entry);
    wireHitProxies.push(entry.hitMesh);
    wireById.set(spec.id, entry);
  }

  // ==========================================================================
  // 10. CLICKABLE PHYSICAL PIN HIT PROXIES & 3D SELECTION HALO RINGS
  // ==========================================================================
  const pinHitGroup = new THREE.Group();
  pinHitGroup.name = 'ClickablePinHitGroup';
  root.add(pinHitGroup);

  const pinRegistry = buildClickablePinRegistry();
  const pinById = new Map();
  const pinHitMat = new THREE.MeshBasicMaterial({ visible: false });
  const pinGeoSmall = new THREE.SphereGeometry(0.0068, 8, 8);
  const pinGeoLarge = new THREE.SphereGeometry(0.0115, 8, 8);

  for (const pin of pinRegistry) {
    const isLarge = pin.id.startsWith('scc-') || pin.id.startsWith('watt-') || pin.id.startsWith('bat-') || pin.id.startsWith('xl-');
    const proxy = new THREE.Mesh(isLarge ? pinGeoLarge : pinGeoSmall, pinHitMat);
    proxy.position.set(pin.pos[0], pin.pos[1], pin.pos[2]);
    proxy.layers.set(PIN_HIT_LAYER);
    proxy.userData.pinData = pin;
    pinHitGroup.add(proxy);
    pinHitProxies.push(proxy);
    pinById.set(pin.id, pin);
  }

  // 3D glowing halo markers for selected origin pin (cyan), destination pin(s) (amber), and hover preview (white)
  const markersGroup = new THREE.Group();
  markersGroup.name = 'PinSelectionHalosGroup';
  root.add(markersGroup);

  const pinHaloOrigin = createPinHaloMarker(0x00e5ff);
  const pinHaloTargets = [
    createPinHaloMarker(0xffb300),
    createPinHaloMarker(0xffb300),
    createPinHaloMarker(0xffb300),
    createPinHaloMarker(0xffb300)
  ];
  const pinHaloHover = createPinHaloMarker(0xffffff);
  markersGroup.add(pinHaloOrigin, pinHaloHover, ...pinHaloTargets);

  // Macro pin callout 3D anchors
  for (const callout of buildMacroPinCallouts()) {
    const anchor = new THREE.Object3D();
    anchor.position.set(callout.pos[0], callout.pos[1] + 0.006, callout.pos[2]);
    root.add(anchor);
    pinCalloutAnchors.push({ ...callout, anchor });
  }

  // ==========================================================================
  // 11. INTERACTIVE HIGHLIGHT ENGINE (Category Net, Single Wire, Single Pin, Hover!)
  // ==========================================================================
  let stateWiringHighlight = false;
  let stateFocusCategory = null;
  let stateSelectedWireIds = null; // Set<string> | null
  let stateHoveredWireId = null;

  function applyWireVisualState() {
    const hasSpecificWires = !!(stateSelectedWireIds && stateSelectedWireIds.size > 0);
    const dimStruct = stateWiringHighlight || hasSpecificWires;

    for (const s of structuralMats) {
      s.mat.transparent = dimStruct ? true : s.origTransparent;
      s.mat.opacity = dimStruct ? (hasSpecificWires ? 0.34 : (stateFocusCategory ? 0.24 : 0.32)) : s.origOpacity;
      s.mat.depthWrite = !dimStruct;
      s.mat.needsUpdate = true;
    }

    for (const w of wireEntries) {
      const isHovered = stateHoveredWireId === w.id;
      if (hasSpecificWires) {
        if (stateSelectedWireIds.has(w.id)) {
          w.mat.color.setHex(w.highlightHex);
          w.mat.emissive.setHex(w.highlightHex);
          w.mat.emissiveIntensity = 1.25;
          w.mat.transparent = false;
          w.mat.opacity = 1;
        } else if (isHovered) {
          w.mat.color.setHex(w.highlightHex);
          w.mat.emissive.setHex(w.highlightHex);
          w.mat.emissiveIntensity = 0.65;
          w.mat.transparent = false;
          w.mat.opacity = 0.9;
        } else {
          w.mat.color.setHex(0x334155);
          w.mat.emissive.setHex(0x000000);
          w.mat.emissiveIntensity = 0;
          w.mat.transparent = true;
          w.mat.opacity = 0.15;
        }
      } else if (stateWiringHighlight) {
        if (!stateFocusCategory || w.category === stateFocusCategory) {
          w.mat.color.setHex(w.highlightHex);
          w.mat.emissive.setHex(w.highlightHex);
          w.mat.emissiveIntensity = isHovered ? 1.35 : (stateFocusCategory ? 1.15 : 0.85);
          w.mat.transparent = false;
          w.mat.opacity = 1;
        } else if (isHovered) {
          w.mat.color.setHex(w.highlightHex);
          w.mat.emissive.setHex(w.highlightHex);
          w.mat.emissiveIntensity = 0.7;
          w.mat.transparent = false;
          w.mat.opacity = 0.9;
        } else {
          w.mat.color.setHex(0x334155);
          w.mat.emissive.setHex(0x000000);
          w.mat.emissiveIntensity = 0;
          w.mat.transparent = true;
          w.mat.opacity = 0.16;
        }
      } else {
        if (isHovered) {
          w.mat.color.setHex(w.highlightHex);
          w.mat.emissive.setHex(w.highlightHex);
          w.mat.emissiveIntensity = 0.9;
          w.mat.transparent = false;
          w.mat.opacity = 1;
        } else {
          w.mat.color.setHex(w.baseColor);
          w.mat.emissive.setHex(0x000000);
          w.mat.emissiveIntensity = 0;
          w.mat.transparent = false;
          w.mat.opacity = 1;
        }
      }
      w.mat.needsUpdate = true;
    }
  }

  function setWiringHighlight(active, focusCategory = null) {
    stateWiringHighlight = !!active;
    stateFocusCategory = stateWiringHighlight ? (focusCategory || null) : null;
    if (!stateWiringHighlight) {
      stateSelectedWireIds = null;
      setPinHalos(null, []);
    }
    applyWireVisualState();
  }

  function setPinHalos(originPos, targetPositions = []) {
    if (originPos) {
      pinHaloOrigin.position.set(originPos[0], originPos[1], originPos[2]);
      pinHaloOrigin.visible = true;
    } else {
      pinHaloOrigin.visible = false;
    }
    for (let i = 0; i < pinHaloTargets.length; i++) {
      const tp = targetPositions[i];
      if (tp) {
        pinHaloTargets[i].position.set(tp[0], tp[1], tp[2]);
        pinHaloTargets[i].visible = true;
      } else {
        pinHaloTargets[i].visible = false;
      }
    }
  }

  function setSelectionHighlight(wireIds = [], originPos = null, targetPositions = []) {
    stateSelectedWireIds = wireIds && wireIds.length > 0 ? new Set(wireIds) : null;
    setPinHalos(originPos, targetPositions);
    applyWireVisualState();
  }

  function setHoverPreview(wireId = null, pinPos = null) {
    const wireChanged = stateHoveredWireId !== wireId;
    stateHoveredWireId = wireId || null;
    if (pinPos) {
      pinHaloHover.position.set(pinPos[0], pinPos[1], pinPos[2]);
      pinHaloHover.visible = true;
    } else {
      pinHaloHover.visible = false;
    }
    if (wireChanged) applyWireVisualState();
  }

  // ==========================================================================
  // 12. MECHANICAL KINEMATICS & LIVE TELEMETRY UPDATE
  // ==========================================================================
  const _upAxis = new THREE.Vector3(0, 1, 0);
  const _dirVec = new THREE.Vector3();
  const _quat = new THREE.Quaternion();

  function updateMechanics(panelTiltRad, hornRad) {
    // Rotate solar panel & servo horn around X-axis so panel tilts toward Watt Meter (+Z) and opposite (-Z)!
    panelPivot.rotation.x = panelTiltRad;
    hornPivot.rotation.x = hornRad;

    const rod = computePushrodGeometry({
      hornOrigin: RIG_DIMS.hornOrigin,
      hornLength: RIG_DIMS.hornLength,
      hornAngleRad: hornRad,
      pivotOrigin: RIG_DIMS.pivotPos,
      bracketAnchorLocal: RIG_DIMS.bracketAnchorLocal,
      panelTiltRad
    });

    pushrodMesh.position.set(rod.midpoint.x, rod.midpoint.y, rod.midpoint.z);
    pushrodMesh.scale.set(1, Math.max(0.02, rod.length), 1);
    _dirVec.set(rod.direction.x, rod.direction.y, rod.direction.z);
    _quat.setFromUnitVectors(_upAxis, _dirVec);
    pushrodMesh.quaternion.copy(_quat);
  }

  function updateTelemetryVisuals(status, elec, dtSec) {
    const l1 = (status?.ldr1?.pct ?? 50) / 100;
    const l2 = (status?.ldr2?.pct ?? 50) / 100;
    ldr1LedMat.emissiveIntensity = 0.15 + l1 * 1.9;
    ldr2LedMat.emissiveIntensity = 0.15 + l2 * 1.9;
    diffuser1Mat.emissiveIntensity = 0.05 + l1 * 0.45;
    diffuser2Mat.emissiveIntensity = 0.05 + l2 * 0.45;

    const hasErr = !!(status?.servo?.locked || (status?.brownoutCount || 0) > 0 || (status?.faults || []).some((f) => f.includes('WIRING') || f.includes('BROWNOUT')));
    const isWarn = !hasErr && (status?.sourceMode === 'sim' || status?.servo?.mode === 'MANUAL');
    if (hasErr) {
      espLedMat.color.setHex(0xff3b30);
      espLedMat.emissive.setHex(0xff3b30);
    } else if (isWarn) {
      espLedMat.color.setHex(0xff9500);
      espLedMat.emissive.setHex(0xff9500);
    } else {
      espLedMat.color.setHex(0x34c759);
      espLedMat.emissive.setHex(0x34c759);
    }

    if (elec?.servoActive) {
      xlLedMat.color.setHex(0xff9f0a);
      xlLedMat.emissive.setHex(0xff9f0a);
      xlLedMat.emissiveIntensity = 1.9;
    } else {
      xlLedMat.color.setHex(0x22d3ee);
      xlLedMat.emissive.setHex(0x0ea5e9);
      xlLedMat.emissiveIntensity = 0.9;
    }

    sccDisplay.update(elec);
    wattDisplay.update(elec, dtSec);
  }

  updateMechanics(0, 0);

  return {
    root,
    panelPivot,
    hotspotAnchors,
    hotspotProxies,
    pinCalloutAnchors,
    wireEntries,
    wireHitProxies,
    wireById,
    pinRegistry,
    pinHitProxies,
    pinById,
    updateMechanics,
    updateTelemetryVisuals,
    setWiringHighlight,
    setSelectionHighlight,
    setHoverPreview,
    dispose() {
      disposables.forEach((t) => t.dispose());
    }
  };
}
