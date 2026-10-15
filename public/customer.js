(() => {
  const $ = id => document.getElementById(id);
  const socket = io();
  let audioContext = null, ringTimer = null, vibrationTimer = null, soundEnabled = false;
  let currentId = "", lastStatus = "", pushPublicKey = "";

  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3600);
  }
  function normalizedId(value) { return String(value || "").trim().replace(/^#/, "").toUpperCase(); }
  function orderId() { return normalizedId($("order").value); }
  function setLabel(id) { $("orderLabel").textContent = id ? `#${id}` : "—"; $("popupOrder").textContent = id ? `#${id}` : "—"; }
  function getName() { return $("customer").value.trim(); }
  function enableAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      if (!audioContext) audioContext = new AC();
      if (audioContext.state === "suspended") audioContext.resume();
      soundEnabled = true; return true;
    } catch { return false; }
  }
  function beep() {
    if (!audioContext || !soundEnabled) return;
    try {
      if (audioContext.state === "suspended") audioContext.resume();
      const now = audioContext.currentTime;
      [0, .22].forEach(offset => {
        const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, now + offset);
        oscillator.frequency.setValueAtTime(1175, now + offset + .10);
        gain.gain.setValueAtTime(.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(.22, now + offset + .025);
        gain.gain.exponentialRampToValueAtTime(.0001, now + offset + .17);
        oscillator.connect(gain); gain.connect(audioContext.destination);
        oscillator.start(now + offset); oscillator.stop(now + offset + .19);
      });
    } catch {}
  }
  function vibrate() { if (navigator.vibrate) navigator.vibrate([300,120,300,120,500]); }
  function stopAlert() {
    clearInterval(ringTimer); clearInterval(vibrationTimer); ringTimer = null; vibrationTimer = null;
    if (navigator.vibrate) navigator.vibrate(0);
    $("stopBtn").classList.add("hidden");
  }
  function startAlert() {
    stopAlert(); beep(); vibrate();
    ringTimer = setInterval(beep, 1500);
    vibrationTimer = setInterval(vibrate, 2600);
    $("stopBtn").classList.remove("hidden");
  }
  function showReady(order) {
    setLabel(order.id);
    const name = order.customerName || getName();
    $("popupMessage").textContent = name ? `أهلًا ${name}، طلبك أصبح جاهزًا. تفضل إلى نقطة الاستلام.` : "تفضل إلى نقطة الاستلام. طلبك أصبح جاهزًا الآن.";
    $("readyOverlay").classList.add("show");
    startAlert();
  }
  function statusUi(order, announce = false) {
    const wasStatus = lastStatus; lastStatus = order.status;
    setLabel(order.id);
    const pill = $("statusPill");
    pill.className = "pill";
    const stepPrep = $("stepPrep"), stepReady = $("stepReady");
    stepPrep.className = "step"; stepReady.className = "step";
    $("noticeIcon").textContent = "👨‍🍳";
    if (order.status === "preparing") {
      pill.textContent = "قيد التحضير"; stepPrep.classList.add("active");
      $("noticeTitle").textContent = "يتم تحضير طلبك الآن";
      $("noticeText").textContent = "سننبهك فور أن يصبح طلبك جاهزًا للاستلام.";
      $("readyOverlay").classList.remove("show");
    } else if (order.status === "ready") {
      pill.textContent = "جاهز للاستلام"; pill.classList.add("ready");
      stepPrep.classList.add("done"); stepPrep.querySelector(".dot").textContent = "✓"; stepReady.classList.add("active");
      $("noticeIcon").textContent = "🎉";
      $("noticeTitle").textContent = "طلبك جاهز للاستلام!";
      $("noticeText").textContent = "توجه إلى نقطة الاستلام الآن.";
      if (announce && wasStatus !== "ready") showReady(order);
    } else {
      pill.textContent = "تم الاستلام"; pill.classList.add("picked");
      stepPrep.classList.add("done"); stepPrep.querySelector(".dot").textContent = "✓";
      stepReady.classList.add("done"); stepReady.querySelector(".dot").textContent = "✓";
      $("noticeIcon").textContent = "✅"; $("noticeTitle").textContent = "تم استلام الطلب";
      $("noticeText").textContent = "نتمنى لك يومًا سعيدًا!";
      $("readyOverlay").classList.remove("show"); stopAlert();
    }
  }
  async function track(id, showToast = true) {
    id = normalizedId(id);
    if (!/^[A-Z0-9_-]{2,32}$/.test(id)) { toast("أدخل رقم طلب صحيحًا."); return; }
    $("order").value = id;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "تعذر العثور على الطلب.");
      if (currentId && currentId !== id) socket.emit("order:leave", currentId);
      currentId = id; socket.emit("order:join", currentId);
      lastStatus = "";
      statusUi(data.order, data.order.status === "ready");
      $("hint").textContent = data.pushEnabled ? "اضغط «تفعيل الرنين وإشعارات الخلفية» للحصول على التنبيه حتى عندما لا تكون الصفحة مفتوحة، إن كان متصفحك يدعم ذلك." : "التحديث الفوري يعمل أثناء فتح الصفحة. إشعارات الخلفية تحتاج إعدادًا إضافيًا على الخادم.";
      if (showToast) toast(`أنت تتابع الآن الطلب #${id}.`);
    } catch (error) { toast(error.message); }
  }
  async function enableNotifications() {
    const id = orderId();
    if (!id) { toast("أدخل رقم الطلب أولًا ثم فعّل الإشعارات."); $("order").focus(); return; }
    enableAudio();
    await track(id, false);
    if (!currentId) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast("متصفحك لا يدعم إشعارات الخلفية. سيعمل التنبيه أثناء فتح الصفحة.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { toast("لم يتم السماح بالإشعارات. يمكنك تفعيلها من إعدادات المتصفح."); return; }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const configResponse = await fetch("/api/config"), config = await configResponse.json();
      pushPublicKey = config.vapidPublicKey || "";
      if (!pushPublicKey) { toast("إشعارات الخلفية غير مفعلة على الخادم."); return; }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pushPublicKey) });
      const response = await fetch(`/api/orders/${encodeURIComponent(currentId)}/subscribe`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "تعذّر تفعيل الإشعارات.");
      toast("تم تفعيل إشعارات الطلب. ستصلك عند جاهزيته على هذا الجهاز.");
    } catch (error) { toast(error.message || "تعذر تفعيل الإشعارات. تأكد من استخدام HTTPS."); }
  }
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64), output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
    return output;
  }
  $("trackBtn").addEventListener("click", () => { enableAudio(); track(orderId()); });
  $("enableBtn").addEventListener("click", enableNotifications);
  $("stopBtn").addEventListener("click", stopAlert);
  $("ackBtn").addEventListener("click", () => { stopAlert(); $("readyOverlay").classList.remove("show"); toast("تذكّر استلام طلبك."); });
  $("silenceBtn").addEventListener("click", () => { stopAlert(); toast("تم إيقاف الرنين والاهتزاز. رسالة الجاهزية بقيت ظاهرة."); });
  $("order").addEventListener("keydown", e => { if (e.key === "Enter") { enableAudio(); track(orderId()); } });
  socket.on("order:update", order => {
    if (order.id !== currentId) return;
    const prev = lastStatus;
    statusUi(order, prev !== "" && prev !== order.status);
    if (order.status === "ready" && prev !== "ready") toast(`طلبك #${order.id} جاهز للاستلام!`);
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", event => {
      if (event.data?.type === "LYDIA_ORDER_READY" && event.data.orderId === currentId) {
        track(currentId, false);
        toast("طلبك جاهز للاستلام!");
      }
    });
  }
  const params = new URLSearchParams(location.search);
  const fromQr = params.get("order");
  if (fromQr) { $("order").value = normalizedId(fromQr); track(fromQr, false); }
})();
