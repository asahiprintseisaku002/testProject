$(function(){
  // 一度だけ発動させるフラグ
  let animated = false;

  // アニメ発火用関数
  function runMap1kmAnimation() {
    if (animated) return;
    animated = true;

    // 1. base, text同時フェードイン
    $('#base, #text').addClass('map-fadeIn');

    // 2. 少し遅れてc500拡大＋フェード
    setTimeout(function(){
      $('#c500').addClass('scaleIn');
    }, 400);

    // 3. さらに遅れてc1000拡大＋フェード
    setTimeout(function(){
      $('#c1000').addClass('scaleIn');
    }, 800);

    // 4. 最後にbaloonをフェードイン
    setTimeout(function(){
      $('#baloon').addClass('map-fadeIn');
    }, 2000);
  }

  // スクロール時にエリアが画面内に入ったら発動
  $(window).on('scroll', function() {
    if (animated) return;
    var target = $('.map1km-wrap');
    if (!target.length) return;
    var wH = $(window).height();
    var wS = $(window).scrollTop();
    var tT = target.offset().top;
    var offset = window.innerWidth <= 768 ? 50 : 200;
    if (wS > tT - wH + offset) {
      runMap1kmAnimation();
    }
  });

  // ページロード時にもチェック
  $(window).trigger('scroll');
});
