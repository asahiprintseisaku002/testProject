export const simFrag = /* glsl */`
precision highp float;

varying vec2 vUv;

// === 基本 ===
uniform sampler2D prevTex;
uniform vec2  texel;
uniform float diffusion;
uniform float decay;
uniform vec2  mouse;
uniform float injecting;
uniform vec4  injectColor;
uniform float injectRadius;
uniform float injectStrength;

// === マスク（座標は動かさない）===
uniform float time;
uniform float ringInner;
uniform float ringWidth;
uniform vec2  centerPos;

// === 形状ゆがみ（有機＋ギザギザ）===
uniform float shapeNoiseScale, shapeNoiseSpeed, shapeAniso, shapeMix;
uniform float jagAmp, jagFreq, jagOctaves, jagSpeed, jagEdge;

// === 拡散ブレンドの微小ゆらぎ（A案の“呼吸”）★ これが未宣言でした ===
uniform float diffusionJitterAmp, diffusionJitterScale, diffusionJitterSpeed;

// ----------------- helpers -----------------
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

// 位相混合ノイズ
float vnoise(vec2 p, float t){
  return 0.5 * (
    sin(dot(p, vec2(12.9898, 78.233)) + t*1.23) +
    sin(dot(p, vec2(-93.989, 67.345)) + t*0.77)
  );
}

float fbm(vec2 p, float t, float oct){
  float a = 0.0, amp = 0.5, f = 1.0;
  for(int i=0;i<6;i++){
    if(float(i) >= oct) break;
    a += amp * vnoise(p*f, t*f);
    f *= 2.0;
    amp *= 0.5;
  }
  return a;
}

// ★ これが未定義でした：拡散ブレンド用の低コスト3波ノイズ
float n3(vec2 p, float t){
  return 0.33 * (
    sin(dot(p, vec2(9.1,  7.7)) + t*0.9) +
    sin(dot(p, vec2(5.4, -11.3)) - t*1.2) +
    sin(dot(p, vec2(-8.2, 4.7)) + t*0.5)
  );
}

// 4ch濃度→強度
float intensity(vec4 f){
  return max(max(f.r, f.g), max(f.b, f.a));
}

// 回転楕円3x3ガウシアン
vec4 blurAniso(sampler2D tex, vec2 uv, vec2 texel){
  float ang = vnoise(uv * shapeNoiseScale, time * shapeNoiseSpeed) * 6.2831853;
  float c = cos(ang), s = sin(ang);
  mat2 R = mat2(c, -s, s, c);

  // 局所ノイズで楕円度を変動
  float nA   = abs(vnoise(uv * (shapeNoiseScale*0.9), time*shapeNoiseSpeed*1.17));
  float aLoc = mix(1.0, shapeAniso, nA);
  mat2 S = mat2(1.0/aLoc, 0.0,
                0.0,      aLoc);
  mat2 M = R * S;

  // ★ ここで “m” を作り直す（uniform は関数内からも見える）
  float aspect = texel.y / texel.x;
  vec2  d      = vec2((uv.x - centerPos.x)*aspect, uv.y - centerPos.y);
  float r      = length(d);
  float mLocal = smoothstep(ringInner, ringInner + ringWidth, r); // 0→1（外側）

  vec2 offs[9];
  offs[0]=vec2(-1.0,-1.0); offs[1]=vec2(0.0,-1.0); offs[2]=vec2(1.0,-1.0);
  offs[3]=vec2(-1.0, 0.0); offs[4]=vec2(0.0, 0.0); offs[5]=vec2(1.0, 0.0);
  offs[6]=vec2(-1.0, 1.0); offs[7]=vec2(0.0, 1.0); offs[8]=vec2(1.0, 1.0);

  float w[9]; w[0]=1.0; w[1]=2.0; w[2]=1.0; w[3]=2.0; w[4]=4.0; w[5]=2.0; w[6]=1.0; w[7]=2.0; w[8]=1.0;

  vec4 sumIso = vec4(0.0), sumAn = vec4(0.0); float ws=0.0;
  for(int i=0;i<9;i++){
    vec2 base = uv + texel * offs[i];
    vec2 dAn  = (M * offs[i]);
    vec4 cIso = texture2D(tex, base);
    vec4 cAn  = texture2D(tex, uv + texel * dAn);
    sumIso += cIso * w[i];
    sumAn  += cAn  * w[i];
    ws += w[i];
  }
  vec4 gIso = sumIso / ws;
  vec4 gAn  = sumAn  / ws;

  // 縁(m=1)ほど等方→楕円に寄せる（shapeMix を 0.2 まで下げる）
  float edgeMix = clamp(mix(shapeMix, 0.2, mLocal), 0.0, 1.0);
  return mix(gAn, gIso, edgeMix);
}


// 勾配から縁法線
vec2 edgeNormal(sampler2D tex, vec2 uv, vec2 texel){
  vec4 L = texture2D(tex, uv - vec2(texel.x, 0.0));
  vec4 R = texture2D(tex, uv + vec2(texel.x, 0.0));
  vec4 D = texture2D(tex, uv - vec2(0.0, texel.y));
  vec4 U = texture2D(tex, uv + vec2(0.0, texel.y));
  float gx = intensity(R) - intensity(L);
  float gy = intensity(U) - intensity(D);
  vec2 g = vec2(gx, gy);
  float l = max(length(g), 1e-5);
  return g / l;
}

// 有機＋縁ギザ
vec4 blurOrganicJagged(sampler2D tex, vec2 uv, vec2 texel){
  vec4 base = blurAniso(tex, uv, texel);

  vec4 here = texture2D(tex, uv);
  float I   = intensity(here);
  vec2 n    = edgeNormal(tex, uv, texel);

  float edge = 0.0;
  {
    vec4 nb = blurAniso(tex, uv, texel);
    edge = clamp((abs(intensity(nb) - I) * jagEdge), 0.0, 1.0);
  }

  float t = time * jagSpeed;
  float n1 = fbm(uv * jagFreq, t, jagOctaves);
  float n2 = vnoise(uv * (jagFreq*0.5), t*1.7);
  float teeth = clamp(n1*0.8 + n2*0.6, -1.0, 1.0);

  vec2  offset = n * (teeth * jagAmp) * min(texel.x, texel.y);
  float w = smoothstep(0.2, 1.0, edge);
  vec4 jag = blurAniso(tex, uv + offset * w, texel);

  return mix(base, jag, 0.7 * w);
}

// ----------------- main -----------------
void main(){
  // 外側マスク（今回は係数ゆらぎ強調などに使ってもOK）
  float aspect = texel.y / texel.x;
  vec2  d  = vec2((vUv.x - centerPos.x)*aspect, vUv.y - centerPos.y);
  float r  = length(d);
  float m  = smoothstep(ringInner, ringInner + ringWidth, r);

  // 拡散ブレンドの微小ゆらぎ（A案）
  vec2  q  = vUv * diffusionJitterScale;
  float dj = n3(q, time * diffusionJitterSpeed);     // -1..1
  float k  = clamp(diffusion + diffusionJitterAmp * dj, 0.0, 1.0);

  vec4 prev   = texture2D(prevTex, vUv);
  vec4 around = blurOrganicJagged(prevTex, vUv, texel);
  vec4 field  = mix(prev, around, k);

  field *= (1.0 - clamp(decay, 0.0, 1.0));

  // 注入（円形補正）
  if (injecting > 0.5) {
    float rNorm = length(vec2((vUv.x - mouse.x)*aspect, vUv.y - mouse.y)) / injectRadius;
    float w1 = exp(-0.5 * pow(rNorm/0.50, 2.0));
    float w2 = exp(-0.5 * pow(rNorm/1.20, 2.0)) * 0.35;
    float w  = w1 + w2;
    field += injectColor * (w * injectStrength);
  }

  gl_FragColor = clamp(field, 0.0, 1.0);
}
`;
