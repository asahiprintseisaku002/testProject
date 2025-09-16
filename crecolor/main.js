import * as THREE from 'three';
import { blitVert } from './blit.vert.js';
import { simFrag } from './sim.frag.js';
import { composeFrag } from './compose.frag.js';

// ====== 設定（後からいくらでも調整OK） ======
const PALETTE = [
  0xff5a5a, // 赤系
  0x5ab8ff, // 青系
  0xffd35a, // 黄系
  0x8cff9a  // 緑系
];

const PARAMS = {
  diffusion: 0.72,      // 拡散量（0〜1）
  decay:    0.006,      // 減衰量（毎フレーム）
  injectStrength: 0.1,  // 注入強度（濃さ）
  brushRadius:   0.035, // にじみの初期半径（画面比）
  stationaryMs:  80,   // “止まった”と判定する静止時間[ms]
  moveEpsilon:   2.0,   // “動いた”とみなすピクセル閾値
  resolutionScale: 0.5,  // 0.5 にすると低解像度で軽くなる
  stationaryMs: 280,
  moveEpsilon:  2.0,
  holdGrowRadiusPerSec:   0.020, // 半径の増分/秒
  holdGrowStrengthPerSec: 0.50,  // 濃さの増分/秒
  holdMaxRadiusScale:     2.2,   // 半径は最大で base*2.2 まで
  holdMaxStrengthScale:   2.5    // 濃さは最大で base*2.5 まで
};

// ====== 基本セットアップ ======
const canvas   = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// 背景クリア色（透明黒）。不透明にしたいなら第2引数を1に。
renderer.setClearColor(0xffffff, 0);

resize();

const scene   = new THREE.Scene();
const camera  = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// フルスクリーンクアッド用ジオメトリ
const quadGeo = new THREE.PlaneGeometry(2, 2);

// Ping-Pong のレンダーターゲット
function makeRT(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    type: renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    format: THREE.RGBAFormat
  });
}

let simW, simH;
let rtA, rtB;

function allocRTs() {
  const d = renderer.getDrawingBufferSize(new THREE.Vector2());
  simW = Math.max(64, Math.floor(d.x * PARAMS.resolutionScale));
  simH = Math.max(64, Math.floor(d.y * PARAMS.resolutionScale));

  rtA?.dispose();
  rtB?.dispose();

  rtA = makeRT(simW, simH);
  rtB = makeRT(simW, simH);
  // ★ 追加：にじみが端で止まらず循環するようにする
  //rtA.texture.wrapS = rtA.texture.wrapT = THREE.RepeatWrapping;
  //rtB.texture.wrapS = rtB.texture.wrapT = THREE.RepeatWrapping;

  // 初期クリア
  renderer.setRenderTarget(rtA);
  renderer.clear(true, true, true);
  renderer.setRenderTarget(rtB);
  renderer.clear(true, true, true);
  renderer.setRenderTarget(null);
}
allocRTs();

// ====== シェーダ（JSモジュールから文字列として受け取る） ======
const blitVertSrc   = blitVert;
const simFragSrc    = simFrag;
const composeFragSrc= composeFrag;

// シミュレーションパス（拡散＋減衰＋インク注入）
const simMat = new THREE.ShaderMaterial({
  vertexShader:   blitVertSrc,
  fragmentShader: simFragSrc,
  glslVersion: THREE.GLSL1,
  uniforms: {
    prevTex:        { value: rtA.texture },
    texel:          { value: new THREE.Vector2(1/simW, 1/simH) },
    diffusion:      { value: PARAMS.diffusion },
    decay:          { value: PARAMS.decay },
    mouse:          { value: new THREE.Vector2(-10,-10) }, // 画面外
    injecting:      { value: 0.0 },
    injectColor:    { value: new THREE.Vector4(0,0,0,0) },
    injectRadius:   { value: PARAMS.brushRadius },
    injectStrength: { value: PARAMS.injectStrength },
    time: { value: 0.0 },
    advectAmp: { value: 0.35 },   // 流れの強さ（画面比）
    advectFreq: { value: 2.73 },   // 流れの周波数
    advectSpeed: { value: 0.01 }, // 流れ場の時間変化
    flowScale: { value: 2.6 },
    injectAxes:  { value: new THREE.Vector2(1.0, 1.0) }, // 1,1 で丸
    injectAngle: { value: 0.0 },                         // 0 = 無回転
  },
  blending: THREE.NoBlending,
  depthTest: false,
  depthWrite: false
});
const simMesh = new THREE.Mesh(quadGeo, simMat);
const simScene = new THREE.Scene();
simScene.add(simMesh);

