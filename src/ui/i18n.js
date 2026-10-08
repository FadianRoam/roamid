// English and Simplified Chinese. Language: ?lang= -> cookie -> ui_locales
// -> Accept-Language -> English.

import { getCookie } from "../lib/http.js";

export const LANG_COOKIE = "__Host-rid_lang";
export const THEME_COOKIE = "__Host-rid_theme";

export function pickLang(request, { uiLocales } = {}) {
  const url = new URL(request.url);
  const q = url.searchParams.get("lang");
  if (q === "zh" || q === "en") return q;
  const c = getCookie(request, LANG_COOKIE);
  if (c === "zh" || c === "en") return c;
  for (const tag of String(uiLocales || "").split(/\s+/)) {
    if (/^zh\b/i.test(tag)) return "zh";
    if (/^en\b/i.test(tag)) return "en";
  }
  const al = request.headers.get("Accept-Language") || "";
  const first = al.split(",").map((s) => s.trim().split(";")[0].toLowerCase()).find((s) => /^(zh|en)\b/.test(s));
  return first && first.startsWith("zh") ? "zh" : "en";
}

export function pickTheme(request) {
  const t = getCookie(request, THEME_COOKIE);
  return t === "light" || t === "dark" ? t : "system";
}

const T = {
  en: {
    tagline: "Community identity broker",
    home_lead: "RoamID connects applications to community identity providers. An application integrates RoamID once, using OpenID Connect. Its users sign in with any identity provider listed in the public registry.",
    home_how: "How it works",
    home_steps: [
      "The application sends the user to RoamID.",
      "The user chooses an identity provider from the list and signs in there.",
      "RoamID verifies the result and returns an ID token with the user's identifier, name and email to the application.",
    ],
    home_endpoints: "Endpoints",
    home_registry: "Identity providers and applications are added to the registry by pull request.",
    nav_idps: "Identity providers", nav_idps_short: "IdPs", nav_status: "Status", nav_demo: "Demo", nav_docs: "Docs", nav_source: "GitHub", menu: "Menu",
    hero_l1: "One integration for every", hero_l2: "community identity provider",
    hero_sub: "Applications connect to RoamID once with OpenID Connect. Their users sign in with any identity provider in the public registry.",
    hero_cta: "Integration guide",
    sample_rp: "Example Portal", sample_join: "Your identity provider", sample_join_h: "Joins the registry by pull request",
    sample_label: "Example of the sign-in screen",
    pick_h1: "Choose your", pick_h2: "identity provider",
    pick_sub: "Sign in with the community account you already have. RoamID passes the result to the service named below.",
    pick_to: "Signing in to", pick_continue: "Continue", pick_cancel_short: "Cancel", pick_list: "Identity providers",
    theme_next: "Theme: {cur}. Switch to {next}",
    theme: "Theme", theme_system: "System", theme_light: "Light", theme_dark: "Dark", language: "Language",
    pick_title: "Sign in to {rp}",
    pick_lead: "Choose your identity provider.",
    pick_search: "Search identity providers",
    pick_last: "Last used",
    pick_all: "All identity providers",
    pick_none: "No identity provider matches.",
    pick_empty: "No identity provider is available for this application.",
    pick_note: "{rp} receives an identifier, and the name and email address that your identity provider shares.",
    pick_cancel: "Cancel and return to {rp}",
    status_up: "Available", status_degraded: "Degraded", status_down: "Unavailable", status_unknown: "Not checked",
    idps_title: "Identity providers",
    idps_lead: "The identity providers in the registry. Each entry is maintained by its operator through a pull request.",
    col_name: "Name", col_issuer: "Issuer", col_status: "Status", col_domains: "Email domains",
    disabled: "Disabled",
    status_title: "Status",
    status_registry: "Registry", status_commit: "Commit", status_synced: "Loaded", status_checked: "Last checked", status_error: "Last error",
    status_dropped: "Entries not loaded", status_none: "None",
    status_keys: "Keys", status_signing: "ID token signing", status_client: "Client authentication",
    status_counts: "Sign-ins, last 7 days", status_started: "Started", status_completed: "Completed", status_failed: "Failed",
    status_domains: "Email domain proofs",
    status_version: "Version",
    proof_verified: "Verified", proof_grace: "Record missing, grace period", proof_lost: "Authority lost", proof_unverified: "Not verified",
    err_title: "Sign-in could not continue",
    err_code: "Error code", err_request: "Request ID",
    err_back: "Return to {rp}",
    err_home: "RoamID home",
    out_title: "Signed out of RoamID",
    out_lead: "RoamID no longer remembers your identity provider choice in this browser. Your session at the identity provider is not changed.",
    demo_title: "Demo application",
    demo_lead: "This page is a relying party registered in the RoamID registry as a public client with PKCE. It runs in the browser and shows the claims RoamID returns.",
    demo_signin: "Sign in with RoamID",
    demo_signout: "Sign out",
    demo_again: "Sign in again",
    demo_claims: "ID token claims",
    demo_userinfo: "Userinfo response",
    demo_working: "Completing sign-in",
    demo_failed: "Sign-in failed",
    demo_verified: "Verified by the provider's proven domain",
    demo_asserted: "Asserted by the provider, not verified",
    ago: "{n} ago",
  },
  zh: {
    tagline: "社区身份中转",
    home_lead: "RoamID 把应用与社区身份提供方连接起来。应用以 OpenID Connect 接入 RoamID 一次，其用户即可使用公开登记表中的任一身份提供方登录。",
    home_how: "工作方式",
    home_steps: [
      "应用把用户送到 RoamID。",
      "用户在列表中选择身份提供方，并在该处登录。",
      "RoamID 校验登录结果，向应用返回含用户标识、姓名与邮箱的 ID 令牌。",
    ],
    home_endpoints: "端点",
    home_registry: "身份提供方与应用通过拉取请求加入登记表。",
    nav_idps: "身份提供方", nav_idps_short: "身份提供方", nav_status: "状态", nav_demo: "演示", nav_docs: "文档", nav_source: "GitHub", menu: "菜单",
    hero_l1: "一次接入，", hero_l2: "连通每个社区身份提供方",
    hero_sub: "应用通过 OpenID Connect 接入 RoamID 一次，用户即可使用公开登记表中的任一身份提供方登录。",
    hero_cta: "接入文档",
    sample_rp: "示例门户", sample_join: "你的身份提供方", sample_join_h: "通过拉取请求加入登记表",
    sample_label: "登录页示例",
    pick_h1: "选择你的", pick_h2: "身份提供方",
    pick_sub: "使用你已有的社区账号登录。RoamID 会把登录结果交给下方所示的服务。",
    pick_to: "正在登录", pick_continue: "继续", pick_cancel_short: "取消", pick_list: "身份提供方",
    theme_next: "外观：{cur}。切换为{next}",
    theme: "外观", theme_system: "跟随系统", theme_light: "浅色", theme_dark: "深色", language: "语言",
    pick_title: "登录 {rp}",
    pick_lead: "选择你的身份提供方。",
    pick_search: "搜索身份提供方",
    pick_last: "上次使用",
    pick_all: "全部身份提供方",
    pick_none: "没有匹配的身份提供方。",
    pick_empty: "此应用没有可用的身份提供方。",
    pick_note: "{rp} 将收到一个标识，以及你的身份提供方提供的姓名与邮箱地址。",
    pick_cancel: "取消并返回 {rp}",
    status_up: "可用", status_degraded: "部分可用", status_down: "不可用", status_unknown: "未检查",
    idps_title: "身份提供方",
    idps_lead: "登记表中的身份提供方。每个条目由其运营方通过拉取请求维护。",
    col_name: "名称", col_issuer: "签发方", col_status: "状态", col_domains: "邮箱域名",
    disabled: "已停用",
    status_title: "状态",
    status_registry: "登记表", status_commit: "提交", status_synced: "载入时间", status_checked: "最近检查", status_error: "最近错误",
    status_dropped: "未载入的条目", status_none: "无",
    status_keys: "密钥", status_signing: "ID 令牌签名", status_client: "客户端认证",
    status_counts: "近 7 天登录", status_started: "开始", status_completed: "完成", status_failed: "失败",
    status_domains: "邮箱域名证明",
    status_version: "版本",
    proof_verified: "已验证", proof_grace: "记录缺失，宽限期内", proof_lost: "已失去权威", proof_unverified: "未验证",
    err_title: "登录无法继续",
    err_code: "错误码", err_request: "请求 ID",
    err_back: "返回 {rp}",
    err_home: "RoamID 首页",
    out_title: "已退出 RoamID",
    out_lead: "RoamID 已在此浏览器中清除你选择的身份提供方。你在身份提供方处的会话不受影响。",
    demo_title: "演示应用",
    demo_lead: "此页面是登记在 RoamID 登记表中的依赖方，类型为使用 PKCE 的公开客户端。它在浏览器中运行，显示 RoamID 返回的声明。",
    demo_signin: "使用 RoamID 登录",
    demo_signout: "退出",
    demo_again: "重新登录",
    demo_claims: "ID 令牌声明",
    demo_userinfo: "Userinfo 响应",
    demo_working: "正在完成登录",
    demo_failed: "登录失败",
    demo_verified: "由提供方已证明的域名验证",
    demo_asserted: "由提供方声明，未验证",
    ago: "{n}前",
  },
};

