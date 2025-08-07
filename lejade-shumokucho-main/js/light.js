function checkConceptMapPosition() {
    const conceptMap = document.querySelector('.area-map');
    if (!conceptMap) return;

    const rect = conceptMap.getBoundingClientRect();
    const triggerPoint = window.innerHeight * (4 / 5);

    if (rect.top < triggerPoint) {
        conceptMap.classList.add('active');
    }
}

// .active を強制的に削除する関数
function resetConceptMapActive() {
    const conceptMap = document.querySelector('.area-map');
    if (conceptMap) {
        conceptMap.classList.remove('active');
    }
    checkConceptMapPosition(); // 初回チェック
}

// DOM が構築されたら一度削除
document.addEventListener('DOMContentLoaded', () => {
    resetConceptMapActive();
});

// ページ全体の読み込みが終わった後に再度確認
window.addEventListener('load', () => {
    setTimeout(() => {
        resetConceptMapActive();
    }, 100); // 少し遅らせて再確認
});

// スクロール時にチェック
window.addEventListener('scroll', checkConceptMapPosition);
