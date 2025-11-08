import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PMREMGenerator } from 'three';

const container = document.getElementById("canvas-container");

// ===== 基本セットアップ =====
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true, // ★ これで toDataURL 可能に
  // alpha: true,              // 透過PNGが欲しいなら有効化＋scene.background=null
});

renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfafafa);

const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.001).texture;
/*
// 環境ファイルの読み込み
new RGBELoader().load('/hdr/room.hdr', (hdr) => {
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  scene.environment = envMap;   // 重要（反射用）
  // scene.background = envMap; // 背景もHDRにしたい場合だけ
  hdr.dispose();
});
*/

const camera = new THREE.PerspectiveCamera(
  50,
  container.clientWidth / container.clientHeight,
  0.1,
  200
);
camera.position.set(3, 5, 5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ライト
scene.add(new THREE.HemisphereLight(0xffffff, 0xded7cc, 0.8));

const dir = new THREE.DirectionalLight(0xffffff, 2.0);
dir.position.set(5, 10, 8);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.radius = 4;
scene.add(dir);

scene.add(new THREE.AmbientLight(0xffffff, 0.25));

// グリッド & 地面
scene.add(new THREE.GridHelper(50, 50, 0x999999, 0xaaaaaa));
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// === モバイル判定（768px以下をモバイル扱い） ===
const mqMobile = window.matchMedia("(max-width: 768px)");
function isMobile(){ return mqMobile.matches; }

// 直近でカメラ合わせしたルートを保持（ターゲット用）
let _fitRoot = null;

// === カメラ切替 ===
// root を渡すとその中心を target にします
// 進行中のTweenを止める
let _camTweenReq = null;
function cancelCamTween(){
  if (_camTweenReq) {
    cancelAnimationFrame(_camTweenReq);
    _camTweenReq = null;
  }
}

// controls操作でTweenを止める（ドラッグ/ホイールなど）
controls.addEventListener('start', cancelCamTween);
window.addEventListener('wheel', cancelCamTween, { passive: true });

function setCameraSimple(root = null, { smooth = true } = {}) {
  if (root) _fitRoot = root;

  // ターゲットはルート中心（なければ原点）
  const target = (() => {
    if (!_fitRoot) return new THREE.Vector3(0,0,0);
    const b = new THREE.Box3().setFromObject(_fitRoot);
    return b.getCenter(new THREE.Vector3());
  })();

  // プリセット
  const desktopPos = new THREE.Vector3(8, 6, 8);
  const mobilePos  = new THREE.Vector3(15, 6, 13);
  const destPos    = isMobile() ? mobilePos : desktopPos;

  // smooth の解釈:
  //  - false          : 即座に移動
  //  - number         : その値(ms)の線形Tween
  //  - {ms, easing, damping, snap} のオプション
  if (!smooth) {
    cancelCamTween();
    camera.position.copy(destPos);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
    return;
  }

  // デフォルトは「短めの線形＋ダンピング無効化＋最後スナップ」
  const opts = (typeof smooth === 'object')
    ? smooth
    : { ms: (typeof smooth === 'number' ? smooth : 200), easing: 'linear', damping: false, snap: true };

  tweenCam(destPos, target, opts);
}

// なめらか移動（調整版）
function tweenCam(destPos, destTarget, {
  ms = 200,
  easing = 'linear',     // 'linear' | 'easeOutQuad' | 'easeInOutQuad'
  damping = false,       // Tween中にOrbitControlsのダンピングを無効化するか
  snap = true            // 終了時に最終値を強制セットして「ピタッ」と止める
} = {}) {
  cancelCamTween();

  const p0 = camera.position.clone();
  const t0 = controls.target.clone();

  // イージング関数
  const eases = {
    linear: x => x,
    easeOutQuad: x => 1 - (1 - x) * (1 - x),
    easeInOutQuad: x => (x < 0.5 ? 2*x*x : 1 - Math.pow(-2*x+2, 2)/2),
  };
  const ease = eases[easing] || eases.linear;

  // ダンピングを一時的にOFF
  const prevDampingEnabled = controls.enableDamping;
  const prevDampingFactor  = controls.dampingFactor;
  if (damping === false) {
    controls.enableDamping = false;
  }

  const tStart = performance.now();
  (function step(now){
    const k = Math.min((now - tStart) / ms, 1);
    const e = ease(k);

    camera.position.lerpVectors(p0, destPos, e);
    controls.target.lerpVectors(t0, destTarget, e);
    controls.update();

    if (k < 1) {
      _camTweenReq = requestAnimationFrame(step);
    } else {
      _camTweenReq = null;

      // 終了時の「ピタッ」補正
      if (snap) {
        camera.position.copy(destPos);
        controls.target.copy(destTarget);
        camera.lookAt(destTarget);
        controls.update();
      }
      // ダンピング復帰
      controls.enableDamping = prevDampingEnabled;
      controls.dampingFactor = prevDampingFactor;
    }
  })(performance.now());
}


// ===== GLB ロード =====
const loader = new GLTFLoader();

let modelGroup = null;     // 読み込んだモデルをまとめる親
let groups = [];           // THREE.Group の配列
let selected = null;       // 現在の選択（Group）
let groupRoot = null;      // 全グループの親
let pickMeshes = [];                 // ← クリックで拾う対象（Mesh配列）
const groupKeyToGroup = new Map();   // ← "key" → THREE.Group の参照

// === 手動グループ定義（大小無視 / ワイルドカード * / 正規表現OK） ===
// 子キー一覧を返す（親 → 子）
function childrenKeysOf(parentKey){
  return Object.entries(GROUP_PARENT)
    .filter(([, parent]) => parent === parentKey)
    .map(([child]) => child);
}

// グループと“その子グループ”の可視を再帰的に切り替え
function setGroupVisibilityRecursive(key, visible){
  const g = groupKeyToGroup.get(key);
  if (!g) return;

  // グループ自体
  g.visible = !!visible;

  // 中身(メッシュや中間ノード)にも反映したい場合は以下も有効に
  g.traverse(o => { if (o !== g) o.visible = !!visible; });

  // 子グループへ伝播
  for (const childKey of childrenKeysOf(key)){
    setGroupVisibilityRecursive(childKey, visible);
  }
}

// （念のため）チェックボックスのON/OFFをDOMに同期
function syncVisUIChecks(){
  groupKeyToVisRow.forEach((row, key) => {
    const g = groupKeyToGroup.get(key);
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = !!(g && g.visible);
  });
}

// 親子関係の親
const GROUP_PARENT = {
  right_wall_optional: 'right_wall',
  unit_bath_wall: 'unit_bath',
  front_wall_optional: 'front_wall'
};

const MANUAL_GROUPS = {
    // ★新規：右壁のオプションだけ別枠にしたい場合
  right_wall_optional: [
    "wall_r_window_frame",
    "wall_r_window_l",
    "wall_r_window_r"
  ],

  front_wall_optional: [
     "Cube017", "Cube017_1", "Cube017_2"
  ],

  ceiling: [
    "skeleton_top", 
    "wall_top", 
    "interior_wall_ceiling", 
    "frame_top", 
    
  ],

  front_wall: [
    "wall_front", 
    "skeleton_front",
    "interior_wall_front",
  ],

  left_wall: [
    "left_wall", 
    "skeleton_l", 
    "wall_l", 
    "interior_wall_l", 
    ],

  right_wall: [
    "right_wall", 
    "skeleton_r", 
    "wall_r",
    "interior_wall_r", 
    ],

  back_wall: [
    "skeleton_back", 
    "wall_back", 
    "interior_wall_back"
  ],

  sink: [
    "Cube078","Cube078_1","Cube078_2","Cube078_3","Cube078_4","Cube078_5","Cube078_6", //"sink"
  ],

  air_conditioner: [
    "Cube107", "Cube107_1", "Cube107_2", "Cube107_3", //"ac_unit"
  ],

  fan: [
    "Cylinder011","Cylinder011_1", //"fan_blade",
    "Cylinder013", "Cylinder013_1", //"fan", 
    "Cylinder016", "Cylinder016_1", //"fan_switch",
  ],

  unit_bath: [
    "ub_toilet_seat", 
    "ub_toilet_cover", 
    "Cube064","Cube064_1","Cube064_2","Cube064_3", //"unitbath"
  ],

  unit_bath_wall: [
    "unitbath_wrap", 
    "Cube053", "Cube053_1", ///"ub_door"
  ],

  loft: [
    "Cube061", "Cube061_1", // "ladder"
    "Cube058", "Cube058_1" // "loft_floor"
  ],

  // ★新規：初期は非表示にしたい部品群（例）
  optional_hidden: ["bed_frame"], // ワイルドカード可
};

// falseで初期状態は非表示
const GROUP_DEFAULT_VISIBILITY = {
  ceiling: true,
  front_wall: true,
  left_wall: true,
  right_wall: true,
  back_wall: true,
  sink: true,
  air_conditioner: true,
  unit_bath: true,
  unit_bath_wall: true,
  loft: true,
  optional_hidden: false,          
  right_wall_optional: true,
  front_wall_optional: true
};

// 追加：クリック選択を無効化したいグループキー
const NON_PICKABLE_GROUP_KEYS = new Set([
  'unit_bath_wall',
  'right_wall_optional',
  'front_wall_optional', 
]); 

// ========== デバッグ出力用 ==========
// メッシュ配列を {id, name} の配列に整形
function _asRows(meshes){
  return meshes.map(m => ({ id: m.id, name: m.name || `(id:${m.id})` }));
}

// グループ割当の結果を出力
function logGroupingResult({ assignedByGroup, unassigned }){
  console.groupCollapsed('%c[Grouping] 割当結果', 'color:#8cf');
  // 各グループごとの割当一覧
  assignedByGroup.forEach((arr, key) => {
    console.groupCollapsed(`%c${key} (${arr.length})`, 'color:#5fa');
    console.table(_asRows(arr));
    console.groupEnd();
  });

  // 未割当
  if (unassigned.length){
    console.warn(`[未割当 ${unassigned.length}]`);
    console.table(_asRows(unassigned));
  } else {
    console.log('%c未割当なし', 'color:#5fa');
  }

  // 空グループ（DOMには出さない運用でも把握したい時用）
  const empties = [...groupKeyToGroup.keys()].filter(k => {
    const g = groupKeyToGroup.get(k);
    return g && g.children.length === 0;
  });
  if (empties.length){
    console.info('[空グループ]', empties);
  }
  console.groupEnd();
}

// 名前マッチ（手動割当て用）
function selectorMatches(name, selector) {
  const n = String(name || "");
  if (selector instanceof RegExp) return selector.test(n);
  if (typeof selector === "string") {
    const s = selector.toLowerCase();
    const m = n.toLowerCase();
    if (s.includes("*")) {
      const esc = s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp("^" + esc + "$", "i").test(n);
    }
    return m === s;
  }
  return false;
}

// 選択の可視化
const selectionBox = new THREE.BoxHelper();
selectionBox.visible = false;
scene.add(selectionBox);

// TransformControls（※選択中グループにのみ attach します）
const tctrl = new TransformControls(camera, renderer.domElement);
tctrl.setSize(0.9);
tctrl.addEventListener("dragging-changed", (e) => {
  controls.enabled = !e.value; // ドラッグ中はオービット停止
});
scene.add(tctrl);

// ===== UI =====
const $ = (id) => document.getElementById(id);
const $groupSelect    = $("group-select");
const $groupVisList   = $("group-vis-list");
const $color          = $("color-input");
const $tex            = $("tex-input");
const $rotL           = $("rot-left");
const $rotR           = $("rot-right");
const $modeTranslate  = $("mode-translate");
const $modeRotate     = $("mode-rotate");
const $modeScale      = $("mode-scale");
const $snapMove       = $("snap-move");
const $snapRot        = $("snap-rot");
const $snapOff        = $("snap-off");
const $semiOn         = $("semi-on");
const $semiOff        = $("semi-off");
const $pulse          = $("pulse");
const $resetXform     = $("reset-transform");
const $resetSelOnly   = $("reset-selected-only");
const $resetMat       = $("reset-material");
const $clearTex       = $("clear-tex");
const $showAllGroups  = $("show-all-groups");
const $resetAll       = $("reset-all");
const $capturePng     = $("capture-png");

// ★ クリック選択は廃止 → レイキャストイベントを登録しない
// （TransformControls は選択中のグループにだけ効く）

// リサイズ
addEventListener("resize", () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
  setCameraSimple(); // 直近の _fitRoot を使って再配置
});

