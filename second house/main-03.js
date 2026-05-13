import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const container = document.getElementById("canvas-container");

// ===== 基本セットアップ =====
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e0e);

const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 200);
camera.position.set(3, 2, 5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// ライト
const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.8);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(5, 6, 4);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
scene.add(dir);

// グリッド & 地面
const grid = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
scene.add(grid);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ===== GLB ロード =====
const loader = new GLTFLoader();

let modelGroup = null;        // 読み込んだモデルをまとめる親
let selectableMeshes = [];    // 個別選択できる Mesh
let selected = null;          // 現在の選択（Mesh / Group）

// === 手動グループ定義（大小無視 / ワイルドカード * / 正規表現OK） ===
const MANUAL_GROUPS = {
  ceiling:        ["skeleton_top", "wall_top", "interior_wall_ceiling", "frame_top", "ceiling.*"],           // 例: ceiling, ceiling_panel ...
  front_wall:     ["front_wall", "skeleton_front", /wall.*front/i],
  left_wall:      ["left_wall", "skeleton_l", "wall_l", "interior_wall_l", "wall_left.*"],
  right_wall:     ["right_wall", "skeleton_r", "wall_r", "wall_r_window_frame", "wall_r_window_r", "wall_r_window_l", "interior_wall_r", "wall_right.*"],
  back_wall:      ["skeleton_back", "wall_back", "interior_wall_back"],
  sink:           ["sink", "kitchen_sink.*", /シンク/],
  air_conditioner:["air_conditioner", "ac_unit", "aircon.*", /エアコン/],
  fan:            ["fan", "fan_blade", "fan_switch"],
  unit_bath:      ["unitbath_wrap", "ub_door", "ub_toilet_seat", "ub_toilet_cover", "unitbath"],
  loft:           ["loft_floor", "ladder"]
};

// ── 追加：セレクタマッチ関数（なくてエラーになっていた） ──
function selectorMatches(name, selector) {
  const n = String(name || "");
  if (selector instanceof RegExp) return selector.test(n);
  if (typeof selector === "string") {
    const s = selector.toLowerCase();
    const m = n.toLowerCase();
    if (s.includes("*")) {
      // ワイルドカード → 正規表現化
      const esc = s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp("^" + esc + "$", "i").test(n);
    }
    return m === s; // 完全一致
  }
  return false;
}

// 選択の可視化
const selectionBox = new THREE.BoxHelper();
selectionBox.visible = false;
scene.add(selectionBox);

// トランスフォーム
const tctrl = new TransformControls(camera, renderer.domElement);
tctrl.setSize(0.9);
tctrl.addEventListener("dragging-changed", (e) => { controls.enabled = !e.value; });
scene.add(tctrl);

// ===== UI =====
const $ = (id) => document.getElementById(id);
const $meshSelect     = $('mesh-select');
const $groupSelect    = $('group-select');
const $color          = $('color-input');
const $tex            = $('tex-input');
const $rotL           = $('rot-left');
const $rotR           = $('rot-right');
const $modeTranslate  = $('mode-translate');
const $modeRotate     = $('mode-rotate');
const $modeScale      = $('mode-scale');
const $snapMove       = $('snap-move');
const $snapRot        = $('snap-rot');
const $snapOff        = $('snap-off');
const $semiOn         = $('semi-on');
const $semiOff        = $('semi-off');
const $pulse          = $('pulse');
const $resetXform     = $('reset-transform');
const $resetSelOnly   = $('reset-selected-only');
const $resetMat       = $('reset-material');
const $clearTex       = $('clear-tex');

// レイキャスト（クリックでメッシュ選択）
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener("pointerdown", onPointerDown);

// リサイズ
addEventListener("resize", () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});

function setModel(sceneRoot) {
  // 既存モデル撤去
  if (modelGroup) {
    scene.remove(modelGroup);
    modelGroup.traverse(o => {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose?.();
      }
    });
  }

  modelGroup = new THREE.Group();
  modelGroup.name = "LoadedModel";
  scene.add(modelGroup);

  // 初期化
  sceneRoot.position.set(0, 0, 0);
  sceneRoot.rotation.set(0, 0, 0);
  sceneRoot.scale.set(1, 1, 1);

  // 影＆初期キャッシュ
  sceneRoot.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      cacheOriginal(o);
    } else if (o.isObject3D) {
      cacheOriginal(o);
    }
  });

  modelGroup.add(sceneRoot);

  // 選択肢の更新（個別メッシュ）
  selectableMeshes = [];
  sceneRoot.traverse(o => { if (o.isMesh) selectableMeshes.push(o); });
  populateMeshSelect();

  // グルーピング（手動）
  buildGroupsManual(sceneRoot);
  populateGroupSelect();

  fitCameraToObject(sceneRoot, 1.2);
  selectObject(sceneRoot); // まずはルート

  // 任意：メッシュ名一覧をログ
  logMeshNames(sceneRoot);
}

