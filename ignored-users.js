/* Exclude explicitly requested users before the existing app logic processes rows.
   This keeps app.js calculations and grouping logic unchanged. */
(function () {
  const ignoredUsers = new Set([
    'AS93748',
    'ZEINABAHMED',
    'GS98056',
    'MM07371'
  ]);

  function normalize(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  const originalProcess = window.process;
  if (typeof originalProcess !== 'function') return;

  window.process = function filteredProcess(rows) {
    const filteredRows = Array.isArray(rows)
      ? rows.filter(row => !ignoredUsers.has(normalize(row && row.added_by)))
      : rows;
    return originalProcess(filteredRows);
  };
})();
