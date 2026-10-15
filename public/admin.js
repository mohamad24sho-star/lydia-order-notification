(() => {
  const $ = id => document.getElementById(id);
  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3600);
  }
  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      credentials: "same-origin"
    });
    const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) showLogin();
      throw new Error(result.error || "حدث خطأ في الطلب.");
    }
    return result;
  }
  function showLogin() { $("loginCard").classList.remove("hidden"); $("dashboard").classList.add("hidden"); }
  function showDashboard() { $("loginCard").classList.add("hidden"); $("dashboard").classList.remove("hidden"); }
  async function loadOrders() {
    try {
      const result = await api("/api/admin/orders");
      renderOrders(result.orders || []);
    } catch (error) { toast(error.message); }
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  }
  function statusName(status) {
    return status === "ready" ? "جاهز للاستلام" : status === "picked_up" ? "تم الاستلام" : "قيد التحضير";
  }
  function renderOrders(orders) {
    const list = $("ordersList");
    if (!orders.length) { list.innerHTML = '<div class="empty">لا توجد طلبات حتى الآن. أنشئ أول طلب من الأعلى.</div>'; return; }
    list.innerHTML = orders.map(order => {
      const id = escapeHtml(order.id), name = escapeHtml(order.customerName || "زبون");
      const date = new Date(order.createdAt).toLocaleString("ar");
      const statusClass = order.status === "ready" ? "ready" : order.status === "picked_up" ? "picked" : "";
      const actions = order.status === "preparing"
        ? `<button class="make-ready" data-status="ready" data-id="${id}">🔔 الطلب جاهز</button>`
        : order.status === "ready"
          ? `<button class="mark-picked" data-status="picked_up" data-id="${id}">✓ تم الاستلام</button><button class="make-prep" data-status="preparing" data-id="${id}">إرجاع للتحضير</button>`
          : `<button class="make-prep" data-status="preparing" data-id="${id}">إعادة فتح الطلب</button>`;
      return `<article class="order-card"><div><div class="order-title"><strong>#${id}</strong><span class="pill ${statusClass}">${statusName(order.status)}</span></div><div class="order-meta">${name} · أُنشئ ${escapeHtml(date)}</div><div class="qr-block"><img src="/api/admin/orders/${encodeURIComponent(id)}/qr?t=${encodeURIComponent(order.updatedAt)}" alt="QR للطلب ${id}"><div><strong>امسح الرمز لمتابعة الطلب</strong><p class="order-meta">يمكنك إرسال رابط المتابعة للزبون.</p><a href="/?order=${encodeURIComponent(id)}" target="_blank" rel="noopener">فتح صفحة الزبون ↗</a><br><a href="/api/admin/orders/${encodeURIComponent(id)}/qr" download="lydia-${id}-qr.png">تنزيل QR بصيغة PNG ↓</a></div></div></div><div class="order-actions">${actions}<button class="open-link" data-copy="/?order=${encodeURIComponent(id)}">نسخ الرابط</button></div></article>`;
    }).join("");
    list.querySelectorAll("[data-status]").forEach(button => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api(`/api/admin/orders/${encodeURIComponent(button.dataset.id)}/status`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status }) });
        toast(button.dataset.status === "ready" ? "تم إرسال تنبيه الجاهزية للطلب." : "تم تحديث حالة الطلب.");
        await loadOrders();
      } catch (error) { toast(error.message); button.disabled = false; }
    }));
    list.querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", async () => {
      const url = new URL(button.dataset.copy, location.origin).href;
      try { await navigator.clipboard.writeText(url); toast("تم نسخ رابط الطلب."); }
      catch { prompt("انسخ رابط الطلب:", url); }
    }));
  }
  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ pin: $("pin").value }) });
      $("pin").value = ""; showDashboard(); await loadOrders();
    } catch (error) { toast(error.message); }
  });
  $("createForm").addEventListener("submit", async e => {
    e.preventDefault();
    const button = e.submitter; button.disabled = true;
    try {
      const result = await api("/api/admin/orders", { method: "POST", body: JSON.stringify({ id: $("newId").value.trim(), customerName: $("newName").value.trim() }) });
      $("newId").value = ""; $("newName").value = "";
      toast(`تم إنشاء الطلب #${result.order.id}. شارك رمز QR مع الزبون.`);
      await loadOrders();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  $("refreshBtn").addEventListener("click", loadOrders);
  $("logoutBtn").addEventListener("click", async () => {
    try { await api("/api/admin/logout", { method: "POST", body: "{}" }); } catch {}
    showLogin(); toast("تم تسجيل الخروج.");
  });
  (async () => {
    try { await api("/api/admin/orders"); showDashboard(); await loadOrders(); }
    catch { showLogin(); }
  })();
})();
