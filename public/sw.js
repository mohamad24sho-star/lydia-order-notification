self.addEventListener("install", event => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  const title = payload.title || "Lydia — طلبك جاهز!";
  const options = {
    body: payload.body || "توجه إلى نقطة الاستلام؛ طلبك أصبح جاهزًا.",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: `lydia-order-${payload.orderId || "ready"}`,
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 120, 300, 120, 500],
    data: { url: payload.url || "/", orderId: payload.orderId || "" }
  };
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const focused = windows.some(client => client.focused && "visibilityState" in client && client.visibilityState === "visible");
    if (focused) {
      windows.forEach(client => client.postMessage({ type: "LYDIA_ORDER_READY", orderId: payload.orderId || "" }));
      return;
    }
    await self.registration.showNotification(title, options);
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) { await client.navigate(target); return client.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