// Error codes: the message shown on the error page (docs/errors.md).
const E = {
  en: {
    invalid_client: "The application is not registered with RoamID, or it has been disabled.",
    invalid_redirect_uri: "The return address does not match the application's registration.",
    tx_expired: "This sign-in has expired or was already used. Start again from the application.",
    tx_browser: "This sign-in was started in a different browser or the cookie was blocked. Start again from the application in this browser.",
    idp_unknown: "This identity provider is not in the registry.",
    idp_disabled: "This identity provider is disabled.",
    idp_not_allowed: "This application does not accept this identity provider.",
    upstream_issuer_mismatch: "The response came from a different identity provider than the one chosen.",
    upstream_discovery_failed: "The identity provider's configuration could not be loaded.",
    upstream_unreachable: "The identity provider could not be reached.",
    upstream_bad_response: "The identity provider returned an invalid response.",
    upstream_jwks_failed: "The identity provider's signing keys could not be loaded.",
    upstream_token_failed: "The identity provider did not complete the sign-in.",
    upstream_id_token_invalid: "The identity provider's ID token did not pass verification.",
    upstream_userinfo_mismatch: "The identity provider returned inconsistent user information.",
    upstream_not_configured: "This identity provider is not configured on this RoamID instance.",
    upstream_error: "The identity provider returned an error.",
    rate_limited: "Too many requests from this address. Wait a minute and try again.",
    registry_unavailable: "The registry is not loaded yet. Try again in a minute.",
    not_found: "This page does not exist.",
    server_error: "An internal error occurred.",
  },
  zh: {
    invalid_client: "此应用未在 RoamID 登记，或已被停用。",
    invalid_redirect_uri: "返回地址与应用登记的地址不一致。",
    tx_expired: "此次登录已过期或已使用。请从应用重新开始。",
    tx_browser: "此次登录在另一个浏览器中开始，或 cookie 被阻止。请在当前浏览器中从应用重新开始。",
    idp_unknown: "登记表中没有这个身份提供方。",
    idp_disabled: "此身份提供方已停用。",
    idp_not_allowed: "此应用不接受这个身份提供方。",
    upstream_issuer_mismatch: "回应来自与所选不同的身份提供方。",
    upstream_discovery_failed: "无法载入身份提供方的配置。",
    upstream_unreachable: "无法连接身份提供方。",
    upstream_bad_response: "身份提供方返回了无效回应。",
    upstream_jwks_failed: "无法载入身份提供方的签名密钥。",
    upstream_token_failed: "身份提供方未完成登录。",
    upstream_id_token_invalid: "身份提供方的 ID 令牌未通过校验。",
    upstream_userinfo_mismatch: "身份提供方返回的用户信息不一致。",
    upstream_not_configured: "此 RoamID 实例未配置这个身份提供方。",
    upstream_error: "身份提供方返回了错误。",
    rate_limited: "此地址的请求过多。请等一分钟后再试。",
    registry_unavailable: "登记表尚未载入。请一分钟后再试。",
    not_found: "此页面不存在。",
    server_error: "发生内部错误。",
  },
};

export function t(lang, key, vars = {}) {
  const v = (T[lang] && T[lang][key]) ?? T.en[key] ?? key;
  return typeof v === "string" ? v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? "")) : v;
}

export function errorText(lang, code) {
  return (E[lang] && E[lang][code]) || E.en[code] || E[lang].server_error;
}

export const ERROR_CODES = Object.keys(E.en);

// For tests: every string of one language.
export function allStrings(lang) {
  const flat = (v) => (Array.isArray(v) ? v : [v]);
  return [...Object.values(T[lang]).flatMap(flat), ...Object.values(E[lang])];
}

export const localName = (entry, lang) => (entry && entry.name && (entry.name[lang] || entry.name.en)) || "";
