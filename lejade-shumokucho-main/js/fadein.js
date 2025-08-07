$(function () {
    // ページ読み込み時に.fadeInを削除
    $(".anime").removeClass("fadeIn");

    let ticking = false;

    $(window).on("scroll", function () {
        if (!ticking) {
            window.requestAnimationFrame(function () {
                const wHeight = $(window).height();
                const wScroll = $(window).scrollTop();
                const isMobile = window.innerWidth <= 768;
                const offset = isMobile ? 50 : 200;

                $(".anime").each(function () {
                    const bPosition = $(this).offset().top;
                    if (wScroll > bPosition - wHeight + offset) {
                        $(this).addClass("fadeIn");
                    }
                    // 削除処理はしない
                });

                ticking = false;
            });

            ticking = true;
        }
    });

    // 初回ロード時の.fadeIn削除処理
    function resetConceptMapfadeIn() {
        $(".anime").removeClass("fadeIn");
        checkConceptMapPosition(); // 初回チェック
    }

    function checkConceptMapPosition() {
    // 今は何もしない
    }

    document.addEventListener('DOMContentLoaded', () => {
        resetConceptMapfadeIn();
    });

    window.addEventListener('load', () => {
        setTimeout(() => {
            resetConceptMapfadeIn();

            //noSlide用のfadeIn付帯
            document.querySelectorAll('.noSlide').forEach(el => {
                el.classList.add('fadeIn');  
            });

        }, 150);
    });
});
