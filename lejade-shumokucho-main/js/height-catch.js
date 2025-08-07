jQuery(document).ready(function ($) {
    let vh = $("header").height();
    $("html").css("--header-vh", vh + "px");
});

jQuery(document).ready(function ($) {
    let vh = $("header").outerHeight();
    $("html").css("--outheader-vh", vh + "px");
});