mqMobile.addEventListener?.("change", () => setCameraSimple());
addEventListener("orientationchange", () => setCameraSimple());


// モデルセット
function setModel(sceneRoot) {
  // 既存撤去
  if (modelGroup) {
    scene.remove(modelGroup);
    modelGroup.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose?.();
    });
  }
  modelGroup = new THREE.Group();
  modelGroup.name = "LoadedModel";
  scene.add(modelGroup);

  // 初期化 & キャッシュ
  sceneRoot.position.set(0, 0, 0);
  sceneRoot.rotation.set(0, 0, 0);
  sceneRoot.scale.set(1, 1, 1);

  sceneRoot.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      cacheOriginal(o);
    } else if (o.isObject3D) {
      cacheOriginal(o);
    }
  });

  modelGroup.add(sceneRoot);

  // グルーピング（手動）
  buildGroupsManual(sceneRoot);
  populateGroupSelect();
  populateGroupVisibilityUI();

  setCameraSimple(sceneRoot, { smooth: false });
  setCameraSimple(modelGroup, { smooth: false });
  //setCameraSimple(modelGroup, { smooth: 120 });
  //setCameraSimple(modelGroup, { smooth: { ms: 180, easing: 'linear', damping: false, snap: true }});

  // 初期は未選択にしておく（選んだときだけギズモ表示）
  clearSelection();
}

