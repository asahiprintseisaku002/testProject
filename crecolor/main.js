import * as THREE from 'three';
import { blitVert } from './blit.vert.js';
import { simFrag } from './sim.frag.js';
import { composeFrag } from './compose.frag.js';

// ====== 設定（後からいくらでも調整OK） ======
const PALETTE = [
  0xe8380d, // 赤系
  0x024299, // 青系
  0xffda08, // 黄系
  0x039a46  // 緑系
];

const PARAMS = {
  diffusion: 0.90,      // 拡散量（0〜1）
  decay:    0.008,      // 減衰量（毎フレーム）
  injectStrength: 0.3,  // 注入強度（濃さ）
  brushRadius:   0.035, // にじみの初期半径（画面比）
  stationaryMs:  80,   // “止まった”と判定する静止時間[ms]
  moveEpsilon:   10.0,   // “動いた”とみなすピクセル閾値
  resolutionScale: 0.5,  // 0.5 にすると低解像度で軽くなる

  holdGrowRadiusPerSec:   0.020, // 半径の増分/秒
  holdGrowStrengthPerSec: 0.50,  // 濃さの増分/秒
  holdMaxRadiusScale:     2.2,   // 半径は最大で base*2.2 まで
  holdMaxStrengthScale:   2.5,    // 濃さは最大で base*2.5 まで
  followDelayMs: 200,   // 注入開始から何ms待って追従を始めるか（“後に動く”感）
  followTau:     0.35,  // 追従の時定数（秒）小さい=素早く追う, 大きい=ゆっくり
  followWhenDown: true, // 押下中にも追うなら true。離した後だけなら false

    // ★ 追加：動作に応じた減衰
  decayWhileMove: 0.003,  // 動いている間の減衰（ゆっくり消える）
  decayWhileStop: 0.015,  // 止まった後の減衰（早く消える）
  decayEaseTau:   0.25,   // 減衰の切替を滑らかにする時定数[秒]
};

// ====== 基本セットアップ ======
const canvas   = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// 背景クリア色（透明黒）。不透明にしたいなら第2引数を1に。
renderer.setClearColor(0xffffff, 1);

renderer.domElement.style.touchAction = 'none';

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

  // 画面のクリア色（白）を退避
  const savedColor = new THREE.Color();
  renderer.getClearColor(savedColor);
  const savedAlpha = renderer.getClearAlpha();

  // ★ シミュレーション用RTは「黒=インク無し」で初期化
  renderer.setClearColor(0x000000, 0.0);
  renderer.setRenderTarget(rtA);
  renderer.clear(true, true, true);
  renderer.setRenderTarget(rtB);
  renderer.clear(true, true, true);
  renderer.setRenderTarget(null);

  // 画面のクリア色（白）に戻す
  renderer.setClearColor(savedColor, savedAlpha);
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
    microAmp:   { value: 0.35 }, // ゆらぎ強さ（0.15〜0.6 推奨）
    microScale: { value: 3.1 },  // 空間スケール（非整数）
    microSpeed: { value: 0.23 }, // 時間変化
    diffusionJitterAmp:  { value: 0.3 }, // 拡散の揺らぎ強さ（±）
    diffusionJitterScale:{ value: 3.4  },
    diffusionJitterSpeed:{ value: 0.22 },
    kernelJitterAmp:   { value: 0.6 }, // サンプル位置の微小ジッタ（ピクセル単位で < 0.6 推奨）
    kernelJitterSpeed: { value: 1.3 },
    waterAmp:   { value: 0.5 }, // 外側の動きの強さ（0.15〜0.6）
    waterScale: { value: 2.85  }, // 空間スケール（非整数がオススメ）
    waterSpeed: { value: 0.22 }, // 時間変化

    // マスク用（どの円の外側か）
    ringInner:  { value: PARAMS.brushRadius }, // 内側＝静かにする半径
    ringWidth:  { value: PARAMS.brushRadius * 0.8 }, // 内→外の遷移幅
    centerPos:  { value: new THREE.Vector2(0.5, 0.5) }, // 円の中心（UV）
    // simMat の uniforms に追加（お好みで調整）
    shapeNoiseScale: { value: 1.8 },   // 乱れの空間スケール（非整数推奨）
    shapeNoiseSpeed: { value: 0.35 },  // 乱れの時間変化
    shapeAniso:      { value: 2.2 },   // 楕円の伸び率（1=等方, 2前後で程よい歪み）
    shapeMix:        { value: 0.001 },   // 等方:1.0 ←→ 楕円:0.0 のブレンド係数
    // 形状ノイズ（回転楕円ぼかし）
    shapeNoiseScale: { value: 3.2 }, // 非整数推奨
    shapeNoiseSpeed: { value: 0.25 },
    shapeAniso:      { value: 1.9 }, // 1=等方、>1で楕円
    shapeMix:        { value: 0.65 },// 0=楕円のみ, 1=等方のみ

    // 縁ギザギザ（エッジ方向オフセット）
    jagAmp:     { value: 0.6 },  // 強さ（0.6〜1.8）
    jagFreq:    { value: 6.0 },  // 周波数（6〜14）
    jagOctaves: { value: 3.0 },  // Fbmオクターブ数（2〜4）
    jagSpeed:   { value: 0.35 }, // 時間変化
    jagEdge:    { value: 8.0 },  // エッジ選択の鋭さ（大きいほど縁限定）
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
    gamma:    { value: 2.2 },
    bgColor:    { value: new THREE.Color(0xffffff) }, // 背景紙の色（白）
    inkDensity: { value: 1.3 }, 
    
  },
  depthTest: false,
  depthWrite:false
});
const paper = new THREE.Color(0xffffff);
const toVec3 = (c) => new THREE.Vector3(c.r, c.g, c.b);
composeMat.uniforms.colors0.value = paletteVec3[0] ?? toVec3(paper);
composeMat.uniforms.colors1.value = paletteVec3[1] ?? toVec3(paper);
composeMat.uniforms.colors2.value = paletteVec3[2] ?? toVec3(paper);
composeMat.uniforms.colors3.value = paletteVec3[3] ?? toVec3(paper);
composeMat.uniforms.exposure.value = 1.0;
composeMat.uniforms.gamma.value    = 2.2;

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

