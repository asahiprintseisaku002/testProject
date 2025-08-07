jQuery(document).ready(function ($) {
    const $elevationImg = $('.ev-left img');
    const originalSrc = $elevationImg.attr('src');

    // プラン記号と画像パスのマッピング
    const hoverImages = {
        "e": "./lib/plan/rj-plan-elevation_e.png",
        "f": "./lib/plan/rj-plan-elevation_f.png",
        "er": "./lib/plan/rj-plan-elevation_er.png",
        "fr": "./lib/plan/rj-plan-elevation_fr.png",
        "a": "./lib/plan/rj-plan-elevation_a.png",
        "b": "./lib/plan/rj-plan-elevation_b.png",
        "c": "./lib/plan/rj-plan-elevation_c.png",
        "d": "./lib/plan/rj-plan-elevation_d.png"
    };

    $.each(hoverImages, function (key, hoverSrc) {
        const $hoverTargets = $('#js-plan-' + key).add('#js-plan-area-' + key);
        const $clickTarget = $('#js-plan-area-' + key); // クリック対象だけ分離

        // ★ PC（1024px以上）のときのみホバー処理
        if (window.innerWidth >= 1024) {
            $hoverTargets.on('mouseenter', function () {
                $elevationImg.attr('src', hoverSrc);
            }).on('mouseleave', function () {
                $elevationImg.attr('src', originalSrc);
            });
        }

        // ★ 画面幅に関係なくクリックでページ遷移
        $clickTarget.on('click', function () {
            window.location.href = 'plan-' + key + '.html';
        });
    });
});
