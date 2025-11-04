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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcccccc);

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
scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 0.8));

const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(5, 10, 8);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.radius = 4;
scene.add(dir);

scene.add(new THREE.AmbientLight(0xffffff, 0.25));

// グリッド & 地面
scene.add(new THREE.GridHelper(50, 50, 0x444444, 0x222222));
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ===== GLB ロード =====
const loader = new GLTFLoader();

let modelGroup = null;     // 読み込んだモデルをまとめる親
let groups = [];           // THREE.Group の配列
let selected = null;       // 現在の選択（Group）
let groupRoot = null;      // 全グループの親
let pickMeshes = [];                 // ← クリックで拾う対象（Mesh配列）
const groupKeyToGroup = new Map();   // ← "key" → THREE.Group の参照

// === 手動グループ定義（大小無視 / ワイルドカード * / 正規表現OK） ===
// ここをあなたの命名（Blenderのメッシュ名）に合わせて調整
const MANUAL_GROUPS = {
  ceiling:        ["skeleton_top", "wall_top", "interior_wall_ceiling", "frame_top", "ceiling.*"],           // 例: ceiling, ceiling_panel ...
  front_wall:     ["front_wall", "skeleton_front", /wall.*front/i],
  left_wall:      ["left_wall", "skeleton_l", "wall_l", "interior_wall_l", "wall_left.*"],
  right_wall:     ["right_wall", "skeleton_r", "wall_r", "wall_r_window_frame", "wall_r_window_r", "wall_r_window_l", "interior_wall_r", "wall_right.*"],
  back_wall:      ["skeleton_back", "wall_back", "interior_wall_back"],
  sink:           ["sink", "kitchen_sink.*", /シンク/],
  air_conditioner:["air_conditioner", "ac_unit", "aircon.*", /エアコン/],
  fan:            ["fan", "fan_blade", "fan_switch"],
  unit_bath:      ["ub_toilet_seat", "ub_toilet_cover", "unitbath"],
  unit_bath_wall: ["unitbath_wrap", "ub_door"],
  loft:           ["loft_floor", "ladder"],

  // ★新規：初期は非表示にしたい部品群（例）
  optional_hidden: ["bed_frame"], // ワイルドカード可

  // ★新規：右壁のオプションだけ別枠にしたい場合
  right_wall_optional: [
    "wall_r_window_frame",
    "wall_r_window_l",
    "wall_r_window_r"
  ],
};

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

  // 例）新規で“初期は非表示”にしたいグループ
  optional_hidden: false,          // ← 初期は非表示
  right_wall_optional: false       // ← 右壁のオプション群を初期非表示にしたい場合
};

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

// ★ クリック選択は廃止 → レイキャストイベントを登録しない
// （TransformControls は選択中のグループにだけ効く）

// リサイズ
addEventListener("resize", () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});

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

  fitCameraToObject(sceneRoot, 1.2);

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

  // 全メッシュ収集
  const allMeshes = [];
  root.traverse((o) => {
    if (o.isMesh) allMeshes.push(o);
  });

  // 割当
  const assigned = new Set();
  for (const [key, selectors] of Object.entries(MANUAL_GROUPS)) {
    const g = nameToGroup.get(key);
    for (const mesh of allMeshes) {
      if (assigned.has(mesh)) continue;
      if (!mesh.name) continue;
      if (selectors.some((sel) => selectorMatches(mesh.name, sel))) {
        reparentKeepWorld(mesh, g);
        mesh.userData._groupKey = key;
        assigned.add(mesh);
      }
    }
  }

  refreshPickTargets();
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
  $groupSelect.innerHTML = `<option value="">（グループを選んで操作）</option>`;
  groups.forEach((g) => {
    if (g.children.length === 0) return; // 空は非表示
    const key = g.name.replace(/^grp:/, "");
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = groupLabel(key);
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
    unit_bath_wall: "壁（ユニットバス）",
    fan: "換気扇",
    loft: "ロフト",
    optional_hidden: "ベッド",
    right_wall_optional: "壁（右）オプション（初期非表示）",
  };
  return jp[key] || key;
}