// --- UIトグル：注入の有効/無効 ---
let uiInjectionEnabled = true;

const injectBtn = document.getElementById('injectToggle');
function updateInjectBtn(){
  if (!injectBtn) return;
  injectBtn.textContent = uiInjectionEnabled ? 'color : ON' : 'color : OFF';
  injectBtn.setAttribute('aria-pressed', uiInjectionEnabled ? 'true' : 'false');
  injectBtn.classList.toggle('off', !uiInjectionEnabled);
}
if (injectBtn){
  injectBtn.addEventListener('click', () => {
    uiInjectionEnabled = !uiInjectionEnabled;
    if (!uiInjectionEnabled) {
      // UIでOFFにした瞬間に注入停止
      injecting = false;
    }
    updateInjectBtn();
  });
  updateInjectBtn();
}


// --- 追加：状態フラグと開始関数 ---
let isOver = false;

function startInjection() {
  if (!uiInjectionEnabled) return; 
  // その場からにじみを始める
  pickNextColor();
  injecting = true;
  // 中心と内側半径を記録（“外側ゆらぎ”やマスクに使用している場合）
  simMat.uniforms.centerPos.value.copy(mouseNDC);
  simMat.uniforms.ringInner.value = simMat.uniforms.injectRadius.value;
}

// --- 置き換え：イベント ---
function handleMove(evt) {
  const rect = renderer.domElement.getBoundingClientRect();
  const uv = screenToUV(evt);
  mouseNDC.set(uv.x, uv.y);

  // マウスが乗っていて、まだ注入していなければ即開始
  if (isOver && !injecting) {
    startInjection();
  }
}

function handleEnter(evt) {
  isOver = true;
  handleMove(evt);   // 位置を先に更新
  startInjection();  // 乗った瞬間に注入開始
}

function handleLeave() {
  isOver = false;
  injecting = false;     // 画面外で停止
  mouseNDC.set(-10, -10);
}

// 既存のリスナー登録はそのまま/またはこれに準拠
//renderer.domElement.addEventListener('mousemove',  handleMove);
//renderer.domElement.addEventListener('mouseenter', handleEnter);
//renderer.domElement.addEventListener('mouseleave', handleLeave);
const HAS_HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
if (HAS_HOVER) {
  renderer.domElement.addEventListener('mousemove',  handleMove);
  renderer.domElement.addEventListener('mouseenter', handleEnter);
  renderer.domElement.addEventListener('mouseleave', handleLeave);
}

function pickNextColor() {
  currentColorIndex = (currentColorIndex + 1) % PALETTE.length;
}

