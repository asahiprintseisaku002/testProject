$(function () {
    $('.hamburger').on('click', function () {
        $(this).toggleClass('active');
        $('.main-nav').toggleClass('open');

        // openがついている間はスクロール無効
        if ($('.main-nav').hasClass('open')) {
            $('body').addClass('no-scroll');
        } else {
            $('body').removeClass('no-scroll');
        }
    });
});

/*=============================
ハンバーガーナビゲーション
=============================*/
$(function () {
    const currentUrl = location.pathname.split('/').pop();

    $('.main-nav-label').each(function () {
        const linkUrl = $(this).attr('href');

        if (linkUrl === currentUrl) {
            $(this).addClass('active');
        } else {
            $(this).removeClass('active');
        }
    });
});


/*=============================
モバイル下部固定ボタンの高さ取得
=============================*/
// モバイル下部固定ボタンの高さを取得する
jQuery(document).ready(function ($) {
    let vh = $(".mobile-fixed-btns").height();
    $("html").css("--footer_vh", vh + "px");
});