// Get Ready With Me: settings you fill in. Everything here is optional; the app works with it all empty
// (built-in samples, pasted links and dropped photos never need any of this).
export default {
  // Your deployed Cloudflare Worker base URL (see worker/). One setting turns on BOTH live in-app Amazon
  // search and reading a pasted product page. Example: 'https://grwm-proxy.yourname.workers.dev'
  // Leave empty and "Search" just opens Amazon in a new tab instead.
  workerUrl: 'https://grwm-proxy.tirupathi-podugu.workers.dev',

  // Deprecated: a bare CORS proxy ending in '?url='. Only used if workerUrl is empty. Prefer workerUrl.
  proxyUrl: '',

  // Amazon Associates tag per country, e.g. in: 'yourtag-21'. Empty = no tag and no disclosure line.
  // Check the Associates Operating Agreement before turning these on.
  associateTags: {
    in: '', com: '', 'co.uk': '', ae: '', sa: '', de: '', fr: '', it: '', es: '', nl: '', ca: '', 'com.au': '', sg: '', 'co.jp': '',
  },

  // "Comment on the post on X" link shown for clothing. Point it at the exact Day N post later.
  postUrl: 'https://x.com/tirupathipodugu',
};
