import * as THREE from "three";
import { OrbitControls } from "three/addons/loaders/controls/OrbitControls.js";
import { TransformControls } from "three/addons/loaders//controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/loaders/GLTFLoader.js";

const container = document.getElementById("canvas-container");

// --- 基本セットアップ ---
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

// --- GLB ロード周り ---
const loader = new GLTFLoader();
let modelGroup = null;               // 読み込んだモデルの親
let selectableMeshes = [];           // 選択対象メッシュの配列
let selected = null;                 // 現在選択中の THREE.Object3D (Mesh/Group)
const selectionBox = new THREE.BoxHelper();
selectionBox.visible = false;
scene.add(selectionBox);

// 変形ギズモ
const tctrl = new TransformControls(camera, renderer.domElement);
tctrl.setSize(0.9);
tctrl.addEventListener("dragging-changed", (e) => {
  controls.enabled = !e.value; // トランスフォーム中は Orbit 停止
});
scene.add(tctrl);

// UI 参照
const $file = document.getElementById("file-input");
const $meshSelect = document.getElementById("mesh-select");
const $color = document.getElementById("color-input");
const $tex = document.getElementById("tex-input");
const $rotL = document.getElementById("rot-left");
const $rotR = document.getElementById("rot-right");
const $modeTranslate = document.getElementById("mode-translate");
const $modeRotate = document.getElementById("mode-rotate");
const $modeScale = document.getElementById("mode-scale");
const $snapMove = document.getElementById("snap-move");
const $snapRot = document.getElementById("snap-rot");
const $snapOff = document.getElementById("snap-off");
const $semiOn = document.getElementById("semi-on");
const $semiOff = document.getElementById("semi-off");
const $pulse = document.getElementById("pulse");
const $resetXform = document.getElementById("reset-transform");
const $resetMat = document.getElementById("reset-material");
const $clearTex = document.getElementById("clear-tex");

// レイキャスト（クリック選択）
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener("pointerdown", onPointerDown);

// ウィンドウリサイズ
addEventListener("resize", () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});

// --- モデル読み込み ---
$file.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  try {
    const gltf = await loader.loadAsync(url);
    URL.revokeObjectURL(url);
    setModel(gltf.scene);
  } catch (err) {
    console.error(err);
    alert("読み込みに失敗しました。ファイル形式（.glb / .gltf）をご確認ください。");
  }
});

function setModel(sceneRoot) {
  // 既存モデルを除去
  if (modelGroup) {
    scene.remove(modelGroup);
    modelGroup.traverse(o => {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose?.();
        // テクスチャはユーザー読み込みもあるので dispose は安易にしない（必要に応じて実装）
      }
    });
  }

  // 新規モデル
  modelGroup = new THREE.Group();
  modelGroup.name = "LoadedModel";
  scene.add(modelGroup);

  // 初期配置
  sceneRoot.position.set(0, 0, 0);
  sceneRoot.rotation.set(0, 0, 0);
  sceneRoot.scale.set(1, 1, 1);

  // 影
  sceneRoot.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      cacheOriginal(o); // マテリアル/変形の初期値をキャッシュ
    }
  });

  modelGroup.add(sceneRoot);

  // 選択肢更新
  selectableMeshes = [];
  sceneRoot.traverse(o => {
    if (o.isMesh) selectableMeshes.push(o);
  });
  populateMeshSelect();

  fitCameraToObject(sceneRoot, 1.2);
  selectObject(sceneRoot); // まずはルートを選択
}

// メッシュ一覧のドロップダウンに反映
function populateMeshSelect() {
  $meshSelect.innerHTML = `<option value="">（クリックで選択もOK）</option>`;
  // 名前が空のものにも ID を付けておく
  for (let i = 0; i < selectableMeshes.length; i++) {
    const m = selectableMeshes[i];
    const label = m.name ? m.name : `(Mesh ${m.id})`;
    const opt = document.createElement("option");
    opt.value = m.id.toString();
    opt.textContent = label;
    $meshSelect.appendChild(opt);
  }
}
$meshSelect.addEventListener("change", () => {
  const id = Number($meshSelect.value);
  if (!id) return;
  const m = selectableMeshes.find(o => o.id === id);
  if (m) selectObject(m);
});

