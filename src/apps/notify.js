// Operator notification for new reports and appeals: a ticket in the
// operator's help desk (Orbit Help) when HELPDESK_URL and HELPDESK_API_KEY
// are set; otherwise only the queue at /admin/reports and the log.

export async function notifyOperator(env, { subject, body }) {
  if (!env.HELPDESK_URL || !env.HELPDESK_API_KEY) {
    console.log("[reports] new item (no help desk configured):", subject);
    return null;
  }
  try {
    const res = await fetch(`${env.HELPDESK_URL.replace(/\/$/, "")}/api/external/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": env.HELPDESK_API_KEY },
      // The help desk files these under its own fixed reporter identity and
      // queue; only the subject and the body are sent.
      body: JSON.stringify({ subject: subject.slice(0, 280), body: body.slice(0, 18000) }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) { console.error("[reports] help desk", res.status, j && j.error); return null; }
    return String(j.number);
  } catch (e) {
    console.error("[reports] help desk", e && e.message);
    return null;
  }
}
