// map-fadeIn.js
$(function () {
    // 全てのセットで
    $('.map-fadein-wrap').each(function () {
        var $wrap = $(this);
        var $base = $wrap.find('.map-fadein-base');
        var $baloon = $wrap.find('.map-fadein-baloon');
        var fadeDone = false;

        // 初期化
        $base.removeClass('fadeIn');
        $baloon.removeClass('fadeIn');

        function showBaseThenBaloon() {
            $base.addClass('fadeIn');
            setTimeout(function () {
                $baloon.addClass('fadeIn');
            }, 800);
        }

        function onScroll() {
            if (fadeDone) return;

            var wHeight = $(window).height();
            var wScroll = $(window).scrollTop();
            var isMobile = window.innerWidth <= 768;
            var offset = isMobile ? 50 : 200;
            var bPosition = $wrap.offset().top;
            if (wScroll > bPosition - wHeight + offset) {
                showBaseThenBaloon();
                fadeDone = true;
            }
        }

        // スクロールイベント登録
        $(window).on('scroll', onScroll);

        // ページロード直後も判定
        $(window).trigger('scroll');
    });
});
