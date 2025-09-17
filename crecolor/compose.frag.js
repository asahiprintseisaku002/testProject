export const composeFrag = `
precision highp float;

varying vec2 vUv;

uniform sampler2D fieldTex;     // RGBA: 4色の濃度（0..1想定）
uniform vec3 colors0, colors1, colors2, colors3;
uniform vec3 bgColor;           // 紙色（白）
uniform float exposure;         // 1.0
uniform float gamma;            // 2.2

void main(){
  // 安全化＋初期ゴミのデッドゾーン
  vec4 f = clamp(texture2D(fieldTex, vUv), 0.0, 1.0);
  const float THRESH = 0.006;          // 0.003〜0.01で調整可
  f = max(f - THRESH, 0.0) / (1.0 - THRESH);

  // インク色は加重平均で
  float w0 = f.r, w1 = f.g, w2 = f.b, w3 = f.a;
  float wSum = max(w0 + w1 + w2 + w3, 1e-6);
  vec3  ink  = (colors0*w0 + colors1*w1 + colors2*w2 + colors3*w3) / wSum;

  // ブレンド量は最大チャンネル（縁が黒くなりにくい）
  float inkAlpha = max(max(f.r, f.g), max(f.b, f.a));

  // 紙→インクへ
  vec3 col = mix(bgColor, ink, inkAlpha);

  col *= exposure;
  col = pow(max(col, 0.0), vec3(1.0/gamma));
  gl_FragColor = vec4(col, 1.0);
}
 `
