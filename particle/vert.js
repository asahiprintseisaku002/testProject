export const vertexShader = `
uniform float time;
uniform bool isMoving;
attribute float size;  // 各パーティクルの初期サイズ
attribute float speed; // 各パーティクルの上昇速度
attribute vec3 targetPosition;  // パーティクルが目指す最終位置
varying float vAlpha;  // 透明度をフラグメントシェーダーに渡すための変数
varying vec2 vUv;
varying float vSize;   // サイズをフラグメントシェーダーに渡す

void main() {
  vUv = uv;

  // パーティクルの現在の位置を取得
  vec3 pos = position;

  // 目標位置への強制的な修正
  float correctionStrength = 0.2;  // 強制的に戻す強度（0.0〜1.0）

  if (!isMoving) {
    // 目標位置と現在位置のズレを計算し、強制的に補正
    vec3 correction = targetPosition - pos;
    pos += correction * correctionStrength;  // 位置を補正
  }

  if (isMoving) {
    // ランダムな速度に基づいて y 座標を時間とともに上昇させる
    pos.y += time * speed + position.y;
    // x座標にサイン波を使った左右揺れを追加
    pos.x += sin(time * 2.0 + position.y * 0.1) * 1.2;
  }

  // パーティクルが時間とともに大きくなる（サイズは5.0までに制限）
  float age = mod(time + position.y, 6.0);  // 出現からの時間 (0〜5の範囲でループ)
  vSize = size * (age / 5.0);  // 通常のサイズ
  gl_PointSize = min(vSize, 30.0);  // 最大サイズは30に制限

  // 時間経過とともに透明度が減少する（5秒で完全に消える）
  vAlpha = 1.0 - (age / 5.0);

  // カメラ空間に変換
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;
