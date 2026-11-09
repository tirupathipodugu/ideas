# Scroll Styles

A Chrome extension that lets you choose how your X feed moves.

## Try it

1. Download and unzip [scroll-styles.zip](scroll-styles.zip), or clone this folder.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click **Load unpacked** and select the folder that holds `manifest.json`.
4. Open x.com, click the Scroll Styles icon, and pick a style. It applies immediately.

## Page Roll

The feed column becomes a book with one post on each page. X's menu, header and sidebar stay where they are and turn into sticky notes that still work.

- Drag a page with the mouse. It follows your hand; hold it, reverse it or let go.
- A trackpad swipe moves the page with your fingers.
- A mouse wheel click, the arrow keys, Page Up/Down, Space, or a click on the page turns one page. Keep scrolling and the pages keep turning.
- **Open on X** opens that post in a new tab. **Close book** returns to the normal feed, and **Open book** brings it back.

## Adding a style

1. Add `{ id, name, about }` to `modes/catalog.js`. The popup lists it automatically.
2. Create `modes/<id>.js` and set `globalThis.ScrollStyles.modes['<id>']` to a function that starts the style and returns a function that stops it.
3. Add the file to `content_scripts.js` in `manifest.json`, before `content.js`.
