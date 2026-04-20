function show(id, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  window.location.hash = id;
}

function copyCode(btn) {
  const pre = btn.parentElement.querySelector('pre');
  navigator.clipboard.writeText(pre.innerText).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(pre);
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

// Restore tab from URL hash
(function() {
  const hash = window.location.hash.replace('#','');
  const valid = ['overview','quickstart','catalog','gaps','licenses','aihat','access'];
  if (hash && valid.includes(hash)) {
    const btn = document.querySelector('.tab-btn[onclick*="' + hash + '"]');
    if (btn) show(hash, btn);
  }
})();
