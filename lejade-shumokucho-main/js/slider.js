$(function () {
    $('.js-footer-slider').slick({
        dots: true,
        dotsClass: 'dots-wrap', // dotsデフォルトのクラス名からdots-wrapに変更
        arrows: false,
        slidesToShow: 3,
        responsive: [{
            breakpoint: 769,
            settings: {
                slidesToShow: 1
            }
        }]
    });
});