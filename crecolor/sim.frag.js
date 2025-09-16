export const simFrag = `
precision highp float;

varying vec2 vUv;

uniform sampler2D prevTex;
uniform vec2  texel;
uniform float diffusion;
uniform float decay;
uniform vec2  mouse;
uniform float injecting;
uniform vec4  injectColor;
uniform float injectRadius;
uniform float injectStrength;

uniform vec2  injectAxes;   // (長軸スケール, 短軸スケール) 例: vec2(1.2, 0.8)
uniform float injectAngle;  // ラジアン 例: 0.0（無回転）

// 9タップ・ガウシアン
vec4 diffuseGaussian(sampler2D tex, vec2 uv, vec2 texel){
  vec4 c00 = texture2D(tex, uv + texel * vec2(-1.0, -1.0));
  vec4 c10 = texture2D(tex, uv + texel * vec2( 0.0, -1.0));
  vec4 c20 = texture2D(tex, uv + texel * vec2( 1.0, -1.0));
  vec4 c01 = texture2D(tex, uv + texel * vec2(-1.0,  0.0));
  vec4 c11 = texture2D(tex, uv);
  vec4 c21 = texture2D(tex, uv + texel * vec2( 1.0,  0.0));
  vec4 c02 = texture2D(tex, uv + texel * vec2(-1.0,  1.0));
  vec4 c12 = texture2D(tex, uv + vec2(0.0, texel.y));
  vec4 c22 = texture2D(tex, uv + texel * vec2( 1.0,  1.0));
  vec4 sum =
      c00 * 1.0 + c10 * 2.0 + c20 * 1.0 +
      c01 * 2.0 + c11 * 4.0 + c21 * 2.0 +
      c02 * 1.0 + c12 * 2.0 + c22 * 1.0;
  return sum / 16.0;
}

void main(){
  vec4 prev   = texture2D(prevTex, vUv);
  vec4 around = diffuseGaussian(prevTex, vUv, texel);
  vec4 field  = mix(prev, around, clamp(diffusion, 0.0, 1.0));

  field *= (1.0 - clamp(decay, 0.0, 1.0));

  if (injecting > 0.5) {
    float aspect = texel.y / texel.x;

    // アスペクト補正 → 回転 → 軸ごと半径で正規化
    vec2 d = vec2((vUv.x - mouse.x) * aspect, (vUv.y - mouse.y));

    float s = sin(injectAngle), c = cos(injectAngle);
    mat2 R = mat2(c, -s, s, c);
    vec2 q = R * d;

    // injectRadius をベース半径、injectAxes で楕円スケール
    vec2 radii = injectRadius * injectAxes;
    vec2 n = q / radii;          // 楕円の単位円化
    float r2 = dot(n, n);        // = (x/a)^2 + (y/b)^2

    // 二段ガウス（r をそのまま使う）
    float w1 = exp(-0.5 * r2 / (0.50*0.50));
    float w2 = exp(-0.5 * r2 / (1.20*1.20)) * 0.35;
    float w  = w1 + w2;

    field += injectColor * (w * injectStrength);
  }

  gl_FragColor = clamp(field, 0.0, 1.0);
}
`;