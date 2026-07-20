document.addEventListener('DOMContentLoaded', () => {
  const currentVersionEl = document.getElementById('currentVersion');
  const latestVersionEl = document.getElementById('latestVersion');
  const spinnerEl = document.getElementById('spinner');
  const statusEl = document.getElementById('status');
  const openReleaseBtn = document.getElementById('openReleaseBtn');
  const closeBtn = document.getElementById('closeBtn');

  closeBtn.addEventListener('click', () => {
    window.close();
  });

  async function init() {
    try {
      const currentVersion = await window.electronAPI.getCurrentVersion();
      currentVersionEl.textContent = currentVersion;
    } catch (err) {
      currentVersionEl.textContent = 'Unknown';
    }

    try {
      const latest = await window.electronAPI.checkLatestRelease();
      latestVersionEl.textContent = latest.version;
      spinnerEl.classList.add('hidden');

      if (latest.comparison < 0) {
        statusEl.textContent = 'A new version is available.';
        statusEl.className = 'status';
        openReleaseBtn.classList.remove('hidden');
        openReleaseBtn.addEventListener('click', () => {
          window.electronAPI.openExternal(latest.url);
        });
      } else if (latest.comparison > 0) {
        statusEl.textContent = 'Running a newer version than the latest release.';
        statusEl.className = 'status';
      } else {
        statusEl.textContent = 'You are using the latest version.';
        statusEl.className = 'status success';
      }
    } catch (err) {
      latestVersionEl.textContent = 'Unknown';
      spinnerEl.classList.add('hidden');
      statusEl.textContent = `Unable to check for updates: ${err.message || err}`;
      statusEl.className = 'status error';
    }
  }

  init();
});
