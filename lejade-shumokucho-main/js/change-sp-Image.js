window.addEventListener("DOMContentLoaded", () => {
  const img4sp = document.querySelector('.phase4Image');
  const img5sp = document.querySelector('.phase5Image');

  if (window.innerWidth <= 1520) {
    img5sp.src = "./lib/rj-top-phase5Image-tab.jpg";
  }

  if (window.innerWidth <= 768) {
    img4sp.src = "./lib/rj-top-c4-sp.jpg";
    img5sp.src = "./lib/rj-top-phase5Image-sp.jpg";
  }
});
