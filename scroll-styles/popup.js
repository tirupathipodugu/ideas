// Lists every style from the catalog and saves the choice.
const list = document.getElementById('styles');
const soundButton = document.getElementById('sound');
const soundLabel = document.getElementById('soundLabel');
const wave = document.getElementById('wave');

function showSound(on) {
  soundLabel.textContent = on ? 'Sound on' : 'Sound off';
  soundButton.setAttribute('aria-pressed', String(on));
  wave.style.display = on ? '' : 'none';
}

chrome.storage.sync.get({ mode: 'default', sound: true }, (saved) => {
  for (const style of globalThis.ScrollStyles.catalog) {
    const row = document.createElement('label');
    row.className = 'style';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'style';
    input.value = style.id;
    input.checked = style.id === saved.mode;
    input.addEventListener('change', () => chrome.storage.sync.set({ mode: style.id }));
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = style.name;
    const about = document.createElement('span');
    about.className = 'about';
    about.textContent = style.about;
    text.append(name, about);
    row.append(input, text);
    list.appendChild(row);
  }

  let sound = saved.sound;
  showSound(sound);
  soundButton.addEventListener('click', () => {
    sound = !sound;
    showSound(sound);
    chrome.storage.sync.set({ sound });
  });
});