// ===== グループ機能 =====
let groupRoot = null;
let groups = []; // THREE.Group の配列

function buildGroupsManual(root) {
  // 既存のグループを撤去
  if (groupRoot) modelGroup.remove(groupRoot);

  groupRoot = new THREE.Group();
  groupRoot.name = "Groups";
  modelGroup.add(groupRoot);

  groups = [];
  const nameToGroup = new Map();

  // 1) 空グループを用意
  Object.keys(MANUAL_GROUPS).forEach(key => {
    const g = new THREE.Group();
    g.name = `grp:${key}`;
    cacheOriginal(g);
    groupRoot.add(g);
    nameToGroup.set(key, g);
    groups.push(g);
  });

  // 2) メッシュ一覧
  const allMeshes = [];
  root.traverse(o => { if (o.isMesh) allMeshes.push(o); });

  // 3) 手動割当（先勝ち）
  const assigned = new Set();
  for (const [key, selectors] of Object.entries(MANUAL_GROUPS)) {
    const g = nameToGroup.get(key);
    for (const mesh of allMeshes) {
      if (assigned.has(mesh)) continue;
      if (!mesh.name) continue;
      if (selectors.some(sel => selectorMatches(mesh.name, sel))) {
        reparentKeepWorld(mesh, g);
        mesh.userData._groupKey = key;
        assigned.add(mesh);
      }
    }
  }
}

// 親替えしてもワールド座標を保つ
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

// ===== 選択 UI =====
function populateMeshSelect() {
  $meshSelect.innerHTML = `<option value="">（クリックで選択もOK）</option>`;
  for (let i = 0; i < selectableMeshes.length; i++) {
    const m = selectableMeshes[i];
    const label = m.name ? m.name : `(Mesh ${m.id})`;
    const opt = document.createElement("option");
    opt.value = m.id.toString();
    opt.textContent = label;
    $meshSelect.appendChild(opt);
  }
}

function populateGroupSelect() {
  $groupSelect.innerHTML = `<option value="">（なし / メッシュ単位で操作）</option>`;
  groups.forEach(g => {
    if (g.children.length === 0) return; // 空は非表示
    const key = g.name.replace(/^grp:/, "");
    const label = groupLabel(key);
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label;
    $groupSelect.appendChild(opt);
  });
}

function groupLabel(key) {
  const jp = {
    ceiling: "天井",
    front_wall: "壁（ドア側）",
    left_wall: "壁（左）",
    right_wall: "壁（窓側）",
    back_wall: "壁（後）",
    sink: "シンク",
    air_conditioner: "エアコン",
    unit_bath: "ユニットバス",
    fan: "換気扇",
    loft: "ロフト"
  };
  return jp[key] || key;
}

$meshSelect.addEventListener("change", () => {
  const id = Number($meshSelect.value);
  if (!id) return;
  const m = selectableMeshes.find(o => o.id === id);
  if (m) {
    selectObject(m);
    // メッシュが属するグループがあれば同期
    const gkey = m.userData._groupKey;
    if (gkey && [...$groupSelect.options].some(o => o.value === gkey)) {
      $groupSelect.value = gkey;
    } else {
      $groupSelect.value = "";
    }
  }
});

$groupSelect.addEventListener("change", () => {
  const key = $groupSelect.value;
  if (!key) return; // なし → メッシュで選んでください
  const g = groups.find(gr => gr.name === `grp:${key}`);
  if (g) {
    selectObject(g);
    $meshSelect.value = ""; // メッシュ選択は解除
  }
});

// ===== 選択・クリック =====
function selectObject(obj) {
  selected = obj;
  tctrl.attach(selected);
  selectionBox.setFromObject(selected);
  selectionBox.visible = true;
}

function onPointerDown(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const targets = selectableMeshes.length ? selectableMeshes : [];
  const hits = raycaster.intersectObjects(targets, true);
  if (hits.length) {
    selectObject(hits[0].object);
    // クリック時のフィードバック
    pulseScale(selected, 1.08, 160);

    // UI 同期
    const opt = [...$meshSelect.options].find(o => Number(o.value) === selected.id);
    if (opt) $meshSelect.value = opt.value;

    const gkey = selected.userData?._groupKey;
    if (gkey && [...$groupSelect.options].some(o => o.value === gkey)) {
      $groupSelect.value = gkey;
    } else {
      $groupSelect.value = "";
    }
  }
}

// ===== 90°回転 =====
$rotL.addEventListener("click", () => rotateSelected(-90));
$rotR.addEventListener("click", () => rotateSelected(+90));
function rotateSelected(deg) {
  if (!selected) return;
  selected.rotateY(THREE.MathUtils.degToRad(deg));
  selectionBox.setFromObject(selected);
}

// ===== モード & スナップ =====
$modeTranslate.addEventListener("click", () => tctrl.setMode("translate"));
$modeRotate.addEventListener("click", () => tctrl.setMode("rotate"));
//$modeScale.addEventListener("click", () => tctrl.setMode("scale"));