// 手動グループ化
function buildGroupsManual(root) {
  if (groupRoot) modelGroup.remove(groupRoot);

  groupRoot = new THREE.Group();
  groupRoot.name = "Groups";
  modelGroup.add(groupRoot);

  groups = [];
  const nameToGroup = new Map();
  groupKeyToGroup.clear();

  // 空グループを作る
  Object.keys(MANUAL_GROUPS).forEach((key) => {
    const g = new THREE.Group();
    g.name = `grp:${key}`;
    cacheOriginal(g);
    groupRoot.add(g);
    g.visible = (key in GROUP_DEFAULT_VISIBILITY) ? !!GROUP_DEFAULT_VISIBILITY[key] : true;
    nameToGroup.set(key, g);
    groups.push(g);
    groupKeyToGroup.set(key, g);
  });

   // ② 親子関係で付け替え（ワールド座標は維持）
  Object.entries(GROUP_PARENT).forEach(([childKey, parentKey]) => {
    const child  = nameToGroup.get(childKey);
    const parent = nameToGroup.get(parentKey);
    if (child && parent && child.parent !== parent) {
      reparentKeepWorld(child, parent);
    }
  });

  // 全メッシュ収集
  const allMeshes = [];
  root.traverse((o) => {
    if (o.isMesh) allMeshes.push(o);
  });

  // 割当
  const assigned = new Set();
  const assignedByGroup = new Map();  // 追加: 集計用 groupKey -> Mesh[]
  for (const [key, selectors] of Object.entries(MANUAL_GROUPS)) {
    const g = nameToGroup.get(key);
    for (const mesh of allMeshes) {
      if (assigned.has(mesh)) continue;
      if (!mesh.name) continue;
      if (selectors.some((sel) => selectorMatches(mesh.name, sel))) {
        reparentKeepWorld(mesh, g);
        mesh.userData._groupKey = key;
        assigned.add(mesh);

        // ▼ 追加: グループ別リスト
        if (!assignedByGroup.has(key)) assignedByGroup.set(key, []);
        assignedByGroup.get(key).push(mesh);
      }
    }
  }
  // ▼ 追加: 未割当の抽出 & ログ
  const unassigned = allMeshes.filter(m => !assigned.has(m));
  logGroupingResult({ assignedByGroup, unassigned });

  refreshPickTargets();
  prebindAllPivots();  // ★ 追加：親→子で全ピボットを一度だけ固定
}

// 親替えしてもワールド座標維持
function reparentKeepWorld(child, newParent) {
  if (!child || !newParent || child.parent === newParent) return;
  child.updateMatrixWorld(true);
  newParent.updateMatrixWorld(true);

  const world = child.matrixWorld.clone();
  newParent.add(child);
  const inv = new THREE.Matrix4().copy(newParent.matrixWorld).invert();
  child.matrix.copy(inv.multiply(world));
  child.matrix.decompose(child.position, child.quaternion, child.scale);
}

