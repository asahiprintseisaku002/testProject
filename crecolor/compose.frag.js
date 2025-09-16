export const composeFrag = `
precision highp float;

varying vec2 vUv;

uniform sampler2D fieldTex; // RGBA=4色の“濃度マップ”
uniform vec3 colors0;       // パレット色0（RGB）
uniform vec3 colors1;       // パレット色1
uniform vec3 colors2;       // パレット色2
uniform vec3 colors3;       // パレット色3
uniform float exposure;     // 露出（明るさ）
uniform float gamma;        // ガンマ

void main(){
  vec4 f = texture2D(fieldTex, vUv); // f.r=色0の濃度, f.g=色1, f.b=色2, f.a=色3

  // 線形合成（にじみの“重ね塗り”）
  vec3 col = vec3(0.0);
  col += colors0 * f.r;
  col += colors1 * f.g;
  col += colors2 * f.b;
  col += colors3 * f.a;

  // トーン調整（軽く露出＆ガンマ）
  col *= exposure;
  col = pow(max(col, 0.0), vec3(1.0 / gamma));

  gl_FragColor = vec4(col, 1.0);
}`