$snapMove.addEventListener("click", () => {
  tctrl.setTranslationSnap(0.1);
  tctrl.setRotationSnap(null);
  tctrl.setScaleSnap(null);
});
$snapRot.addEventListener("click", () => {
  tctrl.setTranslationSnap(null);
  tctrl.setRotationSnap(THREE.MathUtils.degToRad(90));
  tctrl.setScaleSnap(null);
});
$snapOff.addEventListener("click", () => {
  tctrl.setTranslationSnap(null);
  tctrl.setRotationSnap(null);
  tctrl.setScaleSnap(null);
});

// ===== マテリアル（色・透明・テクスチャ） =====
$color.addEventListener("input", () => {
  if (!selected) return;
  applyToMeshTree(selected, (mesh) => {
    ensureUniqueMaterial(mesh);
    const mats = toArray(mesh.material);
    mats.forEach(mat => {
      if (mat.color) mat.color.set($color.value);
      mat.needsUpdate = true;
    });
  });
});

$semiOn.addEventListener("click", () => setSemi(true));
$semiOff.addEventListener("click", () => setSemi(false));
function setSemi(flag) {
  if (!selected) return;
  applyToMeshTree(selected, (mesh) => {
    ensureUniqueMaterial(mesh);
    const mats = toArray(mesh.material);
    mats.forEach(mat => {
      cacheOriginal(mesh);
      mat.transparent = true;
      mat.opacity = flag ? 0.5 : (getOriginal(mesh)?.opacity ?? 1.0);
      mat.depthWrite = true;
      mat.needsUpdate = true;
    });
  });
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
    mats.forEach(mat => {
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
    mats.forEach(mat => {
      cacheOriginal(mesh);
      mat.map = null;
      mat.needsUpdate = true;
    });
  });
});

// ===== 簡易アニメ =====
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

// ===== リセット =====
$resetXform.addEventListener("click", () => {
  if (!modelGroup) return;
  (selected ?? modelGroup).traverse(o => {
    if (!o.isObject3D) return;
    const org = getOriginal(o);
    if (org?.pos && org?.rot && org?.scl) {
      o.position.copy(org.pos);
      o.rotation.set(org.rot.x, org.rot.y, org.rot.z);
      o.scale.copy(org.scl);
    }
  });
  selectionBox.setFromObject(selected ?? modelGroup);
});

$resetSelOnly.addEventListener("click", () => {
  if (!selected) return;
  const o = selected;
  const org = getOriginal(o);
  if (org?.pos && org?.rot && org?.scl) {
    o.position.copy(org.pos);
    o.rotation.set(org.rot.x, org.rot.y, org.rot.z);
    o.scale.copy(org.scl);
  }
  selectionBox.setFromObject(o);
});

$resetMat.addEventListener("click", () => {
  if (!modelGroup) return;
  (selected ?? modelGroup).traverse(o => {
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
    mesh.material = mesh.material.map(m => cloneOnce(m));
  } else {
    mesh.material = cloneOnce(mesh.material);
  }
}
function cloneOnce(mat) {
  if (!mat || mat.userData?._cloned) return mat;
  const c = mat.clone();
  c.userData = { ...(c.userData||{}), _cloned:true };
  return c;
}
function toArray(x) { return Array.isArray(x) ? x : [x]; }

const ORIGINAL = new WeakMap();
function cacheOriginal(obj) {
  if (ORIGINAL.has(obj)) return;
  const entry = {};
  if (obj.isObject3D) {
    obj.updateMatrixWorld(true);
    entry.pos = obj.position.clone();
    entry.rot = new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z);
    entry.scl = obj.scale.clone();
  }
  if (obj.isMesh) {
    const mats = toArray(obj.material);
    entry.material = mats.map(m => ({
      color: m?.color ? m.color.clone() : null,
      opacity: m?.opacity,
      transparent: m?.transparent,
      map: m?.map ?? null,
    }));
  }
  ORIGINAL.set(obj, entry);
}
function getOriginal(obj) { return ORIGINAL.get(obj); }

// 指定オブジェクト配下の Mesh に処理
function applyToMeshTree(root, fn) {
  if (!root || typeof root.traverse !== "function" || typeof fn !== "function") return;
  root.traverse((o) => { if (o.isMesh) fn(o); });
}

// 任意：メッシュ名一覧をログ
function logMeshNames(root) {
  const names = [];
  root.traverse(o => { if (o.isMesh) names.push(o.name || `(Mesh ${o.id})`); });
  console.log("Mesh names:", names);
}

// ===== ループ =====
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// 起動時オートロード（※ HTTP配信で開いてください）
loader.load("./sh-apply.glb", (gltf) => {
  setModel(gltf.scene);
  // setModel内で logMeshNames を呼んでいるので、ここでの sceneRoot 参照は不要
});