const groupKeyToVisRow = new Map();

function updateVisUISelection(activeKey){
  groupKeyToVisRow.forEach(el => el.classList.remove('selected'));
  if (activeKey && groupKeyToVisRow.has(activeKey)) {
    groupKeyToVisRow.get(activeKey).classList.add('selected');
  }
}

// UI: グループ選択
function populateGroupSelect() {
  $groupSelect.innerHTML = `<option value="">（なし / パーツ単位で操作）</option>`;
  buildGroupOrder().forEach(({key, depth}) => {
    const g = groupKeyToGroup.get(key);
    if (!g || g.children.length === 0) return;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${'　'.repeat(depth)}${groupLabel(key)}`; // 全角spaceで簡易インデント
    $groupSelect.appendChild(opt);
  });
}

function groupLabel(key) {
  const jp = {
    ceiling: "天井",
    front_wall: "壁（ドア側）",
    front_wall_optional: "ドア",
    left_wall: "壁（左）",
    right_wall: "壁（窓側）",
    right_wall_optional: "窓",
    back_wall: "壁（後）",
    sink: "シンク",
    air_conditioner: "エアコン",
    unit_bath: "ユニットバス",
    unit_bath_wall: "壁（ユニットバス）",
    fan: "換気扇",
    loft: "ロフト",
    optional_hidden: "ベッド",
  };
  return jp[key] || key;
}

// 親→子の順でキーを返すユーティリティ（既に buildGroupOrder があるなら流用可）
function listKeysRootFirst(){
  const out = [];
  const seen = new Set();
  const walk = (k) => {
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
    childrenKeysOf(k).forEach(walk);
  };
  [...groupKeyToGroup.keys()].filter(k => !parentKeyOf(k)).forEach(walk);
  return out;
}

// すべてのグループにピボットを“最初の一回だけ”割り当て
function prebindAllPivots(){
  listKeysRootFirst().forEach(key => {
    installPivotForGroup(key, { align:'local', rebind:true });
  });
}


$groupSelect.addEventListener("change", () => {
  const key = $groupSelect.value;
  if (!key) { clearSelection(); return; }
  const g = groups.find((gr) => gr.name === `grp:${key}`);
  if (g) selectGroup(g);
  updateVisUICardSelection(key);
});

const OUTLINE_CONF = {
  color: 0xffcc00,   // 線色
  threshold: 50,     // エッジ抽出の角度しきい（大きいほど線が増える）
  opacity: 1.0,      // 透明度
  alwaysOnTop: false // 常に手前に表示する（falseで通常の深度判定）
};

function clearEdgesOutline() {
  if (!modelGroup) return;
  modelGroup.traverse(o => {
    if (o.userData && o.userData._outlineEdge) {
      // 生成した補助オブジェクトを掃除
      o.parent && o.parent.remove(o);
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    }
  });
}

function highlightGroupEdges(group) {
  clearEdgesOutline();
  if (!group) return;

  group.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;

    // メッシュのローカル座標系でアウトラインを子として付与（変形に追従）
    const egeo = new THREE.EdgesGeometry(obj.geometry, OUTLINE_CONF.threshold);
    const mat  = new THREE.LineBasicMaterial({
      color: OUTLINE_CONF.color,
      transparent: OUTLINE_CONF.opacity < 1,
      opacity: OUTLINE_CONF.opacity,
      depthTest: !OUTLINE_CONF.alwaysOnTop, // true=奥で隠れる / false=常に手前
      depthWrite: false
    });
    const edge = new THREE.LineSegments(egeo, mat);
    edge.renderOrder = 999;               // 前面に
    edge.frustumCulled = false;           // 稀に欠けるのを防止
    edge.userData._outlineEdge = true;    // 掃除用マーク
    obj.add(edge);                        // 子に付けて追従させる
  });
}

function parentKeyOf(key){ return GROUP_PARENT[key] || null; }
if (typeof window !== 'undefined') window.groupKeyToGroup = groupKeyToGroup;

// 1行のDOM（チェック＋ラベル）を作る。depth>0 は子とみなす
function createVisRow(key, depth){
  const g = groupKeyToGroup.get(key);
  if (!g || g.children.length === 0) return null; // 空は出さない場合

  const wrap = document.createElement('label');
  wrap.className = 'checkbox vis-row' + (depth ? ' child' : '');
  wrap.dataset.key = key;
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '6px';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = `vis-${key}`;
  cb.checked = g.visible;
  cb.addEventListener('change', () => {
    setGroupVisibilityRecursive(key, cb.checked); // 親→子へ伝播
    syncVisUIChecks();
    if (!g.visible && selected === g) {
      clearSelection(); $groupSelect.value = ""; updateVisUISelection?.(null);
    }
    refreshPickTargets();
  });

  const lbl = document.createElement('span');
  lbl.textContent = groupLabel(key);

  wrap.appendChild(cb);
  wrap.appendChild(lbl);

  groupKeyToVisRow.set(key, wrap);
  if (selected && selected.name === `grp:${key}`) wrap.classList.add('selected');
  return wrap;
}

// 親カード内に、親→子（再帰）で縦積みする
function appendParentAndChildren(container, key, depth=0, onRegister){
  const row = createVisRow(key, depth);
  if (row) container.appendChild(row);
  if (onRegister) onRegister(key);
  const children = childrenKeysOf(key);
  children.forEach(ck => appendParentAndChildren(container, ck, depth+1, onRegister));
}

// 親を持たない“根”グループのキー一覧（＝親カードの並び順）
function rootGroupKeys(){
  const keys = [...groupKeyToGroup.keys()];
  return keys.filter(k => !parentKeyOf(k));
}

const groupKeyToVisCard = new Map();

function populateGroupVisibilityUI(){
  $groupVisList.innerHTML = "";
  groupKeyToVisRow.clear();
  groupKeyToVisCard.clear();

  // 親ごとにカードを作成（このカードが2列グリッドの1セルになる）
  rootGroupKeys().forEach(rootKey => {
    const g = groupKeyToGroup.get(rootKey);
    if (!g || g.children.length === 0) return; // 空はスキップ（必要なら外す）

    const card = document.createElement('div');
    card.className = 'vis-group';

    //appendParentAndChildren(card, rootKey, 0);

    $groupVisList.appendChild(card);

    const registerCardForKey = (k) => groupKeyToVisCard.set(k, card);
    appendParentAndChildren(card, rootKey, 0, registerCardForKey);

    if (selected && selected.name === `grp:${rootKey}`) {
      card.classList.add('selected');
      updateVisUICardSelection(selectedGroupKey());
    }
  });
}

function buildGroupOrder(){
  const keys  = [...groupKeyToGroup.keys()];
  const roots = keys.filter(k => !parentKeyOf(k));
  const out = [];
  const walk = (k, depth) => {
    out.push({ key:k, depth });
    childrenKeysOf(k).forEach(ch => keys.includes(ch) && walk(ch, depth+1));
  };
  roots.forEach(k => walk(k, 0));
  return out;
}


function selectGroup(group) {
  selected = group;
  const key = group.name.replace(/^grp:/, "");
  const pivot = installPivotForGroup(key, { align: 'local', rebind: false });
  tctrl.attach(pivot);  // ★ ギズモは pivot に出す
  selectionBox.visible = false;
  highlightGroupEdges(selected);
  updateVisUISelection(key);   // ★ 強調
  updateVisUICardSelection(key);
}

function updateVisUICardSelection(selectedKey){
  // いったん全カードから selected を外す
  groupKeyToVisCard.forEach(card => card.classList.remove('selected'));
  if (!selectedKey) return;
  const card = groupKeyToVisCard.get(selectedKey);
  if (card) card.classList.add('selected');
}

// グループ選択時（既存の selectGroup 内など）：
updateVisUICardSelection(selectedGroupKey());

// セレクトボックス変更時：
$groupSelect.addEventListener('change', () => {
  const key = $groupSelect.value || null;
  updateVisUICardSelection(key);
});

function clearSelection() {
  selected = null;
  tctrl.detach();
  selectionBox.visible = false;
  clearEdgesOutline();
  updateVisUISelection(null);  // ★ 強調解除
  updateVisUICardSelection(null);
}

function isWorldVisible(obj){
  for (let p = obj; p; p = p.parent) {
    if (!p.visible) return false;
  }
  return true;
}

// === ピボット管理 ===
//const _tmpQuat = new THREE.Quaternion();
const ORIGINAL = new WeakMap();

/**
 * 現在の状態を基準として保存します。
 * - force:true で上書き保存（pivot 再バインド時など）
 */
function cacheOriginal(obj, { force = false } = {}) {
  if (!force && ORIGINAL.has(obj)) return;

  const entry = {};
  if (obj.isObject3D) {
    obj.updateMatrixWorld(true);
    entry.pos = obj.position.clone();
    entry.rot = new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z);
    entry.scl = obj.scale.clone();
  }
  if (obj.isMesh) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    entry.material = mats.map((m) => ({
      color: m?.color ? m.color.clone() : null,
      opacity: m?.opacity,
      transparent: m?.transparent,
      map: m?.map ?? null,
    }));
  }
  ORIGINAL.set(obj, entry);
}

// === pivot & 回転ユーティリティ ===
const pivotMap = new Map();
function getGroupByKey(k){ return groups.find(g => g.name === `grp:${k}`) || null; }
function getBBoxBottomCenter(obj){
  const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3());
  return new THREE.Vector3(c.x, b.min.y, c.z);
}

function installPivotForGroup(key, { worldPos, align='local', rebind=false } = {}){
  const grp = getGroupByKey(key); if (!grp) return null;

  let pivot = pivotMap.get(key);
  const parent = grp.parent ?? modelGroup;

  // 無ければ作成
  if (!pivot){
    pivot = new THREE.Object3D();
    pivot.name = `pivot:${key}`;
    reparentKeepWorld(pivot, parent);
    pivotMap.set(key, pivot);
  }

  // 既に pivot が親で、rebind=false なら何もしない（ズレ防止）
  if (!rebind && grp.parent === pivot) return pivot;

  // 初回 or 明示的rebind時にだけ “ピボットの姿勢” を決める
  if (rebind || !pivot.userData?.fixed) {
    // ★ ピボットの最終姿勢
    pivot.position.copy(worldPos || getBBoxBottomCenter(grp));
    if (align === 'local'){
      const q = new THREE.Quaternion();
      grp.getWorldQuaternion(q);
      pivot.quaternion.copy(q);
    } else {
      pivot.quaternion.identity();
    }
    // ★ このタイミングで基準保存（早すぎ/遅すぎ防止）
    cacheOriginal(pivot, {force:true});
    pivot.userData.fixed = true;
  }

  // グループを pivot 配下へ（世界座標維持）
  if (grp.parent !== pivot){
    reparentKeepWorld(grp, pivot);
  }

  // 基準は “初回または rebind 時” のみ更新（毎回上書きしない）
  if (rebind || !grp.userData?.pivotBound) {
    cacheOriginal(grp, {force:true});
    grp.userData.pivotBound = true;
  }

  return pivot;
}


function rotateGroupLocalY(key, deg){
  const pivot = pivotMap.get(key) || installPivotForGroup(key, { align:'local' }); // 未作成なら自動生成（底面中心）
  if (!pivot) return;
  pivot.rotateY(THREE.MathUtils.degToRad(deg));
}
function selectedGroupKey(){
  return (selected && typeof selected.name === 'string' && selected.name.startsWith('grp:'))
    ? selected.name.slice(4)
    : null;
}

$rotL.addEventListener("click", () => {
  const k = selectedGroupKey(); if (!k) return;
  rotateGroupLocalY(k, -90);
});
$rotR.addEventListener("click", () => {
  const k = selectedGroupKey(); if (!k) return;
  rotateGroupLocalY(k, +90);
});

// マテリアル（色/半透明/テクスチャ）…選択中グループ配下に適用
$color.addEventListener("input", () => {
  if (!selected) return;
  applyToMeshTree(selected, (mesh) => {
    ensureUniqueMaterial(mesh);
    const mats = toArray(mesh.material);
    mats.forEach((mat) => {
      if (mat.color) mat.color.set($color.value);
      mat.needsUpdate = true;
    });
  });
});

$semiOn.addEventListener("click", () => setSemi(true));
$semiOff.addEventListener("click", () => setSemi(false));

function setShadowsEnabled(root, enabled){
  applyToMeshTree(root, m => m.castShadow = !!enabled);
}

function setSemi(flag) {
  if (!selected) return;
  applyToMeshTree(selected, (mesh) => {
    ensureUniqueMaterial(mesh);
    const mats = toArray(mesh.material);
    mats.forEach((mat) => {
      cacheOriginal(mesh);
      mat.transparent = true;
      mat.opacity = flag ? 0.5 : (getOriginal(mesh)?.opacity ?? 1.0);
      mat.depthWrite = true;
      mat.needsUpdate = true;
    });
  });

  if (flag) {
    // 半透明ON → 影OFF（= 影が“薄く”なる体感）
    setShadowsEnabled(selected, false);
  } else {
    // 半透明OFF → 影ON
    setShadowsEnabled(selected, true);
  }
}

$tex.addEventListener("change", async (e) => {
  if (!selected) return;
  const file = e.target.files?.[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  const texture = await new THREE.TextureLoader().loadAsync(url).catch(() => null);
  URL.revokeObjectURL(url);
  if (!texture) { alert("テクスチャ読み込みに失敗しました。"); return; }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;

  applyToMeshTree(selected, (mesh) => {
    ensureUniqueMaterial(mesh);
    const mats = toArray(mesh.material);
    mats.forEach((mat) => {
      cacheOriginal(mesh);
      mat.map = texture;
      mat.needsUpdate = true;
    });
  });
});

$clearTex.addEventListener("click", () => {
  if (!selected) return;
  applyToMeshTree(selected, (mesh) => {
    ensureUniqueMaterial(mesh);
    const mats = toArray(mesh.material);
    mats.forEach((mat) => {
      cacheOriginal(mesh);
      mat.map = null;
      mat.needsUpdate = true;
    });
  });
});

// 簡易アニメ
/*
$pulse.addEventListener("click", () => {
  if (!selected) return;
  pulseScale(selected, 1.15, 220);
});
function pulseScale(obj, to = 1.1, ms = 180) {
  const orig = obj.scale.clone();
  const peak = orig.clone().multiplyScalar(to);
  const t0 = performance.now();
  const half = t0 + ms;
  const easeOutQuad = (x) => 1 - (1 - x) * (1 - x);

  function animate(t) {
    if (t <= half) {
      const k = (t - t0) / ms;
      obj.scale.lerpVectors(orig, peak, easeOutQuad(k));
      requestAnimationFrame(animate);
    } else {
      const t1 = t;
      const dur = ms * 1.2;
      const end = t1 + dur;
      const back = (tt) => {
        if (tt <= end) {
          const k = (tt - t1) / dur;
          obj.scale.lerpVectors(peak, orig, easeOutQuad(k));
          requestAnimationFrame(back);
        } else {
          obj.scale.copy(orig);
        }
      };
      requestAnimationFrame(back);
    }
  }
  requestAnimationFrame(animate);
}
*/

// リセット
/*
$resetXform.addEventListener("click", () => {
  if (!modelGroup) return;
  (selected ?? modelGroup).traverse((o) => {
    if (!o.isObject3D) return;
    const org = getOriginal(o);
    if (org?.pos && org?.rot && org?.scl) {
      o.position.copy(org.pos);
      o.rotation.set(org.rot.x, org.rot.y, org.rot.z);
      o.scale.copy(org.scl);
    }
  });
   // 選択中グループの pivot も戻す
    if (selected) {
      const k = selectedGroupKey();
      const p = k ? pivotMap.get(k) : null;
      if (p) {
        const po = getOriginal(p);
        if (po?.pos && po?.rot && po?.scl) {
          p.position.copy(po.pos);
          p.rotation.set(po.rot.x, po.rot.y, po.rot.z);
          p.scale.copy(po.scl);
        }
      }
    }
});
*/
$resetSelOnly.addEventListener("click", () => {
  if (!selected) return;
  const o = selected;
  const org = getOriginal(o);
  if (org?.pos && org?.rot && org?.scl) {
    o.position.copy(org.pos);
    o.rotation.set(org.rot.x, org.rot.y, org.rot.z);
    o.scale.copy(org.scl);
  }
   // ★ pivot 側も
  const k = selectedGroupKey();
  const p = k ? pivotMap.get(k) : null;
  if (p) {
    const po = getOriginal(p);
    if (po?.pos && po?.rot && po?.scl) {
      p.position.copy(po.pos);
      p.rotation.set(po.rot.x, po.rot.y, po.rot.z);
      p.scale.copy(po.scl);
    }
  }
});

$resetMat.addEventListener("click", () => {
  if (!modelGroup) return;
  (selected ?? modelGroup).traverse((o) => {
    if (!o.isMesh) return;
    const org = getOriginal(o);
    if (!org) return;
    ensureUniqueMaterial(o);
    const mats = toArray(o.material);
    mats.forEach((mat, i) => {
      if (org.material?.[i]) {
        const om = org.material[i];
        if (mat.color && om.color) mat.color.copy(om.color);
        mat.opacity = om.opacity ?? 1;
        mat.transparent = om.transparent ?? false;
        mat.map = om.map ?? null;
        mat.needsUpdate = true;
      }
    });
  });
});

// すべて表示
$showAllGroups.addEventListener("click", () => {
  groups.forEach((g) => {
      g.visible = true;
      g.traverse(o => { if (o.isObject3D) o.visible = true; }); // 子も全部 true
  });
  // チェックボックスも同期
  [...$groupVisList.querySelectorAll('input[type="checkbox"]')].forEach((cb) => {
    cb.checked = true;
  });
  refreshPickTargets(); 
});

// クリックで「全てリセット」
$resetAll.addEventListener("click", resetAll);

/* -----------------------------------------
 *  全てリセット：読み込み直後の状態へ戻す
 *  - 変形（位置/回転/スケール）
 *  - マテリアル（色/透明/テクスチャ）
 *  - グループの可視状態（既定値へ）
 *  - ピボット（pivot）の姿勢
 *  - 選択/UIの状態
 * ----------------------------------------*/
function resetAll(){
  if (!modelGroup) return;

  // 1) 選択解除 ＆ アウトライン・ギズモ停止
  clearSelection();

  // 2) 変形＆材質をすべて「基準スナップショット」に戻す
  modelGroup.traverse((o) => {
    const org = getOriginal(o);
    if (!org) return;

    // 2-1) 位置/回転/スケール（Object3D共通）
    if (o.isObject3D && org.pos && org.rot && org.scl){
      o.position.copy(org.pos);
      o.rotation.set(org.rot.x, org.rot.y, org.rot.z);
      o.scale.copy(org.scl);
    }

    // 2-2) マテリアル（Meshのみ）
    if (o.isMesh && org.material){
      ensureUniqueMaterial(o);
      const mats = toArray(o.material);
      mats.forEach((mat, i) => {
        const om = org.material[i];
        if (!om) return;
        if (mat.color && om.color) mat.color.copy(om.color);
        mat.opacity     = om.opacity ?? 1;
        mat.transparent = om.transparent ?? false;

        // 元のテクスチャへ（新規に読み込んだmapは破棄してリーク防止）
        if (mat.map && mat.map !== om.map) {
          mat.map.dispose?.();
        }
        mat.map = om.map ?? null;

        mat.needsUpdate = true;
      });

      // 初期運用に合わせる（必要なら）
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // 3) グループの可視を「既定値」に戻す
  //    GROUP_DEFAULT_VISIBILITY に指定があるものはそれに従い、無いものは true に。
  groupKeyToGroup.forEach((g, key) => {
    const want = (key in GROUP_DEFAULT_VISIBILITY) ? !!GROUP_DEFAULT_VISIBILITY[key] : true;
    setGroupVisibilityRecursive(key, want);
  });
  syncVisUIChecks();             // チェックボックス同期
  updateVisUICardSelection(null);
  updateVisUISelection(null);
  $groupSelect.value = "";

  // 4) ピッキング対象を再構築
  refreshPickTargets();

  // 5) （任意）カメラを当て直す：読み込み直後に寄せたいなら有効化
  // const root = modelGroup; // or groupRoot でもOK
  // fitCameraToObject(root, 1.2);
  if (selected){
    const k = selectedGroupKey();
    const p = k ? pivotMap.get(k) : null;
    if (p) resetTransformOf(p);       // ★ pivot を戻す
    resetTransformOf(selected);       // ★ group 自体も戻す
  }
}

$capturePng?.addEventListener('click', () => {
  captureAndSave({ scale: 1, filePrefix: 'shot' }); // scale=1 は画面そのまま解像度
});

/**
 * 画面を撮影してPNG保存
 * @param {object} opts
 * @param {number} opts.scale  1=現在の解像度、そのまま。2=2倍解像度で撮影
 * @param {string} opts.filePrefix  ファイル名の先頭
 */
function captureAndSave({ scale = 1, filePrefix = 'shot' } = {}) {
  // 高解像度撮影（アンチエイリアス強化）にしたい場合は scale=2 など
  const canvas = renderer.domElement;

  // 現在のサイズ/ピクセル比を退避
  const oldSize = new THREE.Vector2();
  renderer.getSize(oldSize);
  const oldPixelRatio = renderer.getPixelRatio();

  if (scale !== 1) {
    // 一時的に解像度を上げて描画
    renderer.setPixelRatio(oldPixelRatio * scale);
    renderer.setSize(oldSize.x, oldSize.y, false);
    renderer.render(scene, camera);
  } else {
    // ループ中でも直前フレームを確実に掴む
    renderer.render(scene, camera);
  }

  // PNGデータ化
  const dataUrl = canvas.toDataURL('image/png');

  // 元のサイズに戻す
  if (scale !== 1) {
    renderer.setPixelRatio(oldPixelRatio);
    renderer.setSize(oldSize.x, oldSize.y, false);
  }

  // ダウンロード
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${filePrefix}_${stamp}.png`;
  downloadDataURL(dataUrl, filename);
}

// DataURL を保存（Safari でも動くフォールバック付き）
function downloadDataURL(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // 一部環境のフォールバック
  if (!/download/i.test('download' in HTMLAnchorElement.prototype ? 'download' : '')) {
    window.open(dataUrl, '_blank');
  }
}

// ========== クリック選択 ==========
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function refreshPickTargets() {
  pickMeshes = [];
  if (!modelGroup) return;
  modelGroup.traverse(o => {
    if (!o.isMesh) return;
    const key = o.userData?._groupKey;
    // ここで除外（例：unit_bath_wall はクリック不可）
    if (key && NON_PICKABLE_GROUP_KEYS.has(key)) return;
    pickMeshes.push(o);
  });
}

function setPointerFromEvent(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
}

function findGroupForObject(obj) {
  // 1) userData に _groupKey があれば最速
  const key = obj.userData?._groupKey;
  if (key && groupKeyToGroup.has(key)) return groupKeyToGroup.get(key);

  // 2) 親を辿って grp:* を探す
  let p = obj.parent;
  while (p) {
    if (typeof p.name === "string" && p.name.startsWith("grp:")) return p;
    p = p.parent;
  }
  return null;
}

function onCanvasPointerDown(ev) {
  if (tctrl.dragging || ev.button !== 0) return;

  setPointerFromEvent(ev);
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(pickMeshes, true);

  // 可視なものだけを選択候補に
  const hit = hits.find(h => isWorldVisible(h.object));
  if (!hit) { clearSelection(); $groupSelect.value = ""; return; }

  const grp = findGroupForObject(hit.object);

  // グループ自体が非表示なら選択解除
  if (!grp || !isWorldVisible(grp)) {
    clearSelection(); $groupSelect.value = ""; return;
  }

  if (selected === grp) { // 同じグループを再クリック → 解除
    clearSelection(); $groupSelect.value = ""; return;
  }

  selectGroup(grp);
  const key = grp.name.replace(/^grp:/, "");
  $groupSelect.value = key;                 // プルダウン表示を同期
  updateVisUICardSelection(key);  
}

// ★ 登録（初期化のどこかで一度だけ）
renderer.domElement.addEventListener("pointerdown", onCanvasPointerDown);


// ===== 補助 =====
function fitCameraToObject(object3D, pad = 1.2) {
  const box = new THREE.Box3().setFromObject(object3D);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let dist = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
  dist *= pad;

  camera.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist);
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
}

function ensureUniqueMaterial(mesh) {
  if (!mesh.isMesh) return;
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((m) => cloneOnce(m));
  } else {
    mesh.material = cloneOnce(mesh.material);
  }
}
function cloneOnce(mat) {
  if (!mat || mat.userData?._cloned) return mat;
  const c = mat.clone();
  c.userData = { ...(c.userData || {}), _cloned: true };
  return c;
}
function toArray(x) {
  return Array.isArray(x) ? x : [x];
}

