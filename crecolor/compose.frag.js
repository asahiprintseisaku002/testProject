export const composeFrag = `
precision highp float;

varying vec2 vUv;

uniform sampler2D fieldTex;     // RGBA: 4色の濃度（0..1 想定）
uniform vec3 colors0, colors1, colors2, colors3;
uniform vec3 bgColor;           // 紙色
uniform float exposure;         // 例: 1.0
uniform float gamma;            // 例: 2.2

void main() {
  // 1) サンプル値の安全化
  vec4 f = clamp(texture2D(fieldTex, vUv), 0.0, 1.0);

  // 2) 初期の微小ゴミを無視（デッドゾーン）
  //    しきい値は 0.003〜0.01 程度でお好み調整
  const float THRESH = 0.006;
  f = max(f - THRESH, 0.0) / (1.0 - THRESH);

  // 3) インク色は加重平均で決める（順次 mix の順序依存を回避）
  float w0 = f.r, w1 = f.g, w2 = f.b, w3 = f.a;
  float wSum = max(w0 + w1 + w2 + w3, 1e-6);
  vec3  inkMix = (colors0 * w0 + colors1 * w1 + colors2 * w2 + colors3 * w3) / wSum;

  // 4) ブレンド量は “最も強いチャンネル” を使うと縁が黒くなりにくい
  float inkAlpha = clamp(max(max(f.r, f.g), max(f.b, f.a)), 0.0, 1.0);

  // 5) 紙色からインクへブレンド
  vec3 col = mix(bgColor, inkMix, inkAlpha);

  // 6) 露出・ガンマ
  col *= exposure;
  col = pow(max(col, 0.0), vec3(1.0 / gamma));

  gl_FragColor = vec4(col, 1.0);
}
 `
