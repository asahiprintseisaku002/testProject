export const composeFrag = `
precision highp float;

varying vec2 vUv;

uniform sampler2D fieldTex;     // RGBA: 4色の濃度
uniform vec3 colors0, colors1, colors2, colors3;
uniform vec3 bgColor;           // 紙色（例: vec3(1.0)）
uniform float exposure;         // 1.0 推奨
uniform float gamma;            // 2.2 推奨

void main(){
  vec4 f = texture2D(fieldTex, vUv);

  // 紙色から、各色をその濃度で順に“のせる”
  vec3 col = bgColor;
  col = mix(col, colors0, clamp(f.r, 0.0, 1.0));
  col = mix(col, colors1, clamp(f.g, 0.0, 1.0));
  col = mix(col, colors2, clamp(f.b, 0.0, 1.0));
  col = mix(col, colors3, clamp(f.a, 0.0, 1.0));

  col *= exposure;
  col = pow(max(col, 0.0), vec3(1.0 / gamma));
  gl_FragColor = vec4(col, 1.0);
}

  `