/** 保存しておいた基準を取り出します（無ければ null） */
function getOriginal(obj) {
  return ORIGINAL.get(obj) ?? null;
}


// 指定オブジェクト配下の Mesh に処理
function applyToMeshTree(root, fn) {
  if (!root || typeof root.traverse !== "function" || typeof fn !== "function") return;
  root.traverse((o) => {
    if (o.isMesh) fn(o);
  });
}

(function responsiveSelect(){
  const BREAKPOINT = 768; // px
  const sel = document.getElementById('group-select');
  if (!sel) return;

  const mql = window.matchMedia(`(max-width:${BREAKPOINT}px)`);

  const apply = () => {
    if (mql.matches) {
      // モバイル → リストボックス（単一選択のまま）
      const lines = Math.min(8, sel.options.length); // 表示行数（調整可）
      sel.setAttribute('size', String(lines));
    } else {
      // PC → 通常ドロップダウン
      sel.removeAttribute('size');
    }
  };

  apply();
  // ブレークポイント交差や向き変更にも追従
  if (mql.addEventListener) mql.addEventListener('change', apply);
  else mql.addListener(apply); // 旧Safari対策
  window.addEventListener('orientationchange', apply);
})();

// ===== ループ =====
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// 起動時オートロード（HTTP配信で開いてください）
//loader.load("./sh-apply-color.glb", (gltf) => setModel(gltf.scene));

function dumpGLTFNames(gltf) {
  const { parser } = gltf;
  console.groupCollapsed('[Debug] GLTF names map');
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const assoc = parser.associations.get(o) || {};
    const nodeIndex = assoc.node ?? assoc.nodes?.[0];
    const meshIndex = assoc.mesh;
    const primIndex = assoc.primitive;
    const nodeDef = (nodeIndex != null) ? parser.json.nodes[nodeIndex] : null; // Blenderのオブジェクト名
    const meshDef = (meshIndex != null) ? parser.json.meshes[meshIndex] : null; // メッシュデータ名
    console.log({
      threeName: o.name,                     // Three.js上で見える名前（= glTF node.name が多い）
      blenderObject: nodeDef?.name ?? null,  // Blenderのオブジェクト名
      blenderMeshData: meshDef?.name ?? null,// Blenderのメッシュデータ名
      primitive: primIndex                   // マルチマテリアル分割の何番目か
    });
  });
  console.groupEnd();
}

// 読み込み時に呼ぶ
loader.load('./sh-apply-color.glb', (gltf) => {
  dumpGLTFNames(gltf);
  setModel(gltf.scene);
});