function screenToUV(evt) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = (evt.clientX - rect.left) / rect.width;
  const y = (evt.clientY - rect.top)  / rect.height;
  return new THREE.Vector2(x, 1 - y); // UV は下原点
}

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
let centerTarget = new THREE.Vector2(0.5, 0.5);
let injectionStartTime = 0;

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
      // 円の“初期中心”をその場に固定（にじみはここから始まる）
      simMat.uniforms.centerPos.value.copy(mouseNDC);

      // 後追いで向かうターゲットは常に最新マウス
      centerTarget.copy(mouseNDC);

      // 遅延の基準時刻
      injectionStartTime = t;

      // 内側半径も合わせたい場合
      simMat.uniforms.ringInner.value = simMat.uniforms.injectRadius.value;
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

  updateFromClientXY(e.clientX, e.clientY);

  // ← ここがポイント：押した瞬間から注入開始（UIがONのとき）
  if (uiInjectionEnabled) {
    pickNextColor();
    injecting = true;
    simMat.uniforms.centerPos.value.copy(mouseNDC);
    simMat.uniforms.ringInner.value = simMat.uniforms.injectRadius.value;
    centerTarget.copy(mouseNDC);
    injectionStartTime = performance.now(); // 追従の遅延用
  }

  if (renderer.domElement.setPointerCapture) {
    renderer.domElement.setPointerCapture(pointerId);
  }
}

/*
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
*/
function onPointerMove(e){
  if (pointerId !== e.pointerId) return;
  updateFromClientXY(e.clientX, e.clientY);
  centerTarget.copy(mouseNDC); // ← 円の“行き先”だけ更新（実際に動かすのは後述のフレームで）
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

let prevTime = performance.now() * 0.001;

function frame() {
  const nowMs = performance.now();
  const now   = nowMs * 0.001;
  const dt    = Math.max(0.0, now - prevTime);
  prevTime = now;

  // ---- 停止判定 ----
  const stopped = isOver
    ? (nowMs - lastMoveTime) > PARAMS.stationaryMs
    : true; // 画面外なら「停止扱い」

  // ---- 目標 decay を決める ----
  const targetDecay = stopped ? PARAMS.decayWhileStop : PARAMS.decayWhileMove;

  // ---- 現在の decay を滑らかに目標へ（指数補間）----
  const tau = Math.max(1e-3, PARAMS.decayEaseTau);
  const alpha = 1.0 - Math.exp(-dt / tau);
  simMat.uniforms.decay.value =
    THREE.MathUtils.lerp(simMat.uniforms.decay.value, targetDecay, alpha);

  // 追従開始の条件：遅延時間を過ぎた／押下中に追うかどうか
  const passedDelay = (nowMs - injectionStartTime) >= PARAMS.followDelayMs;
  const canFollow   = passedDelay && (PARAMS.followWhenDown || !isPointerDown);

  if (canFollow) {
    // 時定数 followTau の指数補間。alpha = 1 - exp(-dt/tau)
    const tau  = Math.max(1e-3, PARAMS.followTau);
    const alpha = 1.0 - Math.exp(-dt / tau);

    // centerPos をターゲットへ少しだけ近づける
    const cp = simMat.uniforms.centerPos.value;
    cp.lerp(centerTarget, alpha);
  }

  // 既存の time 更新など
  simMat.uniforms.time.value = now;

  // 既存の注入/描画フロー…
  // renderer.setRenderTarget(rtB); renderer.render(...); など
    // 押下時間に比例して成長（クランプあり）
  const radiusScale   = Math.min(1 + PARAMS.holdGrowRadiusPerSec   * holdElapsedSec,   PARAMS.holdMaxRadiusScale);
  const strengthScale = Math.min(1 + PARAMS.holdGrowStrengthPerSec * holdElapsedSec,   PARAMS.holdMaxStrengthScale);

  // シェーダへ反映
  simMat.uniforms.injectRadius.value   = baseRadius   * radiusScale;
  simMat.uniforms.injectStrength.value = baseStrength * strengthScale;

  // 既存：注入フラグやマウス座標など
  simMat.uniforms.prevTex.value = rtA.texture;

  const injectingNow = injecting && uiInjectionEnabled;
  simMat.uniforms.injecting.value = injectingNow ? 1.0 : 0.0;
  //simMat.uniforms.injecting.value = injecting ? 1.0 : 0.0;
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