// 合成パス（RGBA の濃度をパレット色で合成して表示）
const paletteVec3 = PALETTE.map(hex => {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
});
const composeMat = new THREE.ShaderMaterial({
  vertexShader:   blitVertSrc,
  fragmentShader: composeFragSrc,
  glslVersion: THREE.GLSL1,
  uniforms: {
    fieldTex: { value: rtA.texture },
    // ここを増やせば色数拡張可：compose.frag / JS 側の uniforms にも追加する
    colors0:  { value: paletteVec3[0] ?? new THREE.Vector3(0,0,0) },
    colors1:  { value: paletteVec3[1] ?? new THREE.Vector3(0,0,0) },
    colors2:  { value: paletteVec3[2] ?? new THREE.Vector3(0,0,0) },
    colors3:  { value: paletteVec3[3] ?? new THREE.Vector3(0,0,0) },
    exposure: { value: 1.0 },
    gamma:    { value: 2.2 }
  },
  depthTest: false,
  depthWrite:false
});
const composeMesh  = new THREE.Mesh(quadGeo, composeMat);
scene.add(composeMesh);

// ====== マウス＆ステート ======
let mouseNDC = new THREE.Vector2(-10, -10);
let lastPx   = new THREE.Vector2(0, 0);
let lastMoveTime = performance.now();
let injecting = false;
let currentColorIndex = 0;

let isPointerDown = false;
let pointerId = null;

let holdStartTime = 0;    // 押下開始時刻
let holdElapsedSec = 0;   // 押下継続時間（秒）

// ベース値（PARAMSから）
const baseRadius   = PARAMS.brushRadius;
const baseStrength = PARAMS.injectStrength;


function pickNextColor() {
  currentColorIndex = (currentColorIndex + 1) % PALETTE.length;
}

function screenToUV(evt) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = (evt.clientX - rect.left) / rect.width;
  const y = (evt.clientY - rect.top)  / rect.height;
  return new THREE.Vector2(x, 1 - y); // UV は下原点
}

function handleMove(evt) {
  const rect = renderer.domElement.getBoundingClientRect();
  const px = new THREE.Vector2(evt.clientX - rect.left, evt.clientY - rect.top);
  const dist = px.distanceTo(lastPx);
  lastPx.copy(px);

  const uv = screenToUV(evt);
  mouseNDC.set(uv.x, uv.y);

  const t = performance.now();
  if (dist > PARAMS.moveEpsilon) {
    lastMoveTime = t;     // 動いた
    injecting = false;    // 直ちに注入は止める
  } else {
    // 一定時間止まっていたら注入開始（開始のタイミングで色を切替）
    if (!injecting && (t - lastMoveTime) > PARAMS.stationaryMs) {
      pickNextColor();
      injecting = true;
    }
  }
}

function handleEnter(evt) {
  lastMoveTime = performance.now();
  injecting = false;
  handleMove(evt);
}
function handleLeave() {
  injecting = false;
  mouseNDC.set(-10, -10); // 画面外に
}

renderer.domElement.addEventListener('mousemove', handleMove);
renderer.domElement.addEventListener('mouseenter', handleEnter);
renderer.domElement.addEventListener('mouseleave', handleLeave);

window.addEventListener('resize', () => {
  resize();
  allocRTs();
  // 解像度変更をシェーダに反映
  simMat.uniforms.prevTex.value = rtA.texture;
  simMat.uniforms.texel.value.set(1/simW, 1/simH);
  composeMat.uniforms.fieldTex.value = rtA.texture;
});

// 既存の mousemove/mouseenter/mouseleave は残してOKですが、
// モバイル主眼なら pointer 系でまとまるのでこちら推奨

