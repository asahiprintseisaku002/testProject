window.addEventListener('beforeunload', () => {
    window.scrollTo(0, 0);
});

window.addEventListener('load', () => {
    window.scrollTo(0, 0);

    const phaseFlags = {
        phase3Done: false,
        phase5Done: false,
        phase6Done: false,
    };

    let currentPhase = 0;
    let isRunning = false;

    $(function () {
        const phases = [
            // Phase 3
            function phase3() {
                return new Promise((resolve) => {
                    setTimeout(() => {
                        //$(".secondMarkWhite").removeClass('fadeIn').addClass('fadeOut');
                        $(".secondMarkGray").addClass('fadeIn');
                        setTimeout(() => {
                                    $(".shumoku-container-wrap").addClass('fadeIn');
                                    phaseFlags.phase3Done = true;
                                    resolve();
                                }, 1000);
                    });

                });
            },

            function phase5() {
                return new Promise((resolve) => {
                    setTimeout(() => {
                        $('.secondMark').removeClass('fadeIn');
                        $('.secondMarkWhite').removeClass('fadeIn');
                        $(".secondMarkGray").removeClass('fadeIn');

                        let resolved = false;
                        function safeResolve() {
                            if (!resolved) {
                                resolved = true;
                                phaseFlags.phase5Done = true;
                                //$('body').removeClass('lock-scroll');
                                // ボタン制御はここでOK（遅延も不要なら4800msは不要）
                                $(".skipBtn").addClass('fadeOut');
                                setTimeout(() => {
                                    $(".replayBtn").addClass('fadeIn');
                                    resolve();
                                }, 1200);

                            }
                        }

                        // .phase3のfadeOut完了後
                        $(".shumoku-container-wrap").removeClass('fadeIn');
                       
                        setTimeout(() => {
                            
                            $(".topImperial").addClass('fadeIn');
                            setTimeout(() => {
                                $(".phase5Image").addClass('fadeIn').one('transitionend', function (ev2) {
                                    const prop2 = ev2.originalEvent ? ev2.originalEvent.propertyName : ev2.propertyName;
                                    if (prop2 === 'opacity') {
                                        $(this).addClass('panUp').one('transitionend', function (ev3) {
                                            const prop3 = ev3.originalEvent ? ev3.originalEvent.propertyName : ev3.propertyName;
                                            if (prop3 === 'transform') {
                                                safeResolve();
                                            }
                                        });
                                    }
                                });
                            }, 800); 
                        }, 1500); 



                        // フェールセーフ（10秒経過で必ずresolve）
                        setTimeout(safeResolve, 10000);
                    }, 2000);
                });
            },

            function phase6(skip = false) {
                return new Promise((resolve) => {
                    $(".topImperial").removeClass('fadeIn');
                    $(".phase5Image").removeClass('fadeIn');

                    if (skip) {
                        // スキップ時は一気に全部表示・即resolve
                        $('.phase6Image').addClass('fadeIn');
                        $(".phase6-logo").addClass('fadeIn');
                        $('.phase6Image-exteria').addClass('fadeIn');
                        $('.phase6-text').addClass('fadeIn');
                        phaseFlags.phase6Done = true;
                        resolve(); // ←即進む！
                        return;
                    }

                    // 通常時はアニメーション
                    $('.phase6Image').addClass('fadeIn');
                    setTimeout(() => {
                        $(".phase6-logo").addClass('fadeIn').one('transitionend', () => {
                            $('.phase6Image-exteria').addClass('fadeIn');
                            $('.phase6-text').addClass('fadeIn');
                            phaseFlags.phase6Done = true;
                            resolve();
                        });
                    }, 2000);
                });
            }
        ];

        async function goNextPhase() {
            while (currentPhase < phases.length) {
                isRunning = true;
                await phases[currentPhase]();
                phaseFlags[`phase${currentPhase + 1}Done`] = true;
                currentPhase++;
                isRunning = false;
            }
        }

        // 初期化
        goNextPhase();

        function forcePhase6FinalState() {
            $('.phase6Image').addClass('fadeIn');
            $('.phase6-logo').addClass('fadeIn');
            $('.phase6Image-exteria').addClass('fadeIn');
            $('.phase6-text').addClass('fadeIn');
            $(".replayBtn").addClass('fadeIn');
            const $skip = $('.skipBtn');
            $skip.addClass('fadeOut');
            $skip.one('transitionend webkitTransitionEnd oTransitionEnd', function () {
                $skip.addClass('hidden');
            });
        }


        $('#skipBtn').on('click', function () {
            forcePhase6FinalState();
            // あとは必要な進行処理やresolveも書けます
        });

        // スワイプ対応（スマホ用）
        let touchStartY = 0;
        window.addEventListener("touchstart", (e) => { touchStartY = e.touches[0].clientY; });
        window.addEventListener("touchend", (e) => {
            const diffY = touchStartY - e.changedTouches[0].clientY;
            if (diffY > 30 && !isRunning && currentPhase < phases.length) {
                $('#skipBtn').trigger('click');
            }
        });
    });

    $('#replayBtn').on('click', () => {
        location.reload(); // ページを再読み込み
    });

});