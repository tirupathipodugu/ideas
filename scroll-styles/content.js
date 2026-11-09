// Starts the chosen style on X and switches live when the popup changes it.
(() => {
  const S = globalThis.ScrollStyles;
  let stop = () => {}, sound = true;
  const ctx = { sound: () => sound };

  function start(id) {
    stop();
    stop = (S.modes[id] || S.modes.default)(ctx);
  }

  chrome.storage.sync.get({ mode: 'default', sound: true }, (saved) => {
    sound = saved.sound;
    start(saved.mode);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.sound) sound = changes.sound.newValue;
    if (changes.mode) start(changes.mode.newValue);
  });
})();
