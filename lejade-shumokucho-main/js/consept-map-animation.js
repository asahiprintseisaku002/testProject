window.addEventListener("DOMContentLoaded", () => {
    $(function () {
        $('.concept-map-wrap-light, .concept-map-wrap-logo').hide();

        let animationTriggered = false;

        function isInViewportHalf(el) {
            const elementTop = $(el).offset().top;
            const scrollTop = $(window).scrollTop();
            const windowHeight = $(window).height();

            // 画面の1/2（中央）に達したか判定
            return elementTop < (scrollTop + windowHeight / 2);
        }

        function triggerAnimation() {
            $('.concept-map-wrap-light').fadeIn(1000, function () {
                // 1. 膨らみアニメ（拡大 1→8）
                $({ scale: 1 }).animate(
                    { scale: 8 },
                    {
                        duration: 1200,
                        step: function (now) {
                            $('.concept-map-wrap-light').css('transform', 'scale(' + now + ')');
                        },
                        complete: function () {
                            // 2. 縮小アニメ（縮小 8→1）
                            $({ scale: 8 }).animate(
                                { scale: 1 },
                                {
                                    duration: 1200,
                                    step: function (now) {
                                        $('.concept-map-wrap-light').css('transform', 'scale(' + now + ')');
                                    },
                                    complete: function () {
                                        $('.concept-map-wrap-light').css('transform', 'scale(1)');
                                        $('.concept-map-wrap-logo').fadeIn(1000);
                                        $('.map-credit').fadeIn(1000);
                                    }
                                }
                            );
                        }
                    }
                );
            });
        }

        // スクロール時にチェック
        $(window).on('scroll', function () {
            if (!animationTriggered && isInViewportHalf('.conceptMap')) {
                animationTriggered = true;
                triggerAnimation();
            }
        });

        // 初期表示時もチェック
        if (isInViewportHalf('.conceptMap')) {
            animationTriggered = true;
            triggerAnimation();
        }
    });
});
