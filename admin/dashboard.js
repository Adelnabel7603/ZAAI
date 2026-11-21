(function () {
  let csrfToken = "";
  let sections = [];
  let products = [];
  let orders = [];

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const toast = (message) => {
    const element = $("#admin-toast");
    element.textContent = message;
    element.classList.add("visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("visible"), 3200);
  };

  async function api(path, options = {}) {
    const init = { credentials: "same-origin", ...options };
    init.headers = { ...(init.headers || {}) };
    if (init.method && init.method !== "GET") init.headers["x-csrf-token"] = csrfToken;
    if (init.body && typeof init.body !== "string" && !(init.body instanceof FormData)) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(init.body);
    }
    const response = await fetch(path, init);
    if (response.status === 401) {
      window.location.assign("/admin/login");
      throw new Error("انتهت الجلسة.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "تعذر تنفيذ العملية.");
    return data;
  }

  async function init() {
    try {
      const me = await api("/api/admin/me");
      csrfToken = me.csrfToken;
      await Promise.all([loadOverview(), loadProducts(), loadOrders(), loadCustomers(), loadMedia(), loadSections(), loadSettings()]);
      bindNavigation();
      bindActions();
    } catch (error) {
      toast(error.message);
    }
  }

  function bindNavigation() {
    $$(".admin-nav button").forEach((button) => {
      button.addEventListener("click", () => {
        $$(".admin-nav button").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        $$(".admin-section").forEach((section) => section.classList.remove("active"));
        $(`#section-${button.dataset.section}`).classList.add("active");
        const titles = { overview:"لوحة التحكم",products:"إدارة المنتجات",orders:"إدارة الطلبات",customers:"إدارة العملاء",media:"مكتبة الملفات",sections:"إدارة السكشنات",content:"محرر المحتوى",settings:"إعدادات الموقع" };
        $("#admin-page-title").textContent = titles[button.dataset.section];
      });
    });
    $$("[data-jump]").forEach((button) => button.addEventListener("click", () => {
      document.querySelector(`.admin-nav button[data-section="${button.dataset.jump}"]`)?.click();
    }));
  }

  function bindActions() {
    $("#admin-logout").addEventListener("click", async () => {
      await api("/api/admin/logout", { method:"POST", body:{} }).catch(() => {});
      window.location.assign("/admin/login");
    });
    const toggleTheme = () => {
      document.body.classList.toggle("light-admin");
      localStorage.setItem("zaai-admin-theme", document.body.classList.contains("light-admin") ? "light" : "dark");
    };
    $("#admin-theme").addEventListener("click", toggleTheme);
    $("#top-theme").addEventListener("click", toggleTheme);
    if (localStorage.getItem("zaai-admin-theme") === "light") document.body.classList.add("light-admin");

    $$("[data-close]").forEach((button) => button.addEventListener("click", () => $(button.dataset.close === "product-modal" ? "#product-modal" : "#section-modal").close()));
    $("#add-product").addEventListener("click", () => openProductModal());
    $("#quick-add-product").addEventListener("click", () => openProductModal());
    $("#product-form").addEventListener("submit", saveProduct);
    $("#product-image-upload-button").addEventListener("click", () => $("#product-image-upload").click());
    $("#product-image-upload").addEventListener("change", uploadProductImage);
    $("#product-images").addEventListener("input", () => {
      const firstImage = $("#product-images").value.split(",").map((item) => item.trim()).find(Boolean) || "";
      renderProductImagePreview(firstImage);
    });
    $("#product-360-upload-button").addEventListener("click", () => $("#product-360-upload").click());
    $("#product-360-upload").addEventListener("change", uploadProduct360);
    $("#product-search").addEventListener("input", debounce(loadProducts, 250));
    $("#product-status").addEventListener("change", loadProducts);

    $("#order-search").addEventListener("input", debounce(loadOrders, 250));
    $("#customer-search").addEventListener("input", debounce(loadCustomers, 250));
    $("#media-search").addEventListener("input", debounce(loadMedia, 250));
    $("#media-upload").addEventListener("change", uploadMedia);

    $("#add-section").addEventListener("click", () => openSectionModal());
    $("#section-form").addEventListener("submit", saveSection);
    $("#settings-form").addEventListener("submit", saveSettings);
    $("#change-owner-password").addEventListener("click", changeOwnerPassword);
  }

  function debounce(callback, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => callback(...args), wait);
    };
  }

  async function loadOverview() {
    const data = await api("/api/admin/overview");
    $("#admin-stats").innerHTML = `
      <article class="admin-stat"><div class="admin-stat-head"><span>المنتجات</span><i class="fa-solid fa-shirt"></i></div><strong>${data.products.count || 0}</strong><small>${data.products.published || 0} منشورًا</small></article>
      <article class="admin-stat"><div class="admin-stat-head"><span>الطلبات</span><i class="fa-solid fa-bag-shopping"></i></div><strong>${data.orders.count || 0}</strong><small>${data.orders.new_count || 0} طلب جديد</small></article>
      <article class="admin-stat"><div class="admin-stat-head"><span>العملاء</span><i class="fa-solid fa-users"></i></div><strong>${data.customers || 0}</strong><small>مرتبطون بالطلبات</small></article>
      <article class="admin-stat"><div class="admin-stat-head"><span>الميديا</span><i class="fa-solid fa-photo-film"></i></div><strong>${data.media || 0}</strong><small>صورة وفيديو</small></article>`;
    $("#admin-recent").innerHTML = data.recentAudit.length ? data.recentAudit.map((item) =>
      `<div class="admin-list-item"><span>${escapeHtml(item.action)} · ${escapeHtml(item.entity)}</span><small>${escapeHtml(item.created_at)}</small></div>`
    ).join("") : `<div class="admin-list-item"><span>لا توجد تعديلات بعد</span></div>`;
  }

  async function loadProducts() {
    const search = encodeURIComponent($("#product-search")?.value || "");
    const status = encodeURIComponent($("#product-status")?.value || "");
    products = await api(`/api/admin/products?search=${search}&status=${status}`);
    $("#products-table").innerHTML = products.length ? products.map((product) => {
      const image = (product.images && product.images[0]) || "/image/man/product1.jpg";
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:9px"><img src="${escapeAttr(image)}" alt=""><strong>${escapeHtml(product.name)}</strong></div></td>
        <td>${escapeHtml(product.category === "men" ? "رجالي" : "نسائي")}</td>
        <td>${Number(product.sale_price).toLocaleString("ar-EG")} ج.م</td>
        <td>${Number(product.stock)}</td>
        <td><span class="status ${escapeAttr(product.status)}">${product.status === "published" ? "منشور" : "مسودة"}</span></td>
        <td><button class="admin-button" type="button" data-edit-product="${product.id}">تعديل</button> <button class="admin-button danger" type="button" data-delete-product="${product.id}">حذف</button></td>
      </tr>`;
    }).join("") : `<tr><td colspan="6">لا توجد منتجات مطابقة</td></tr>`;
    $$("[data-edit-product]").forEach((button) => button.addEventListener("click", () => openProductModal(products.find((item) => item.id === Number(button.dataset.editProduct)))));
    $$("[data-delete-product]").forEach((button) => button.addEventListener("click", () => deleteProduct(Number(button.dataset.deleteProduct))));
  }

  function openProductModal(product) {
    $("#product-modal-title").textContent = product ? "تعديل المنتج" : "منتج جديد";
    $("#product-id").value = product?.id || "";
    $("#product-name").value = product?.name || "";
    $("#product-category").value = product?.category || "men";
    $("#product-description").value = product?.description || "";
    $("#product-original").value = product?.original_price || 1000;
    $("#product-sale").value = product?.sale_price || 800;
    $("#product-stock").value = product?.stock || 0;
    $("#product-sort").value = product?.sort_order || 0;
    $("#product-sizes").value = (product?.sizes || ["XS","S","M","L","XL"]).join(", ");
    $("#product-images").value = (product?.images || []).join(", ");
    const firstImage = (product?.images || [])[0] || "";
    renderProductImagePreview(firstImage);
    $("#product-image-upload").value = "";
    const color = product?.colors?.[0] || {};
    $("#product-360-url").value = color.sprite || "";
    $("#product-360-color-id").value = color.id || "";
    $("#product-360-columns").value = color.columns || 6;
    $("#product-360-rows").value = color.rows || 2;
    $("#product-360-views").value = color.viewCount || 6;
    renderProduct360Preview(color.sprite || "");
    $("#product-360-upload").value = "";
    $("#product-status-form").value = product?.status || "draft";
    $("#product-featured").value = product?.featured ? "1" : "0";
    $("#product-modal").showModal();
  }

  function renderProductImagePreview(url) {
    const preview = $("#product-image-preview");
    if (url) {
      preview.innerHTML = `<img src="${escapeAttr(url)}" alt="معاينة صورة المنتج"><span>${escapeHtml(url.split("/").pop())}</span>`;
      preview.classList.add("has-image");
      return;
    }
    preview.innerHTML = `<i class="fa-regular fa-images" aria-hidden="true"></i><span>اختياري — ارفع صورة المنتج الرئيسية</span>`;
    preview.classList.remove("has-image");
  }

  async function uploadProductImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    const button = $("#product-image-upload-button");
    const saveButton = $("#product-form button[type='submit']");
    const label = button.querySelector("span");
    button.disabled = true;
    saveButton.disabled = true;
    label.textContent = "جارٍ رفع الصورة...";
    const form = new FormData();
    form.append("file", file);
    try {
      const media = await api("/api/admin/media", { method:"POST", body:form });
      const currentImages = $("#product-images").value.split(",").map((item) => item.trim()).filter(Boolean);
      const images = [media.url, ...currentImages.filter((image) => image !== media.url)];
      $("#product-images").value = images.join(", ");
      renderProductImagePreview(media.url);
      await Promise.all([loadMedia(), loadOverview()]);
      toast("تم رفع صورة المنتج؛ احفظ المنتج لتطبيقها.");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      saveButton.disabled = false;
      label.textContent = "رفع صورة عادية";
      event.target.value = "";
    }
  }

  function renderProduct360Preview(url) {
    const preview = $("#product-360-preview");
    if (url) {
      preview.innerHTML = `<img src="${escapeAttr(url)}" alt="معاينة صورة الدوران"><span>${escapeHtml(url.split("/").pop())}</span>`;
      preview.classList.add("has-image");
      return;
    }
    preview.innerHTML = `<i class="fa-regular fa-images" aria-hidden="true"></i><span>اختياري — ارفع صورة WebP أو JPG تحتوي إطارات الدوران</span>`;
    preview.classList.remove("has-image");
  }

  async function uploadProduct360(event) {
    const file = event.target.files[0];
    if (!file) return;
    const button = $("#product-360-upload-button");
    const saveButton = $("#product-form button[type='submit']");
    const label = button.querySelector("span");
    button.disabled = true;
    saveButton.disabled = true;
    label.textContent = "جارٍ رفع الصورة...";
    const form = new FormData();
    form.append("file", file);
    try {
      const media = await api("/api/admin/media", { method:"POST", body:form });
      $("#product-360-url").value = media.url;
      renderProduct360Preview(media.url);
      await Promise.all([loadMedia(), loadOverview()]);
      toast("تم رفع صورة 360°؛ احفظ المنتج لتطبيقها.");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      saveButton.disabled = false;
      label.textContent = "رفع صورة دوران 360°";
      event.target.value = "";
    }
  }

  async function saveProduct(event) {
    event.preventDefault();
    const id = $("#product-id").value;
    const previousProduct = products.find((item) => item.id === Number(id));
    const colors = (previousProduct?.colors || []).map((color) => ({ ...color }));
    const spriteUrl = $("#product-360-url").value.trim();
    if (spriteUrl) {
      const colorId = $("#product-360-color-id").value;
      const selectedColor = colors.find((color) => color.id === colorId) || colors[0] || {
        id: colorId || `product-${id || "new"}`,
        nameAr: $("#product-name").value.trim(),
        nameEn: $("#product-name").value.trim(),
        hex: "#98866a"
      };
      selectedColor.sprite = spriteUrl;
      selectedColor.columns = Number($("#product-360-columns").value || 6);
      selectedColor.rows = Number($("#product-360-rows").value || 2);
      selectedColor.viewCount = Number($("#product-360-views").value || 6);
      selectedColor.angles = selectedColor.angles || Array.from(
        { length: selectedColor.viewCount },
        (_, index) => Math.round(index * 360 / selectedColor.viewCount)
      );
      if (!colors.includes(selectedColor)) colors.push(selectedColor);
    }
    const body = {
      name: $("#product-name").value,
      category: $("#product-category").value,
      description: $("#product-description").value,
      original_price: Number($("#product-original").value),
      sale_price: Number($("#product-sale").value),
      stock: Number($("#product-stock").value),
      sort_order: Number($("#product-sort").value),
      sizes: $("#product-sizes").value.split(",").map((item) => item.trim()).filter(Boolean),
      images: $("#product-images").value.split(",").map((item) => item.trim()).filter(Boolean),
      colors,
      status: $("#product-status-form").value,
      featured: $("#product-featured").value === "1"
    };
    try {
      await api(id ? `/api/admin/products/${id}` : "/api/admin/products", { method:id ? "PUT" : "POST", body });
      $("#product-modal").close();
      await Promise.all([loadProducts(), loadOverview()]);
      toast(id ? "تم تحديث المنتج بنجاح." : "تمت إضافة المنتج بنجاح.");
    } catch (error) { toast(error.message); }
  }

  async function deleteProduct(id) {
    if (!window.confirm("هل تريد حذف هذا المنتج نهائيًا؟")) return;
    try {
      await api(`/api/admin/products/${id}`, { method:"DELETE", body:{} });
      await Promise.all([loadProducts(), loadOverview()]);
      toast("تم حذف المنتج.");
    } catch (error) { toast(error.message); }
  }

  async function loadOrders() {
    const search = encodeURIComponent($("#order-search")?.value || "");
    orders = await api(`/api/admin/orders?search=${search}`);
    const states = ["New","Pending","Confirmed","Processing","Shipped","Delivered","Cancelled"];
    $("#orders-table").innerHTML = orders.length ? orders.map((order) => {
      const options = states.map((state) => `<option ${state === order.status ? "selected" : ""}>${state}</option>`).join("");
      return `<tr><td><strong>${escapeHtml(order.order_number)}</strong></td><td>${escapeHtml(order.customer_name)}</td><td dir="ltr">${escapeHtml(order.phone)}</td><td>${Number(order.total).toLocaleString("ar-EG")} ج.م</td><td>${escapeHtml(order.created_at)}</td><td><span class="status ${escapeAttr(order.status)}">${escapeHtml(order.status)}</span></td><td><select data-order-status="${order.id}" class="admin-search" style="height:36px;width:130px">${options}</select></td></tr>`;
    }).join("") : `<tr><td colspan="7">لا توجد طلبات مطابقة</td></tr>`;
    $$("[data-order-status]").forEach((select) => select.addEventListener("change", async () => {
      try {
        await api(`/api/admin/orders/${select.dataset.orderStatus}`, { method:"PATCH", body:{ status:select.value } });
        await Promise.all([loadOrders(), loadOverview()]);
        toast("تم تحديث حالة الطلب.");
      } catch (error) { toast(error.message); }
    }));
  }

  async function loadCustomers() {
    const search = encodeURIComponent($("#customer-search")?.value || "");
    const customers = await api(`/api/admin/customers?search=${search}`);
    $("#customers-table").innerHTML = customers.length ? customers.map((customer) =>
      `<tr><td><strong>${escapeHtml(customer.name)}</strong></td><td dir="ltr">${escapeHtml(customer.phone)}</td><td>${escapeHtml(customer.governorate)}</td><td>${customer.order_count}</td><td>${escapeHtml(customer.updated_at)}</td></tr>`
    ).join("") : `<tr><td colspan="5">لا توجد بيانات عملاء</td></tr>`;
  }

  async function loadSections() {
    sections = await api("/api/admin/sections");
    renderSections();
  }

  function renderSections() {
    $("#sections-list").innerHTML = sections.length ? sections.map((section) =>
      `<div class="section-row" draggable="true" data-section-id="${section.id}">
        <i class="fa-solid fa-grip-vertical"></i>
        <span>${escapeHtml(section.section_key)}</span>
        <div><strong>${escapeHtml(section.title_ar || section.section_key)}</strong><br><span>${section.visible ? "ظاهر" : "مخفي"} · ترتيب ${section.sort_order}</span></div>
        <div class="section-actions"><button class="admin-button" type="button" data-edit-section="${section.id}">تعديل</button> <button class="admin-button danger" type="button" data-delete-section="${section.id}">حذف</button></div>
      </div>`
    ).join("") : `<div class="admin-card">لا توجد سكشنات بعد. أضف السكشن الأول.</div>`;
    $$("[data-edit-section]").forEach((button) => button.addEventListener("click", () => {
      openSectionModal(sections.find((item) => item.id === Number(button.dataset.editSection)));
    }));
    $$("[data-delete-section]").forEach((button) => button.addEventListener("click", async () => {
      if (!confirm("هل تريد حذف هذا السكشن؟")) return;
      await api(`/api/admin/sections/${button.dataset.deleteSection}`, { method:"DELETE", body:{} });
      await loadSections();
      toast("تم حذف السكشن.");
    }));
    const rows = $$("#sections-list .section-row");
    rows.forEach((row) => {
      row.addEventListener("dragstart", () => row.classList.add("dragging"));
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        const dragging = $("#sections-list .dragging");
        if (dragging && dragging !== row) $("#sections-list").insertBefore(dragging, row);
      });
      row.addEventListener("drop", async () => {
        const reordered = $$("#sections-list .section-row");
        for (let index = 0; index < reordered.length; index += 1) {
          const id = Number(reordered[index].dataset.sectionId);
          await api(`/api/admin/sections/${id}`, { method:"PUT", body:{ sort_order:index + 1 } });
        }
        await loadSections();
        toast("تم حفظ ترتيب السكشنات.");
      });
    });
  }

  function openSectionModal(section) {
    $("#section-modal-title").textContent = section ? "تعديل السكشن" : "سكشن جديد";
    $("#section-id").value = section?.id || "";
    $("#section-key").value = section?.section_key || "";
    $("#section-key").disabled = Boolean(section);
    $("#section-sort").value = section?.sort_order || 0;
    $("#section-title-ar").value = section?.title_ar || "";
    $("#section-title-en").value = section?.title_en || "";
    $("#section-content-ar").value = section?.content_ar || "";
    $("#section-content-en").value = section?.content_en || "";
    $("#section-image").value = section?.image || "";
    $("#section-video").value = section?.video || "";
    $("#section-button-ar").value = section?.button_text_ar || "";
    $("#section-button-en").value = section?.button_text_en || "";
    $("#section-link").value = section?.button_link || "";
    $("#section-visible").value = section?.visible ? "1" : "0";
    $("#section-modal").showModal();
  }

  async function saveSection(event) {
    event.preventDefault();
    const id = $("#section-id").value;
    const body = {
      section_key: $("#section-key").value,
      sort_order: Number($("#section-sort").value),
      title_ar: $("#section-title-ar").value,
      title_en: $("#section-title-en").value,
      content_ar: $("#section-content-ar").value,
      content_en: $("#section-content-en").value,
      image: $("#section-image").value,
      video: $("#section-video").value,
      button_text_ar: $("#section-button-ar").value,
      button_text_en: $("#section-button-en").value,
      button_link: $("#section-link").value,
      visible: $("#section-visible").value === "1"
    };
    try {
      await api(id ? `/api/admin/sections/${id}` : "/api/admin/sections", { method:id ? "PUT" : "POST", body });
      $("#section-modal").close();
      $("#section-key").disabled = false;
      await loadSections();
      toast("تم حفظ السكشن.");
    } catch (error) { toast(error.message); }
  }

  async function loadMedia() {
    const search = encodeURIComponent($("#media-search")?.value || "");
    const media = await api(`/api/admin/media?search=${search}`);
    $("#media-grid").innerHTML = media.length ? media.map((item) => `
      <article class="media-item">
        ${item.mime_type.startsWith("video/") ? `<video src="${escapeAttr(item.url)}" muted></video>` : `<img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.original_name)}">`}
        <button type="button" data-delete-media="${item.id}" aria-label="حذف الملف"><i class="fa-solid fa-trash"></i></button>
      </article>`).join("") : `<div class="admin-card" style="grid-column:1/-1">المكتبة فارغة.</div>`;
    $$("[data-delete-media]").forEach((button) => button.addEventListener("click", async () => {
      if (!confirm("هل تريد حذف هذا الملف؟")) return;
      await api(`/api/admin/media/${button.dataset.deleteMedia}`, { method:"DELETE", body:{} });
      await Promise.all([loadMedia(), loadOverview()]);
      toast("تم حذف الملف.");
    }));
  }

  async function uploadMedia(event) {
    const file = event.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      await api("/api/admin/media", { method:"POST", headers:{ "x-csrf-token":csrfToken }, body:form });
      event.target.value = "";
      await Promise.all([loadMedia(), loadOverview()]);
      toast("تم رفع الملف.");
    } catch (error) { toast(error.message); }
  }

  async function loadSettings() {
    const settings = await api("/api/admin/settings");
    const fields = [
      ["siteName","اسم الموقع","text",settings.siteName || "ZAAI STORE"],
      ["whatsapp","رقم واتساب","text",settings.whatsapp || ""],
      ["email","البريد الإلكتروني","email",settings.email || ""],
      ["address","معلومات التواصل","text",settings.address || ""],
      ["currency","العملة","text",settings.currency || "EGP"],
      ["defaultLanguage","اللغة الافتراضية","select",settings.defaultLanguage || "ar"],
      ["primaryColor","لون الهوية الأساسي","color",settings.primaryColor || "#98866a"],
      ["accentColor","لون الهوية الثانوي","color",settings.accentColor || "#171717"]
    ];
    $("#settings-fields").innerHTML = fields.map(([key,label,type,value]) => type === "select"
      ? `<label class="admin-field"><span>${label}</span><select id="setting-${key}"><option value="ar" ${value==="ar"?"selected":""}>العربية</option><option value="en" ${value==="en"?"selected":""}>English</option></select></label>`
      : `<label class="admin-field"><span>${label}</span><input id="setting-${key}" type="${type}" value="${escapeAttr(value)}"></label>`
    ).join("");
  }

  async function changeOwnerPassword() {
    const currentPassword = window.prompt("أدخل كلمة المرور الحالية:");
    if (!currentPassword) return;
    const newPassword = window.prompt("أدخل كلمة مرور جديدة لا تقل عن 12 حرفًا:");
    if (!newPassword) return;
    try {
      await api("/api/admin/account/password", { method:"PUT", body:{ currentPassword, newPassword } });
      toast("تم تغيير كلمة مرور المالك بنجاح.");
    } catch (error) {
      toast(error.message);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const body = {
      siteName: $("#setting-siteName").value,
      whatsapp: $("#setting-whatsapp").value,
      email: $("#setting-email").value,
      address: $("#setting-address").value,
      currency: $("#setting-currency").value,
      defaultLanguage: $("#setting-defaultLanguage").value,
      primaryColor: $("#setting-primaryColor").value,
      accentColor: $("#setting-accentColor").value
    };
    try {
      await api("/api/admin/settings", { method:"PUT", body });
      toast("تم حفظ إعدادات الموقع.");
    } catch (error) { toast(error.message); }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" })[character]);
  }
  function escapeAttr(value) { return escapeHtml(value); }

  init();
})();