function updateFromClientXY(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  const px = new THREE.Vector2(clientX - rect.left, clientY - rect.top);
  const dist = px.distanceTo(lastPx);
  lastPx.copy(px);

  const uv = new THREE.Vector2(
    (clientX - rect.left) / rect.width,
    1 - (clientY - rect.top) / rect.height
  );
  mouseNDC.copy(uv);

  const t = performance.now();
  if (dist > PARAMS.moveEpsilon) {
    lastMoveTime = t;
    // 動いた瞬間は注入停止（静止したら再開）
    if (!isPointerDown) injecting = false;
  } else {
    if (!injecting && (t - lastMoveTime) > PARAMS.stationaryMs && isPointerDown) {
      pickNextColor();
      injecting = true;
      // 静止で注入を始めるタイミングで hold をリセットしない（押下時間で成長）
    }
  }
}

function onPointerDown(e){
  if (pointerId !== null) return;       // マルチタッチ無視（最初の指のみ）
  pointerId = e.pointerId;
  isPointerDown = true;
  lastMoveTime = performance.now();
  holdStartTime = performance.now();
  holdElapsedSec = 0;
  injecting = false;                    // 最初は停止、一定静止で開始
  updateFromClientXY(e.clientX, e.clientY);
  // 一部ブラウザでのスクロール抑制
  if (renderer.domElement.setPointerCapture) {
    renderer.domElement.setPointerCapture(pointerId);
  }
}

function onPointerMove(e){
  if (pointerId !== e.pointerId) return;
  updateFromClientXY(e.clientX, e.clientY);
}

function onPointerUp(e){
  if (pointerId !== e.pointerId) return;
  isPointerDown = false;
  injecting = false;                    // 指を離したら注入停止
  pointerId = null;
}

function onPointerCancel(e){
  if (pointerId !== e.pointerId) return;
  isPointerDown = false;
  injecting = false;
  pointerId = null;
  mouseNDC.set(-10, -10);               // 画面外へ
}

renderer.domElement.addEventListener('pointerdown', onPointerDown, { passive: true });
renderer.domElement.addEventListener('pointermove', onPointerMove,   { passive: true });
renderer.domElement.addEventListener('pointerup',   onPointerUp,     { passive: true });
renderer.domElement.addEventListener('pointercancel', onPointerCancel, { passive: true });

// マウス離脱でも注入停止
renderer.domElement.addEventListener('mouseleave', () => {
  isPointerDown = false;
  injecting = false;
  pointerId = null;
  mouseNDC.set(-10, -10);
});


function resize() {
  const w = Math.floor(window.innerWidth);
  const h = Math.floor(window.innerHeight);
  renderer.setSize(w, h, false);
}

// ====== ループ ======
const colorToVec4 = (index) => {
  // RGBA各成分=各色の濃度（one-hot）
  const v = [0,0,0,0];
  // index が色数以上の場合に備えて保険
  v[(index % 4 + 4) % 4] = 1.0;
  return new THREE.Vector4(v[0], v[1], v[2], v[3]);
};

function frame() {
  const now = performance.now();
  if (isPointerDown) {
    holdElapsedSec = (now - holdStartTime) * 0.001;
  } else {
    holdElapsedSec = 0;
  }

  // 押下時間に比例して成長（クランプあり）
  const radiusScale   = Math.min(1 + PARAMS.holdGrowRadiusPerSec   * holdElapsedSec,   PARAMS.holdMaxRadiusScale);
  const strengthScale = Math.min(1 + PARAMS.holdGrowStrengthPerSec * holdElapsedSec,   PARAMS.holdMaxStrengthScale);

  // シェーダへ反映
  simMat.uniforms.injectRadius.value   = baseRadius   * radiusScale;
  simMat.uniforms.injectStrength.value = baseStrength * strengthScale;

  // 既存：注入フラグやマウス座標など
  simMat.uniforms.prevTex.value = rtA.texture;
  simMat.uniforms.injecting.value = injecting ? 1.0 : 0.0;
  simMat.uniforms.mouse.value.copy(mouseNDC);
  simMat.uniforms.injectColor.value = colorToVec4(currentColorIndex);

  // --- シミュレーション＆描画 ---
  renderer.setRenderTarget(rtB);
  renderer.render(simScene, camera);
  renderer.setRenderTarget(null);

  [rtA, rtB] = [rtB, rtA];

  composeMat.uniforms.fieldTex.value = rtA.texture;
  renderer.render(scene, camera);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

renderer.debug.checkShaderErrors = true;