// Runtime deployment config — docs/on-prem-deployment.md §16 Track 2.2.
//
// Loaded as a plain <script> before the app bundle (see index.html), so it
// can override where the app points WITHOUT a rebuild — the same built
// frontend artifact can serve our cloud, a dedicated tenant, or an on-prem
// customer just by editing this one file on the deployed host.
//
// Leave apiBaseUrl empty for same-origin (nginx proxies /api/ to the
// backend on the same domain) — this is our own cloud's setup today and
// what an on-prem deployment gets by default too. Only set it if the
// frontend and backend are served from different origins.
window.__ISPUM_CONFIG__ = {
  apiBaseUrl: "",
}