$groupSelect.addEventListener("change", () => {
  const key = $groupSelect.value;
  if (!key) { clearSelection(); return; }
  const g = groups.find((gr) => gr.name === `grp:${key}`);
  if (g) selectGroup(g);
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

function selectGroup(group) {
  selected = group;
  tctrl.attach(selected);
  selectionBox.setFromObject(selected);
  selectionBox.visible = false;
  highlightGroupEdges(selected);
  const key = group.name.replace(/^grp:/, "");
  updateVisUISelection(key);   // ★ 強調
}

function clearSelection() {
  selected = null;
  tctrl.detach();
  selectionBox.visible = false;
  clearEdgesOutline();
  updateVisUISelection(null);  // ★ 強調解除
}

function isWorldVisible(obj){
  for (let p = obj; p; p = p.parent) {
    if (!p.visible) return false;
  }
  return true;
}

// UI: 表示/非表示
function populateGroupVisibilityUI() {
  $groupVisList.innerHTML = "";
  groupKeyToVisRow.clear();

  groups.forEach((g) => {
    if (g.children.length === 0) return;
    const key = g.name.replace(/^grp:/, "");
    const id = `vis-${key}`;

    const wrap = document.createElement("label");
    wrap.className = "checkbox vis-row";   // ★ 行にクラス付与
    wrap.dataset.key = key;                // （任意）キーを保持
    wrap.style.display = "flex";
    wrap.style.gap = "6px";
    wrap.style.alignItems = "center";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.checked = g.visible;
    cb.addEventListener("change", () => {
      g.visible = cb.checked;
      refreshPickTargets(); 
      // 非表示にしたグループを選択中だったら解除
      if (!g.visible && selected === g) {
        clearSelection();
        $groupSelect.value = "";
        updateVisUISelection(null);
      }
    });

    const lbl = document.createElement("span");
    lbl.textContent = groupLabel(key);

    wrap.appendChild(cb);
    wrap.appendChild(lbl);
    $groupVisList.appendChild(wrap);

    groupKeyToVisRow.set(key, wrap);       // ★ マップ登録
       if (selected && selected.name === g.name) {
         wrap.classList.add('selected');      // ★ 再描画時に選択があれば反映
       }

  });
}
/*
const pivot = new THREE.Object3D();
scene.add(pivot);

// 選択グループを pivot に入れる
pivot.position.copy(回転中心にしたいワールド座標);
pivot.add(selected);

// あとは pivot を回転
pivot.rotateY(THREE.MathUtils.degToRad(90));

// TransformControls モード/スナップ/回転
/*
$modeTranslate.addEventListener("click", () => tctrl.setMode("translate"));
$modeRotate.addEventListener("click", () => tctrl.setMode("rotate"));
$modeScale.addEventListener("click", () => tctrl.setMode("scale"));

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
*/
$rotL.addEventListener("click", () => rotateSelected(-90));
$rotR.addEventListener("click", () => rotateSelected(+90));
function rotateSelected(deg) {
  if (!selected) return;
  selected.rotateY(THREE.MathUtils.degToRad(deg));
  selectionBox.setFromObject(selected);
}

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

// リセット
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
  if (selected) selectionBox.setFromObject(selected);
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

// ========== クリック選択 ==========
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function refreshPickTargets() {
  pickMeshes = [];
  if (!modelGroup) return;
  modelGroup.traverse(o => { if (o.isMesh) pickMeshes.push(o); });
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
  $groupSelect.value = grp.name.replace(/^grp:/, "");
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
    entry.material = mats.map((m) => ({
      color: m?.color ? m.color.clone() : null,
      opacity: m?.opacity,
      transparent: m?.transparent,
      map: m?.map ?? null,
    }));
  }
  ORIGINAL.set(obj, entry);
}
function getOriginal(obj) {
  return ORIGINAL.get(obj);
}

// 指定オブジェクト配下の Mesh に処理
function applyToMeshTree(root, fn) {
  if (!root || typeof root.traverse !== "function" || typeof fn !== "function") return;
  root.traverse((o) => {
    if (o.isMesh) fn(o);
  });
}

// ===== ループ =====
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// 起動時オートロード（HTTP配信で開いてください）
loader.load("./sh-apply.glb", (gltf) => setModel(gltf.scene));