// --- 選択/ハイライト ---
function selectObject(obj) {
  selected = obj;
  tctrl.attach(selected);    // トランスフォーム対象
  selectionBox.setFromObject(selected);
  selectionBox.visible = true;

  // ドロップダウンの方も同期
  if (selected.isMesh) {
    const opt = [...$meshSelect.options].find(o => Number(o.value) === selected.id);
    if (opt) $meshSelect.value = opt.value;
  } else {
    $meshSelect.value = "";
  }
}

// クリックで選択
function onPointerDown(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const targets = selectableMeshes.length ? selectableMeshes : [];
  const hits = raycaster.intersectObjects(targets, true);
  if (hits.length) {
    selectObject(hits[0].object);
    // クリック時の簡易アニメ（選択フィードバック）
    pulseScale(selected, 1.08, 160);
  }
}

// --- 90°回転 ---
$rotL.addEventListener("click", () => rotateSelected(-90));
$rotR.addEventListener("click", () => rotateSelected(+90));

function rotateSelected(deg) {
  if (!selected) return;
  selected.rotateY(THREE.MathUtils.degToRad(deg));
  selectionBox.setFromObject(selected);
}

// --- 変形モード & スナップ ---
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

// --- マテリアル操作（色・半透明・テクスチャ） ---
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
      cacheOriginal(mesh); // 念のため
      mat.transparent = true;
      mat.opacity = flag ? 0.5 : getOriginal(mesh)?.opacity ?? 1.0;
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
  texture.flipY = false; // glTF 互換

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

// --- 簡易アニメーション（クリックでメッシュが“ポンッ”と膨らむ） ---
$pulse.addEventListener("click", () => {
  if (!selected) return;
  pulseScale(selected, 1.15, 220);
});
function pulseScale(obj, to = 1.1, ms = 180) {
  const orig = obj.scale.clone();
  const peak = orig.clone().multiplyScalar(to);
  const t0 = performance.now();
  const half = t0 + ms;

  function animate(t) {
    if (t <= half) {
      const k = (t - t0) / ms; // 0..1
      obj.scale.lerpVectors(orig, peak, easeOutQuad(k));
      requestAnimationFrame(animate);
    } else {
      // 収束
      const t1 = t;
      const dur = ms * 1.2;
      const end = t1 + dur;
      const loop = (tt) => {
        if (tt <= end) {
          const k = (tt - t1) / dur;
          obj.scale.lerpVectors(peak, orig, easeOutQuad(k));
          requestAnimationFrame(loop);
        } else {
          obj.scale.copy(orig);
        }
      };
      requestAnimationFrame(loop);
    }
  }
  requestAnimationFrame(animate);
}
const easeOutQuad = (x) => 1 - (1 - x) * (1 - x);

// --- リセット ---
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

// --- 補助: 選択物にカメラを合わせる ---
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

// --- 補助: マテリアル複製（共有材を壊さない） ---
function ensureUniqueMaterial(mesh) {
  if (!mesh.isMesh) return;
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map(m => cloneOnce(m));
  } else {
    mesh.material = cloneOnce(mesh.material);
  }
}
function cloneOnce(mat) {
  if (!mat || mat.userData._cloned) return mat;
  const c = mat.clone();
  c.userData._cloned = true;
  return c;
}
function toArray(x) { return Array.isArray(x) ? x : [x]; }

// --- 補助: 初期状態のキャッシュ（Transform/Material） ---
const ORIGINAL = new WeakMap();
function cacheOriginal(obj) {
  if (!ORIGINAL.has(obj)) {
    const entry = {};
    if (obj.isObject3D) {
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
}
function getOriginal(obj) { return ORIGINAL.get(obj); }

// --- 描画ループ ---
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// =======================
// お好みで：初期サンプルを読みたい場合はここに URL を指定
loader.load("./sh-apply.glb", gltf => setModel(gltf.scene));
// =======================
