// /demo: a relying party that runs in the browser. It is registered in the
// registry as client "roamid-demo" (public client, PKCE S256) and uses only
// the public endpoints, like any single-page application. The page logic is
// in assets/roamid.js.

import { demoPage as page } from "./pages.js";

export const DEMO_CLIENT_ID = "roamid-demo";
export const demoPage = (v) => page({ ...v, clientId: DEMO_CLIENT_ID });
