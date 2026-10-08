// Synthetic identity providers for testing the lists at scale (0 to 500
// entries: long names, Chinese names, mixed protocols and states, some with
// logos). Only where the Worker has FIXTURES = "1" (local and preview
// builds); production ignores ?fixture= and has no /fixture/ pages.

export const fixtureCount = (env, url) => {
  if (!env || env.FIXTURES !== "1") return null;
  const n = Number(url.searchParams.get(url.pathname === "/fixture/picker" ? "n" : "fixture"));
  return Number.isInteger(n) && n >= 0 && n <= 500 ? n : null;
};

const WORDS = ["Aurora", "Birch", "Cedar", "Delta", "Élan", "Fjord", "Granite", "Harbor", "Iris", "Juniper", "Kestrel", "Lumen", "Meridian", "Nordic", "Orchid", "Prairie", "Quartz", "Riverside", "Summit", "Tundra", "Umber", "Vale", "Willow", "Xenon", "Yarrow", "Zephyr"];
const ZH = ["北辰", "青岚", "云杉", "星河", "松涛", "海湾", "石溪", "晨曦", "远山", "明湖"];
export const FIXTURE_LOGO = "fx.00000000.png";
export const fixtureLogoBytes = () => Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAABUUExURQAAACtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssCtssKWL1TUAAAAbdFJOUwACEStNcpe51uz6CC9vwRZaxQxVJDGiYyAbQ8dugCAAAAAHdElNRQfqCggOHyAIpaFWAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTEwLTA4VDE0OjMxOjMyKzAwOjAwWp8IbgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMC0wOFQxNDozMTozMiswMDowMCvCsNIAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTAtMDhUMTQ6MzE6MzIrMDA6MDB815ENAAACVklEQVR42u2bZ5LDIAxG3XuN03X/e+4QryfZDNj0b3/wLvA0CZYEiCgKBAKBgBZxkmZ5UVZ1Q01dlUWepUnsS952/UA8hr5rndvHaaY95ml0aD8tFR1TLSc3+nMhYV8pzvb1l0Fa/1oPF7v6dFbSv1ZDak8/XpX1jKul9RjftPSMm43ccJdZ+SKqu7F/MtAzJjN9q/fv/1kJJtnxURv7ieqHtv9iQc/QzQlPS36ip5Y/s+YnysB+nQjs/f56/4Kt9fdGbSU+rPuJVL7G1sb3/02tkJHM8x+Pq7TfNP+LmCT9d0d+IrnaGJvU330qqf5Av/845ibhHx36iSS6NDdfwMbxl5A69RMd9srq/bca84Hffg345qAmqO1/dBh2/WfnfqLdfaP8/lOfYsd/8uAn2tm9L14CWMQBuKsCn1RCv9ss/EaYj131Ad9MqCy4IcqGrSc/kaA77LwF0PED6L0F0PMDcF8HNvj1IPbmJ+L2honHABJeAK57oU+4fZHd/fg+3N167jGAnBeAj15gg9sTlB4DKHkB+KnFK9yK7OJMQETNC6DxGEDDC8Cjn+hf/gLwNQD/CuB5AJ4J4bUAXg3h/QC8I4L3hPCuGL8vgO+MWm8BiG4O0Ltj/PkA/IQEfkaEPyWDnxPCT0rxZ8Xw03L8fQH8xgR/ZwS/NcPfG8JvTvF3x/Dbc/z8AH6CAj9DAp+iwc8R4Sep8LNk+Gk6/DwhfqISP1OKn6qN4HPFEX6yGj9bHsGn6xng9wUM8AsLBviNCQP8yuYF9p3RCval1S/Qt2aBQCBglx/6cNSBgNOsQAAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

export function fixtureIdps(n) {
  const idps = [], health = {}, added = {};
  for (let k = 0; k < n; k++) {
    const w = WORDS[k % WORDS.length], z = ZH[k % ZH.length];
    const long = k % 9 === 4 ? " Regional Research and Education Identity Federation of the Northern Provinces" : "";
    const id = `fx-${String(k).padStart(3, "0")}-${w.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()}`;
    const saml = k % 5 === 3;
    const host = `login.${w.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()}${k}.${k % 7 === 0 ? "very-long-subdomain-for-wrapping-tests.example-university" : "example"}.org`;
    idps.push({
      id, protocol: saml ? "saml2" : "oidc",
      name: { en: `${w} Community ${k}${long}`, ...(k % 3 === 0 ? { zh: `${z}社区 ${k}` } : {}) },
      ...(saml ? { entity_id: `https://${host}/idp`, sso_url: `https://${host}/sso` } : { issuer: `https://${host}` }),
      homepage: `https://${host}/`, email_domains: k % 4 === 0 ? [`${w.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()}${k}.example.org`] : [],
      status: k % 23 === 22 ? "disabled" : "active",
      ...(k % 6 === 1 ? { logo: { path: FIXTURE_LOGO, sha256: "0".repeat(64), type: "image/png", width: 128, height: 128 } } : {}),
    });
    health[id] = k % 17 === 5 ? "down" : k % 13 === 7 ? "degraded" : "up";
    added[id] = 1790000000 + k * 3600;
  }
  return { idps, health, added };
}
