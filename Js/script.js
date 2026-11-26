const languageButton = document.getElementById("language-toggle");
const themeButton = document.getElementById("theme-toggle");
const themeLabel = document.getElementById("theme-label");
const themeIcon = document.querySelector(".theme-icon");
const languageLabel = document.getElementById("language-label");
const menuButton = document.getElementById("menu-toggle");
const menuIcon = document.querySelector(".menu-icon");
const navigation = document.getElementById("main-navigation");

let storeCatalog = [];
let storeCatalogLoaded = false;
let storeCatalogError = "";

let installPromptEvent = null;
const installAppButton = document.getElementById("install-app-button");
const mobileInstallAppButton = document.getElementById("mobile-install-app-button");
const installButtons = [installAppButton, mobileInstallAppButton].filter(Boolean);

function setInstallButtonsVisible(visible) {
  installButtons.forEach((button) => {
    button.hidden = !visible;
  });
}

function isRunningAsApp() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

if (isRunningAsApp()) {
  setInstallButtonsVisible(false);
} else {
  setInstallButtonsVisible(true);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPromptEvent = event;
  if (!isRunningAsApp()) setInstallButtonsVisible(true);
});

async function requestAppInstall() {
  if (!installPromptEvent) {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      alert("من متصفح Safari اختر المشاركة ثم Add to Home Screen.");
    } else {
      alert("افتح قائمة المتصفح ثم اختر تثبيت ZAAI أو إضافة إلى الشاشة الرئيسية.");
    }
    return;
  }
  installPromptEvent.prompt();
  await installPromptEvent.userChoice;
  installPromptEvent = null;
  setInstallButtonsVisible(false);
}

installButtons.forEach((button) => button.addEventListener("click", requestAppInstall));

window.addEventListener("appinstalled", () => {
  installPromptEvent = null;
  setInstallButtonsVisible(false);
});

function storeApiUrl(path) {
  const hostname = window.location.hostname;
  const port = window.location.port;
  if ((hostname === "127.0.0.1" || hostname === "localhost") && port !== "5510") {
    return `https://zaai-production.up.railway.app${path}`;
  }
  return path;
}

function resolveStoreAssetUrl(asset) {
  const value = String(asset || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) {
    const hostname = window.location.hostname;
    const port = window.location.port;
    if ((hostname === "127.0.0.1" || hostname === "localhost") && port !== "5510") {
      return `https://zaai-production.up.railway.app${value}`;
    }
    return value;
  }
  return value;
}

function escapeCatalogText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function normalizeCatalogSizes(sizes, productStock) {
  const productUnavailable = Number.isFinite(Number(productStock)) && Number(productStock) <= 0;
  return (Array.isArray(sizes) ? sizes : []).map((size, index) => {
    if (typeof size === "string") {
      return { name: size, available: !productUnavailable, stock: null, index };
    }
    const name = size?.name || size?.label || size?.id || size?.size || "";
    const stock = Number(size?.stock ?? size?.quantity);
    return {
      name: String(name),
      available: !productUnavailable && size?.available !== false && (!Number.isFinite(stock) || stock > 0),
      stock: Number.isFinite(stock) ? Math.max(0, stock) : null,
      index
    };
  }).filter((size) => size.name);
}

function normalizeCatalogColors(colors, productStock) {
  const productUnavailable = Number.isFinite(Number(productStock)) && Number(productStock) <= 0;
  return (Array.isArray(colors) ? colors : []).map((color, index) => {
    if (typeof color === "string") {
      return { nameAr: color, nameEn: color, available: !productUnavailable, stock: null, index };
    }
    const stock = Number(color?.stock ?? color?.quantity);
    return {
      ...color,
      image: resolveStoreAssetUrl(color?.image),
      sprite: resolveStoreAssetUrl(color?.sprite),
      nameAr: color?.nameAr || color?.name || color?.label || color?.id || `لون ${index + 1}`,
      nameEn: color?.nameEn || color?.name || color?.label || color?.id || `Color ${index + 1}`,
      available: !productUnavailable && color?.available !== false && (!Number.isFinite(stock) || stock > 0),
      stock: Number.isFinite(stock) ? Math.max(0, stock) : null,
      index
    };
  }).filter((color) => color.available);
}

function uniqueResolvedImages(images) {
  return (Array.isArray(images) ? images : [])
    .filter(Boolean)
    .map(resolveStoreAssetUrl)
    .filter((image, index, list) => image && list.indexOf(image) === index);
}

function getCardProductImages(product, colors = normalizeCatalogColors(product?.colors, product?.stock)) {
  const productImages = uniqueResolvedImages(product?.images);
  if (productImages.length > 1 || product?.gallery_customized) return productImages;

  const color = colors?.[0]
    || (Array.isArray(product?.colors) ? product.colors.find((item) => item && typeof item === "object") : null);
  const catalogGallery = uniqueResolvedImages(window.ZAAI_CATALOG_IMAGE_GALLERIES?.[color?.id]);
  const colorImage = resolveStoreAssetUrl(color?.image);
  if (
    productImages.length === 1
    && catalogGallery.length > 1
    && productImages[0] === catalogGallery[0]
    && productImages[0] === colorImage
  ) {
    return catalogGallery;
  }
  if (productImages.length) return productImages;
  return uniqueResolvedImages([color?.image]);
}

function setupCardImageGallery(card, images) {
  if (!card || images.length <= 1) return;

  const stage = card.querySelector("[data-card-gallery-stage]");
  if (!stage) return;

  const thumbs = Array.from(card.querySelectorAll("[data-card-gallery-index]"));
  const thumbRail = card.querySelector(".zaai-card-image-thumbs");
  let activeIndex = 0;
  let requestedIndex = 0;
  let isTransitioning = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchActive = false;
  let suppressLinkClick = false;
  let suppressClickTimer = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const preloads = new Map();

  function setActiveThumb(index) {
    thumbs.forEach((thumb, thumbIndex) => {
      const active = thumbIndex === index;
      thumb.classList.toggle("is-active", active);
      thumb.setAttribute("aria-current", active ? "true" : "false");
      thumb.setAttribute("aria-pressed", String(active));
    });

    const activeThumb = thumbs[index];
    if (!activeThumb || !thumbRail) return;
    const thumbRect = activeThumb.getBoundingClientRect();
    const railRect = thumbRail.getBoundingClientRect();
    if (thumbRect.left < railRect.left) {
      thumbRail.scrollBy({ left: thumbRect.left - railRect.left, behavior: reducedMotion.matches ? "auto" : "smooth" });
    } else if (thumbRect.right > railRect.right) {
      thumbRail.scrollBy({ left: thumbRect.right - railRect.right, behavior: reducedMotion.matches ? "auto" : "smooth" });
    }
  }

  function preloadImage(source) {
    if (preloads.has(source)) return preloads.get(source);
    const image = new Image();
    image.decoding = "async";
    image.src = source;
    const preload = (image.complete
      ? image.naturalWidth
        ? Promise.resolve()
        : Promise.reject(new Error(`Image failed to load: ${source}`))
      : new Promise((resolve, reject) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", () => reject(new Error(`Image failed to load: ${source}`)), { once: true });
      }))
      .then(() => typeof image.decode === "function" ? image.decode() : undefined)
      .catch((error) => {
        if (image.naturalWidth) return;
        preloads.delete(source);
        throw error;
      });
    preloads.set(source, preload);
    return preload;
  }

  async function runTransitions() {
    if (isTransitioning) return;
    isTransitioning = true;

    while (requestedIndex !== activeIndex) {
      const targetIndex = requestedIndex;
      try {
        await preloadImage(images[targetIndex]);
      } catch (error) {
        if (requestedIndex !== targetIndex) continue;
        console.error("Could not load a ZAAI product gallery image.", error);
        requestedIndex = activeIndex;
        setActiveThumb(activeIndex);
        break;
      }
      if (requestedIndex !== targetIndex) continue;

      const current = stage.querySelector(".zaai-card-gallery-current");
      if (!current) break;
      if (reducedMotion.matches) {
        current.src = images[targetIndex];
        activeIndex = targetIndex;
        continue;
      }

      const direction = targetIndex >= activeIndex ? 1 : -1;
      const incoming = document.createElement("img");
      incoming.className = "zaai-card-gallery-incoming";
      incoming.alt = current.alt || "";
      incoming.decoding = "async";
      incoming.src = images[targetIndex];
      stage.appendChild(incoming);

      const outgoingAnimation = current.animate([
        { opacity: 1, transform: "scale(1) translateX(0)" },
        { opacity: 0, transform: `scale(.985) translateX(${direction >= 0 ? "-12px" : "12px"})` }
      ], { duration: 340, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });
      const incomingAnimation = incoming.animate([
        { opacity: 0, transform: `scale(1.015) translateX(${direction >= 0 ? "18px" : "-18px"})` },
        { opacity: 1, transform: "scale(1) translateX(0)" }
      ], { duration: 340, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });

      await Promise.all([outgoingAnimation.finished, incomingAnimation.finished]);
      outgoingAnimation.cancel();
      incomingAnimation.cancel();
      incoming.className = "zaai-card-gallery-current";
      current.remove();
      activeIndex = targetIndex;
    }

    isTransitioning = false;
    const nextIndex = (activeIndex + 1) % images.length;
    preloadImage(images[nextIndex]).catch((error) => {
      console.error("Could not prepare the next ZAAI product gallery image.", error);
    });
  }

  function showImage(nextIndex) {
    const safeIndex = Math.max(0, Math.min(images.length - 1, nextIndex));
    if (safeIndex === requestedIndex) return;
    requestedIndex = safeIndex;
    setActiveThumb(requestedIndex);
    runTransitions();
  }

  thumbs.forEach((thumb, index) => {
    thumb.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showImage(index);
    });
  });

  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" || event.target.closest("[data-card-gallery-index]")) return;
    touchStartX = event.clientX;
    touchStartY = event.clientY;
    touchActive = true;
  }, { passive: true });

  stage.addEventListener("pointerup", (event) => {
    if (!touchActive) return;
    touchActive = false;
    const deltaX = event.clientX - touchStartX;
    const deltaY = event.clientY - touchStartY;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    suppressLinkClick = true;
    window.clearTimeout(suppressClickTimer);
    suppressClickTimer = window.setTimeout(() => {
      suppressLinkClick = false;
    }, 500);
    const nextIndex = requestedIndex + (deltaX < 0 ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= images.length) return;
    showImage(nextIndex);
  }, { passive: true });

  stage.addEventListener("pointercancel", () => {
    touchActive = false;
  }, { passive: true });

  stage.addEventListener("click", (event) => {
    if (!suppressLinkClick || event.target.closest("[data-card-gallery-index]")) return;
    suppressLinkClick = false;
    window.clearTimeout(suppressClickTimer);
    event.preventDefault();
    event.stopPropagation();
  }, true);

  preloadImage(images[(activeIndex + 1) % images.length]).catch((error) => {
    console.error("Could not prepare the next ZAAI product gallery image.", error);
  });
}

function renderStoreProducts() {
  const english = document.documentElement.lang === "en";
  const categories = [
    { key: "men", container: document.getElementById("men-products") },
    { key: "women", container: document.getElementById("women-products") }
  ];

  categories.forEach(({ key, container }) => {
    if (!container) return;
    if (!storeCatalogLoaded) {
      container.innerHTML = `<p class="zaai-catalog-message">${english ? "Loading products..." : "جارٍ تحميل المنتجات..."}</p>`;
      return;
    }
    if (storeCatalogError) {
      const message = storeCatalogError === "file"
        ? (english
          ? "This page is open as a file. Run npm start in the ZAAI folder, then open http://127.0.0.1:5510."
          : "الصفحة مفتوحة كملف. شغّل npm start داخل مجلد ZAAI ثم افتح http://127.0.0.1:5510.")
        : (english
          ? "Products could not be loaded. Please make sure the store server is running."
          : "تعذر تحميل المنتجات. تأكد من تشغيل خادم المتجر.");
      const retryButton = storeCatalogError === "file"
        ? ""
        : `<button class="zaai-catalog-retry" type="button" data-retry-catalog>${english ? "Retry" : "إعادة المحاولة"}</button>`;
      container.innerHTML = `<div class="zaai-catalog-message"><p>${message}</p>${retryButton}</div>`;
      return;
    }

    const products = storeCatalog.filter((product) => product.category === key);
    if (!products.length) {
      container.innerHTML = `<p class="zaai-catalog-message">${english ? "No published products in this collection yet." : "لا توجد منتجات منشورة في هذا القسم حاليًا."}</p>`;
      return;
    }

    container.innerHTML = products.map((product) => {
      const images = getCardProductImages(product);
      const image = images[0] || "";
      const imageName = escapeCatalogText(product.name);
      const thumbs = images.length > 1
        ? `<div class="zaai-card-image-thumbs" role="group" aria-label="${english ? `Product images for ${imageName}` : `صور المنتج ${imageName}`}">
            ${images.map((galleryImage, index) => `
              <button type="button" class="zaai-card-image-thumb ${index === 0 ? "is-active" : ""}" data-card-gallery-index="${index}" aria-label="${english ? `View image ${index + 1} of ${escapeCatalogText(product.name)}` : `عرض الصورة ${index + 1} من ${escapeCatalogText(product.name)}`}" aria-current="${index === 0 ? "true" : "false"}" aria-pressed="${index === 0}">
                <img src="${escapeCatalogText(galleryImage)}" alt="" loading="lazy" decoding="async">
              </button>`).join("")}
          </div>`
        : "";
      const salePrice = Number(product.sale_price) || 0;
      const originalPrice = Number(product.original_price) || 0;
      return `<article class="zaai-product-card" data-product-id="${Number(product.id)}" tabindex="0" aria-label="${english ? `View ${escapeCatalogText(product.name)}` : `عرض ${escapeCatalogText(product.name)}`}">
        <div class="zaai-product-card-image">
          <a class="zaai-product-card-open" href="/product/${encodeURIComponent(product.id)}" data-open-product="${Number(product.id)}" aria-label="${english ? `View ${escapeCatalogText(product.name)}` : `عرض ${escapeCatalogText(product.name)}`}">
            ${image
              ? `<span class="zaai-card-gallery-stage" data-card-gallery-stage><img class="zaai-card-gallery-current" src="${escapeCatalogText(image)}" alt="${imageName}" loading="lazy" decoding="async"></span>`
              : `<span class="zaai-product-card-placeholder">${english ? "Image coming soon" : "الصورة غير متوفرة"}</span>`}
          </a>
          ${thumbs}
          <button class="zaai-card-favorite" type="button" aria-label="${english ? "Add to favorites" : "إضافة إلى المفضلة"}">
            <i class="fa-regular fa-heart" aria-hidden="true"></i>
          </button>
        </div>
        <div class="zaai-card-footer">
          <div class="zaai-card-copy">
            <h3>${escapeCatalogText(product.name)}</h3>
          </div>
          <div class="zaai-card-footer-row">
            <div class="zaai-card-price-block">
              <strong class="zaai-product-card-price">${salePrice.toLocaleString(english ? "en-US" : "ar-EG")} ${english ? "EGP" : "ج.م"}</strong>
              ${originalPrice > salePrice ? `<del class="zaai-product-card-original-price">${originalPrice.toLocaleString(english ? "en-US" : "ar-EG")} ${english ? "EGP" : "ج.م"}</del>` : ""}
            </div>
            <button class="zaai-card-footer-add" type="button" data-open-product="${Number(product.id)}" aria-label="${english ? `View ${escapeCatalogText(product.name)} details` : `عرض تفاصيل ${escapeCatalogText(product.name)}`}">
              <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </article>`;
    }).join("");

    container.querySelectorAll(".zaai-product-card").forEach((card) => {
      const product = storeCatalog.find((item) => item.id === Number(card.dataset.productId));
      if (!product) return;
      const colors = normalizeCatalogColors(product.colors, product.stock);
      setupCardImageGallery(card, getCardProductImages(product, colors));
    });
  });
}

function loadStoreProducts(attempt = 0) {
  storeCatalogLoaded = false;
  storeCatalogError = "";
  renderStoreProducts();

  fetch(storeApiUrl("/api/store/products"), {
    cache: "no-store"
  })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Products unavailable (${response.status})`)))
    .then((products) => {
      if (!Array.isArray(products)) throw new Error("Invalid product catalog response");
      storeCatalog = products;
      storeCatalogLoaded = true;
      storeCatalogError = "";
      renderStoreProducts();
      document.dispatchEvent(new CustomEvent("zaai:catalog-loaded", { detail: products }));
      if (new URLSearchParams(window.location.search).get("openProduct") === "1" && products.length) {
        window.setTimeout(() => openProductExperience(products[0].id), 250);
      }
    })
    .catch((error) => {
      console.error("Could not load the ZAAI product catalog.", error);
      if (attempt < 2) {
        window.setTimeout(() => loadStoreProducts(attempt + 1), 1000 * (attempt + 1));
        return;
      }
      storeCatalogLoaded = true;
      storeCatalogError = window.location.protocol === "file:" ? "file" : "request";
      renderStoreProducts();
    });
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-catalog]")) loadStoreProducts();
});

function openProductExperience(productId, sourceElement) {
  const product = storeCatalog.find((item) => item.id === Number(productId));
  if (!product) return;
  if (window.location.pathname !== `/product/${product.id}`) {
    window.history.pushState({ zaaiProduct: product.id, source: "catalog" }, "", `/product/${encodeURIComponent(product.id)}`);
  }

  const english = document.documentElement.lang === "en";
  let overlay = document.getElementById("zaai-product-experience-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "zaai-product-experience-overlay";
    overlay.className = "zaai-product-experience-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    document.body.appendChild(overlay);
  }

  const colors = normalizeCatalogColors(product.colors, product.stock);
  const sizes = normalizeCatalogSizes(product.sizes, product.stock);
  const images = getCardProductImages(product, colors);
  const primaryImage = images[0] || "";
  const salePrice = Number(product.sale_price) || 0;
  const originalPrice = Number(product.original_price) || 0;
  let activeColor = colors[0] || null;
  let selectedSize = "";
  let quantity = 1;

  overlay.innerHTML = `
    <div class="zaai-product-experience-shell">
      <header class="zaai-product-experience-mobile-header">
        <button type="button" class="zaai-product-experience-close" data-close-product aria-label="${english ? "Close" : "إغلاق"}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        <span>ZAAI</span>
        <button type="button" class="zaai-product-experience-bag" data-open-existing-cart aria-label="${english ? "Open bag" : "فتح السلة"}"><i class="fa-solid fa-bag-shopping" aria-hidden="true"></i></button>
      </header>
      <div class="zaai-product-experience-gallery">
        <button type="button" class="zaai-product-experience-close zaai-product-experience-close-desktop" data-close-product aria-label="${english ? "Close" : "إغلاق"}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        <div class="zaai-product-experience-main-image">
          ${primaryImage ? `<img id="zaai-experience-main-image" src="${escapeCatalogText(primaryImage)}" alt="${escapeCatalogText(product.name)}" decoding="async">` : ""}
        </div>
        ${images.length > 1 ? `<div class="zaai-product-experience-thumbs">${images.map((image, index) => `<button type="button" data-gallery-image="${escapeCatalogText(image)}" class="${index === 0 ? "is-active" : ""}" aria-label="${english ? `View image ${index + 1}` : `عرض الصورة ${index + 1}`}"><img src="${escapeCatalogText(image)}" alt="" loading="lazy" decoding="async"></button>`).join("")}</div>` : ""}
      </div>
      <section class="zaai-product-experience-info" dir="${english ? "ltr" : "rtl"}">
        <div class="zaai-product-experience-content">
          <span class="zaai-product-experience-kicker">${english ? "ZAAI COLLECTION" : "مجموعة ZAAI"}</span>
          <h2>${escapeCatalogText(product.name)}</h2>
          <div class="zaai-product-experience-price">
            <strong>${salePrice.toLocaleString(english ? "en-US" : "ar-EG")} ${english ? "EGP" : "ج.م"}</strong>
            ${originalPrice > salePrice ? `<del>${originalPrice.toLocaleString(english ? "en-US" : "ar-EG")} ${english ? "EGP" : "ج.م"}</del>` : ""}
          </div>
          ${product.description ? `<p class="zaai-product-experience-description">${escapeCatalogText(product.description)}</p>` : ""}
          ${colors.length ? `<div class="zaai-product-experience-option">
            <div class="zaai-product-experience-option-heading"><span>${english ? "COLOR" : "اللون"}</span><strong data-selected-color>${english ? activeColor.nameEn : activeColor.nameAr}</strong></div>
            <div class="zaai-product-experience-colors" role="radiogroup" aria-label="${english ? "Choose color" : "اختر اللون"}">
              ${colors.map((color, index) => `<button type="button" class="zaai-product-experience-swatch ${index === 0 ? "is-active" : ""}" data-color-index="${index}" role="radio" aria-checked="${index === 0}" aria-label="${english ? escapeCatalogText(color.nameEn) : escapeCatalogText(color.nameAr)}" style="--zaai-swatch:${escapeCatalogText(color.hex || color.value || "#050505")}"><span></span></button>`).join("")}
            </div>
          </div>` : ""}
          ${sizes.length ? `<div class="zaai-product-experience-option">
            <div class="zaai-product-experience-option-heading"><span>${english ? "SIZE" : "المقاس"}</span><button type="button" class="zaai-product-experience-size-guide"><i class="fa-solid fa-ruler-combined" aria-hidden="true"></i><span>${english ? "SIZE GUIDE" : "دليل المقاسات"}</span></button></div>
            <div class="zaai-product-experience-sizes" role="radiogroup" aria-label="${english ? "Choose size" : "اختر المقاس"}">
              ${sizes.map((size) => `<button type="button" class="zaai-product-experience-size" data-size="${escapeCatalogText(size.name)}" ${size.available ? "" : "disabled"} aria-checked="false" role="radio">${escapeCatalogText(size.name)}</button>`).join("")}
            </div>
          </div>` : ""}
          <div class="zaai-product-experience-quantity">
            <span>${english ? "QUANTITY" : "الكمية"}</span>
            <div><button type="button" data-quantity-minus aria-label="${english ? "Decrease quantity" : "تقليل الكمية"}">−</button><strong data-experience-quantity>1</strong><button type="button" data-quantity-plus aria-label="${english ? "Increase quantity" : "زيادة الكمية"}">+</button></div>
          </div>
          <p class="zaai-product-experience-validation" data-experience-validation aria-live="polite"></p>
        </div>
        <div class="zaai-product-experience-buy">
          <button type="button" class="zaai-product-experience-favorite" aria-label="${english ? "Add to favorites" : "إضافة إلى المفضلة"}">
            <i class="fa-regular fa-heart" aria-hidden="true"></i>
          </button>
          <button type="button" class="zaai-product-experience-add" data-experience-add dir="auto">
            <span data-ar="أضف إلى السلة" data-en="ADD TO BAG">${english ? "ADD TO BAG" : "أضف إلى السلة"}</span><i class="fa-solid fa-bag-shopping" aria-hidden="true"></i>
          </button>
        </div>
      </section>
    </div>`;

  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  overlay.querySelector("[data-close-product]")?.focus();

  let mainImage = overlay.querySelector("#zaai-experience-main-image");
  const detailGalleryImages = Array.isArray(images) ? images : [];
  let detailActiveIndex = 0;
  let detailTransitioning = false;
  let detailTouchStartX = 0;
  let detailTouchStartY = 0;
  let detailTouchActive = false;

  function setDetailActiveImage(nextIndex, direction = 1) {
    if (!mainImage || detailTransitioning) return;
    const safeIndex = Math.max(0, Math.min(detailGalleryImages.length - 1, nextIndex));
    if (detailGalleryImages.length && safeIndex === detailActiveIndex) return;
    const nextSource = detailGalleryImages[safeIndex];
    if (!nextSource) return;

    detailTransitioning = true;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      mainImage.src = nextSource;
      detailActiveIndex = safeIndex;
      detailTransitioning = false;
    } else {
      const incoming = document.createElement("img");
      incoming.src = nextSource;
      incoming.alt = mainImage.alt;
      incoming.decoding = "async";
      incoming.className = "zaai-product-experience-incoming";
      incoming.style.setProperty("--gallery-direction", direction >= 0 ? "24px" : "-24px");
      mainImage.parentElement.appendChild(incoming);

      mainImage.animate([
        { opacity: 1, transform: "scale(1) translateX(0)" },
        { opacity: 0, transform: `scale(.985) translateX(${direction >= 0 ? "-14px" : "14px"})` }
      ], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });
      incoming.animate([
        { opacity: 0, transform: `scale(1.015) translateX(${direction >= 0 ? "24px" : "-24px"})` },
        { opacity: 1, transform: "scale(1) translateX(0)" }
      ], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });

      window.setTimeout(() => {
        incoming.className = "";
        incoming.id = "zaai-experience-main-image";
        incoming.removeAttribute("style");
        mainImage.replaceWith(incoming);
        mainImage = incoming;
        detailActiveIndex = safeIndex;
        detailTransitioning = false;
      }, 390);
    }

    overlay.querySelectorAll("[data-gallery-image]").forEach((item, index) => {
      const active = index === safeIndex;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-current", active ? "true" : "false");
    });
  }

  overlay.querySelectorAll("[data-gallery-image]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = detailGalleryImages.indexOf(button.dataset.galleryImage);
      if (index >= 0) setDetailActiveImage(index, index >= detailActiveIndex ? 1 : -1);
    });
  });

  const detailGalleryStage = overlay.querySelector(".zaai-product-experience-main-image");
  detailGalleryStage?.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    detailTouchStartX = event.clientX;
    detailTouchStartY = event.clientY;
    detailTouchActive = true;
  }, { passive: true });
  detailGalleryStage?.addEventListener("pointerup", (event) => {
    if (!detailTouchActive) return;
    detailTouchActive = false;
    const deltaX = event.clientX - detailTouchStartX;
    const deltaY = event.clientY - detailTouchStartY;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    const nextIndex = detailActiveIndex + (deltaX < 0 ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= detailGalleryImages.length) return;
    setDetailActiveImage(nextIndex, deltaX < 0 ? 1 : -1);
  }, { passive: true });
  detailGalleryStage?.addEventListener("pointercancel", () => {
    detailTouchActive = false;
  }, { passive: true });

  overlay.querySelectorAll("[data-color-index]").forEach((button) => {
    button.addEventListener("click", () => {
      activeColor = colors[Number(button.dataset.colorIndex)];
      overlay.querySelectorAll("[data-color-index]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-checked", String(active));
      });
      setProductExperienceMessage("", "");
      const label = overlay.querySelector("[data-selected-color]");
      if (label) label.textContent = english ? activeColor.nameEn : activeColor.nameAr;
      if (activeColor.image && mainImage) {
        const colorImage = resolveStoreAssetUrl(activeColor.image);
        const matchingIndex = detailGalleryImages.indexOf(colorImage);
        if (matchingIndex >= 0) {
          setDetailActiveImage(matchingIndex, matchingIndex >= detailActiveIndex ? 1 : -1);
        } else {
          mainImage.classList.add("is-changing");
          window.setTimeout(() => {
            mainImage.src = colorImage;
            mainImage.classList.remove("is-changing");
            detailActiveIndex = -1;
            overlay.querySelectorAll("[data-gallery-image]").forEach((item) => {
              item.classList.remove("is-active");
              item.setAttribute("aria-current", "false");
            });
          }, 120);
        }
      }
    });
  });

  overlay.querySelectorAll("[data-size]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      selectedSize = button.dataset.size;
      overlay.querySelectorAll("[data-size]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-checked", String(active));
      });
      setProductExperienceMessage("", "");
    });
  });

  function updateQuantity(change) {
    const variantStock = activeColor?.stock;
    const sizeStock = sizes.find((size) => size.name === selectedSize)?.stock;
    const stock = [Number(variantStock), Number(sizeStock), Number(product.stock)]
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((lowest, value) => Math.min(lowest, value), Number(product.stock) > 0 ? Number(product.stock) : 999);
    quantity = Math.max(1, Math.min(stock || 999, quantity + change));
    overlay.querySelector("[data-experience-quantity]").textContent = String(quantity);
  }
  overlay.querySelector("[data-quantity-minus]")?.addEventListener("click", () => updateQuantity(-1));
  overlay.querySelector("[data-quantity-plus]")?.addEventListener("click", () => updateQuantity(1));

  overlay.querySelector(".zaai-product-experience-size-guide")?.addEventListener("click", () => {
    closeProductExperience(true);
    window.history.pushState({}, "", "/#size-guide");
    window.setTimeout(() => {
      document.getElementById("size-guide")?.scrollIntoView({ behavior:"smooth", block:"start" });
    }, 280);
  });
  overlay.querySelector("[data-open-existing-cart]")?.addEventListener("click", () => {
    closeProductExperience();
    document.getElementById("header-cart")?.click();
  });

  overlay.querySelector(".zaai-product-experience-favorite")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.classList.toggle("is-active");
    const icon = button.querySelector("i");
    icon?.classList.toggle("fa-regular");
    icon?.classList.toggle("fa-solid");
  });

  overlay.querySelector("[data-experience-add]")?.addEventListener("click", (event) => {
    if (sizes.length && !selectedSize) {
      setProductExperienceMessage(english ? "Please choose an available size." : "يرجى اختيار مقاس متاح.", "error");
      return;
    }
    if (colors.length && !activeColor) {
      setProductExperienceMessage(english ? "Please choose an available color." : "يرجى اختيار لون متاح.", "error");
      return;
    }
    const addButton = event.currentTarget;
    addButton.classList.remove("is-success");
    document.dispatchEvent(new CustomEvent("zaai:cart-add", {
      detail: {
        productId: product.id,
        colorIndex: activeColor?.index ?? 0,
        size: selectedSize || (english ? "One size" : "مقاس موحد"),
        quantity
      }
    }));
  });

  overlay.querySelectorAll("[data-close-product]").forEach((button) => button.addEventListener("click", closeProductExperience));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeProductExperience();
  });
  overlay.querySelector(".zaai-product-experience-shell")?.animate(
    [{ transform: "translateY(18px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }],
    { duration: 420, easing: "cubic-bezier(.16,1,.3,1)" }
  );
}

function closeProductExperience(skipHistory = false) {
  const overlay = document.getElementById("zaai-product-experience-overlay");
  if (!overlay) return;
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");
  document.body.style.removeProperty("overflow");
  window.setTimeout(() => {
    if (overlay.isConnected && !overlay.classList.contains("is-open")) overlay.remove();
  }, 260);
  if (!skipHistory && window.history.state?.zaaiProduct) {
    window.history.back();
  } else if (!skipHistory && window.location.pathname.startsWith("/product/")) {
    window.location.assign("/");
  }
}

function animateCardProductToCart(button, card) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const image = card?.querySelector(".zaai-product-card-open img");
  const target = document.getElementById("header-cart") || document.getElementById("zaai-mobile-nav-bag");
  if (!image || !target || typeof image.animate !== "function") return;
  const imageRect = image.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (!imageRect.width || !targetRect.width) return;
  const flight = document.createElement("img");
  flight.className = "zaai-product-flight";
  flight.src = image.currentSrc || image.src;
  Object.assign(flight.style, {
    position:"fixed",
    zIndex:"9999",
    top:`${imageRect.top + imageRect.height * .42}px`,
    left:`${imageRect.left + imageRect.width * .42}px`,
    width:`${Math.max(80, imageRect.width * .16)}px`,
    height:`${Math.max(100, imageRect.height * .16)}px`,
    borderRadius:"12px",
    objectFit:"cover",
    pointerEvents:"none"
  });
  document.body.appendChild(flight);
  const deltaX = targetRect.left + targetRect.width / 2 - (imageRect.left + imageRect.width / 2);
  const deltaY = targetRect.top + targetRect.height / 2 - (imageRect.top + imageRect.height / 2);
  const animation = flight.animate([
    { transform:"translate(0,0) scale(1)", opacity:1 },
    { transform:`translate(${deltaX}px,${deltaY}px) scale(.12)`, opacity:.25 }
  ], { duration:700, easing:"cubic-bezier(.22,.75,.2,1)" });
  animation.addEventListener("finish", () => {
    flight.remove();
    button.classList.remove("is-success");
    void button.offsetWidth;
    button.classList.add("is-success");
    target.classList.add("is-receiving");
    window.setTimeout(() => target.classList.remove("is-receiving"), 650);
  }, { once:true });
  animation.addEventListener("cancel", () => flight.remove(), { once:true });
}

function setProductExperienceMessage(message, status) {
  const messageElement = document.querySelector("#zaai-product-experience-overlay.is-open [data-experience-validation]");
  if (!messageElement) return false;
  messageElement.classList.toggle("is-success", status === "success");
  messageElement.classList.toggle("is-error", status === "error");
  if (status === "success") {
    messageElement.innerHTML = `
      <span class="zaai-product-experience-success-icon" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
      <span class="zaai-product-experience-success-text">${escapeCatalogText(message.replace(/^✓\s*/, ""))}</span>
    `;
  } else {
    messageElement.textContent = message;
  }
  if (status) {
    window.requestAnimationFrame(() => {
      const scrollContainer = messageElement.closest(".zaai-product-experience-content")
        || messageElement.closest(".zaai-product-experience-info");
      const addButton = document.querySelector("#zaai-product-experience-overlay.is-open [data-experience-add]");
      if (!scrollContainer || !addButton) return;
      const overlap = messageElement.getBoundingClientRect().bottom + 12 - addButton.getBoundingClientRect().top;
      if (overlap > 0) scrollContainer.scrollBy({ top: overlap, behavior: "smooth" });
    });
  }
  return true;
}

function animateProductToCart() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const overlay = document.getElementById("zaai-product-experience-overlay");
  const productImage = overlay?.querySelector(".zaai-product-experience-main-image img");
  const cartTargets = [
    overlay?.querySelector("[data-open-existing-cart]"),
    document.getElementById("header-cart"),
    document.getElementById("zaai-mobile-nav-bag")
  ];
  const cartTarget = cartTargets.find((target) => {
    const rect = target?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0;
  });

  if (!productImage || !cartTarget || !productImage.src || typeof productImage.animate !== "function") return;

  const imageRect = productImage.getBoundingClientRect();
  const cartIcon = cartTarget.querySelector("i") || cartTarget;
  const cartRect = cartIcon.getBoundingClientRect();
  if (!imageRect.width || !imageRect.height || !cartRect.width || !cartRect.height) return;

  const flight = document.createElement("img");
  flight.className = "zaai-product-flight";
  flight.src = productImage.currentSrc || productImage.src;
  flight.alt = "";
  flight.setAttribute("aria-hidden", "true");
  Object.assign(flight.style, {
    top: `${imageRect.top}px`,
    left: `${imageRect.left}px`,
    width: `${imageRect.width}px`,
    height: `${imageRect.height}px`
  });
  document.body.appendChild(flight);

  const deltaX = cartRect.left + cartRect.width / 2 - (imageRect.left + imageRect.width / 2);
  const deltaY = cartRect.top + cartRect.height / 2 - (imageRect.top + imageRect.height / 2);
  const animation = flight.animate([
    { transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1, borderRadius: "18px" },
    { transform: `translate(${deltaX * .72}px, ${deltaY * .72 - 18}px) scale(.46) rotate(-8deg)`, opacity: 1, offset: .58 },
    { transform: `translate(${deltaX}px, ${deltaY}px) scale(.08) rotate(5deg)`, opacity: .18, borderRadius: "50%" }
  ], { duration: 780, easing: "cubic-bezier(.22,.75,.2,1)" });

  animation.addEventListener("finish", () => {
    flight.remove();
    cartTarget.classList.remove("is-receiving");
    void cartTarget.offsetWidth;
    cartTarget.classList.add("is-receiving");
  }, { once: true });
  animation.addEventListener("cancel", () => flight.remove(), { once: true });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.getElementById("zaai-product-experience-overlay")?.classList.contains("is-open")) {
    closeProductExperience();
  }
});

document.addEventListener("click", (event) => {
  const favorite = event.target.closest(".zaai-card-favorite");
  if (favorite) {
    favorite.classList.toggle("is-active");
    const icon = favorite.querySelector("i");
    icon?.classList.toggle("fa-regular");
    icon?.classList.toggle("fa-solid");
    return;
  }
  const cardAdd = event.target.closest("[data-card-add]");
  const openButton = event.target.closest("[data-open-product]");
  if (openButton) {
    event.preventDefault();
    openProductExperience(openButton.dataset.openProduct, openButton);
    return;
  }
  const card = event.target.closest(".zaai-product-card");
  if (!card || event.target.closest("button, a, input, select, textarea")) return;
  openProductExperience(card.dataset.productId, card);
});

document.addEventListener("keydown", (event) => {
  if ((event.key !== "Enter" && event.key !== " ") || !event.target.matches(".zaai-product-card")) return;
  event.preventDefault();
  openProductExperience(event.target.dataset.productId, event.target);
});

const directProductMatch = window.location.pathname.match(/^\/product\/(\d+)\/?$/);
if (directProductMatch) {
  let directProductOpened = false;
  const openDirectProduct = () => {
    if (directProductOpened || !storeCatalogLoaded) return;
    const productId = Number(directProductMatch[1]);
    if (!storeCatalog.some((product) => product.id === productId)) return;
    directProductOpened = true;
    openProductExperience(productId);
  };
  document.addEventListener("zaai:catalog-loaded", () => {
    openDirectProduct();
  }, { once: true });
  window.setTimeout(() => {
    openDirectProduct();
  }, 900);
  window.addEventListener("popstate", () => {
    const overlay = document.getElementById("zaai-product-experience-overlay");
    if (overlay && !window.location.pathname.startsWith("/product/")) closeProductExperience(true);
  });
}

const labels = {
  ar: { dark: "ليلي", light: "نهاري", enableDark: "تفعيل الوضع الليلي", enableLight: "تفعيل الوضع النهاري", openMenu: "فتح القائمة", closeMenu: "إغلاق القائمة" },
  en: { dark: "Dark", light: "Light", enableDark: "Enable dark mode", enableLight: "Enable light mode", openMenu: "Open menu", closeMenu: "Close menu" }
};

function setLanguage(language) {
  const selectedLanguage = language === "en" ? "en" : "ar";

  document.documentElement.lang = selectedLanguage;
  document.documentElement.dir = selectedLanguage === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-ar][data-en]").forEach((element) => {
    element.textContent = element.dataset[selectedLanguage];
  });
  document.querySelectorAll("[data-alt-ar][data-alt-en]").forEach((element) => {
    element.alt = element.dataset[`alt${selectedLanguage === "ar" ? "Ar" : "En"}`];
  });
  document.querySelector(".scroll-cue").setAttribute("aria-label", selectedLanguage === "ar" ? "اكتشف المزيد" : "Discover more");
  languageLabel.textContent = selectedLanguage === "ar" ? "EN" : "عربي";
  languageButton.setAttribute("aria-label", selectedLanguage === "ar" ? "Switch language to English" : "Switch language to Arabic");
  const mobileLanguageLabel = document.getElementById("mobile-language-label");
  if (mobileLanguageLabel) mobileLanguageLabel.textContent = selectedLanguage === "ar" ? "EN" : "عربي";
  updateThemeLabel(selectedLanguage);

  try {
    localStorage.setItem("zaai-language", selectedLanguage);
  } catch (error) {
    console.warn("Could not save the selected language.", error);
  }

  if (!window.zaaiDiscoveryInitialized) {
    window.zaaiDiscoveryInitialized = true;
    const discoverySection = document.querySelector(".style-discovery");

    if (discoverySection) {
    const productData = {
      men: {
        name: "ZAAI Scrub Set",
        price: "1,850 EGP",
        sizes: ["XS", "S", "M", "L", "XL"],
        colors: [
          { id: "royal", nameAr: "أزرق ملكي", nameEn: "Royal blue", hex: "#0f4fa3", image: "image/man/ازرق ملكي/ازرق ملكي.webp", sprite: "image/man/ازرق ملكي/ازرق ملكي 360 .webp", columns: 6, rows: 2, viewCount: 6, angles: [0, 45, 90, 180, 270, 315] },
          { id: "sky", nameAr: "أزرق سماوي", nameEn: "Sky blue", hex: "#69aee0", image: "image/man/ازرق سماوي/سماوي.webp", sprite: "image/man/ازرق سماوي/سماوي 360 درجة.webp", columns: 6, rows: 2, viewCount: 6, angles: [0, 45, 90, 180, 270, 315] },
          { id: "black", nameAr: "أسود", nameEn: "Black", hex: "#202124", image: "image/man/اسود/اسود.webp", sprite: "image/man/اسود/اسود 360.webp", columns: 6, rows: 2, viewCount: 6, angles: [0, 45, 90, 180, 270, 315] },
          { id: "wine", nameAr: "نبتي بنفسجي داكن", nameEn: "Dark wine", hex: "#4a2437", image: "image/man/النبيتي البنفسجي الداكن/النبيتي البنفسجي الداكن.webp", sprite: "image/man/النبيتي البنفسجي الداكن/النبيتي البنفسجي الداكن 360webp.webp", columns: 6, rows: 2, viewCount: 6, angles: [0, 45, 90, 180, 270, 315] },
          { id: "slate", nameAr: "رمادي مزرق", nameEn: "Blue grey", hex: "#626d79", image: "image/man/رمادي مزرق/رمادي مزرق.webp", sprite: "image/man/رمادي مزرق/رمادي مزرق 360.webp", columns: 6, rows: 2, viewCount: 6, angles: [0, 45, 90, 180, 270, 315] },
          { id: "light-royal", nameAr: "أزرق ملكي فاتح", nameEn: "Light royal", hex: "#799bd1", image: "image/man/ازرق ملكي فاتح/ازرق ملكي فاتح .webp", sprite: "image/man/ازرق ملكي فاتح/ازرق ملكي فاتح.webp", columns: 5, rows: 2, viewCount: 8, frameHeight: 0.9, angles: [0, 45, 90, 135, 180, 225, 270, 315] }
        ]
      },
      women: []
    };

    const tabs = Array.from(discoverySection.querySelectorAll("[data-discovery-tab]"));
    const panels = Array.from(discoverySection.querySelectorAll("[data-discovery-panel]"));
    const stage = document.getElementById("zaai-viewer-stage");
    const canvas = document.getElementById("zaai-360-image");
    const colorPicker = document.getElementById("zaai-color-picker");
    const selectedColorLabel = document.getElementById("zaai-selected-color");
    const sizeList = document.getElementById("zaai-size-list");
    let activeColor = 0;
    let productViewer = null;
    let changeToken = 0;

    function updateDiscoveryLanguage() {
      const english = document.documentElement.lang === "en";
      const color = productData.men.colors[activeColor];
      selectedColorLabel.textContent = english ? color.nameEn : color.nameAr;
      stage.setAttribute("aria-label", english ? "Drag to rotate the product 360 degrees" : "اسحب لتدوير المنتج بزاوية 360 درجة");
      canvas.setAttribute("aria-label", english
        ? `ZAAI medical scrub set in ${color.nameEn}`
        : `زي ZAAI الطبي باللون ${color.nameAr}`);
      colorPicker.querySelectorAll(".zaai-color-button").forEach((button, index) => {
        const selected = productData.men.colors[index];
        button.setAttribute("aria-label", english ? selected.nameEn : selected.nameAr);
      });
    }

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.discoveryTab;
        const tabIndex = tabs.indexOf(tab);
        tab.closest(".style-discovery-tabs")?.style.setProperty("--tab-index", String(tabIndex));
        tabs.forEach((item) => {
          const active = item === tab;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", String(active));
        });
        panels.forEach((panel) => {
          const active = panel.dataset.discoveryPanel === target;
          panel.classList.toggle("is-active", active);
          panel.hidden = !active;
          if (active) {
            panel.classList.remove("is-active");
            void panel.offsetWidth;
            panel.classList.add("is-active");
          }
        });
      });
    });

    productData.men.colors.forEach((color, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zaai-color-button";
      button.setAttribute("aria-label", color.nameAr);
      button.setAttribute("aria-pressed", "false");
      button.innerHTML = `<span style="background:${color.hex}"></span>`;
      button.addEventListener("click", () => selectColor(index));
      colorPicker.appendChild(button);
    });

    productData.men.sizes.forEach((size, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zaai-size-button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(index === 2));
      button.textContent = size;
      button.addEventListener("click", () => {
        sizeList.querySelectorAll(".zaai-size-button").forEach((item) => {
          item.classList.remove("is-active");
          item.setAttribute("aria-checked", "false");
        });
        button.classList.add("is-active");
        button.setAttribute("aria-checked", "true");
      });
      if (index === 2) button.classList.add("is-active");
      sizeList.appendChild(button);
    });

    let viewerErrorShown = false;

    function showViewerError(error) {
      if (viewerErrorShown) return;
      viewerErrorShown = true;
      stage.classList.remove("is-changing");
      stage.classList.add("is-error");
      const message = document.querySelector("#zaai-loading small");
      const localFileBlocked = window.location.protocol === "file:"
        || /tainted|insecure|origin/i.test(error?.message || "");
      const detail = String(error?.message || error || "Unknown viewer error").replace(/\s+/g, " ").slice(0, 120);
      if (message) message.textContent = localFileBlocked
        ? (document.documentElement.lang === "en"
          ? "Open this page through a local web server to load the 3D product views"
          : "افتح الصفحة عبر خادم محلي مثل Live Server لتحميل زوايا المنتج ثلاثية الأبعاد")
        : `${document.documentElement.lang === "en" ? "3D error" : "خطأ العارض"}: ${detail}`;
      console.error("ZAAI 3D product viewer failed to initialize.", error);
    }

    function loadProductColor(index) {
      const color = productData.men.colors[index];
      const token = ++changeToken;
      stage.classList.add("is-changing");
      stage.classList.remove("is-dragging");
      if (!productViewer) return;

      productViewer.setColor(color).then(() => {
        if (token === changeToken) stage.classList.remove("is-changing");
      }).catch(showViewerError);
    }
    function selectColor(index) {
      activeColor = index;
      colorPicker.querySelectorAll(".zaai-color-button").forEach((button, buttonIndex) => {
        const active = buttonIndex === index;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      updateDiscoveryLanguage();
      loadProductColor(index);
    }

    document.querySelector(".zaai-size-guide-link").addEventListener("click", () => {
      document.getElementById("size-guide")?.scrollIntoView({ behavior: "smooth" });
    });

    languageButton.addEventListener("click", () => {
      updateDiscoveryLanguage();
    });

    const geometryColor = productData.men.colors.find((color) => color.id === "royal") || productData.men.colors[0];
    productViewer = new window.ZAAI3DProductViewer(canvas, stage);
    productViewer.initialize(geometryColor, productData.men.colors[0]).catch(showViewerError);

    document.addEventListener("zaai:catalog-loaded", (event) => {
      const catalog = event.detail || [];
      let activeSpriteChanged = false;
      productData.men.colors.forEach((color, index) => {
        const variant = catalog
          .filter((product) => product.category === "men")
          .flatMap((product) => product.colors || [])
          .find((item) => item.id === color.id);
        if (!variant) return;
        if (index === activeColor && variant.sprite && variant.sprite !== color.sprite) {
          activeSpriteChanged = true;
        }
        Object.assign(color, variant);
        const swatch = colorPicker.children[index]?.querySelector("span");
        if (swatch) swatch.style.background = color.hex;
      });
      updateDiscoveryLanguage();
      if (activeSpriteChanged) loadProductColor(activeColor);
    });

    selectColor(0);
    updateDiscoveryLanguage();
  }
  }

  const zaaiCartDrawer = document.getElementById("zaai-cart-drawer");
  const zaaiCartOverlay = document.getElementById("zaai-cart-overlay");
  const zaaiCartClose = document.getElementById("zaai-cart-close");
  const zaaiHeaderCart = document.getElementById("header-cart");
  const zaaiHeaderCount = document.getElementById("header-cart-count");
  const zaaiCartItems = document.getElementById("zaai-cart-items");
  const zaaiCartEmpty = document.getElementById("zaai-cart-empty");
  const zaaiCartTotal = document.getElementById("zaai-cart-total");
  const zaaiCheckoutButton = document.getElementById("zaai-checkout-button");
  const zaaiCheckoutOverlay = document.getElementById("zaai-checkout-overlay");
  const zaaiCheckoutClose = document.getElementById("zaai-checkout-close");
  const zaaiCheckoutForm = document.getElementById("zaai-checkout-form");
  const zaaiCheckoutSummary = document.getElementById("zaai-checkout-summary");
  const zaaiOrderToast = document.getElementById("zaai-order-toast");

  if (!window.zaaiCartInitialized && zaaiCartDrawer && zaaiCartItems) {
    window.zaaiCartInitialized = true;
    let zaaiCart = [];

    try {
      zaaiCart = JSON.parse(localStorage.getItem("zaai-cart") || "[]");
    } catch (error) {
      zaaiCart = [];
    }

    const zaaiMansouraCoordinates = { lat: 31.0409, lng: 31.3785 };
    const zaaiGovernorateCoordinates = {
      Dakahlia: { lat: 31.0409, lng: 31.3785 },
      Gharbia: { lat: 30.7865, lng: 31.0004 },
      Sharqia: { lat: 30.5965, lng: 31.5020 },
      Cairo: { lat: 30.0444, lng: 31.2357 },
      Giza: { lat: 30.0131, lng: 31.2089 },
      Alexandria: { lat: 31.2001, lng: 29.9187 },
      Beheira: { lat: 31.0364, lng: 30.4680 },
      Damietta: { lat: 31.4165, lng: 31.8133 },
      "Kafr El Sheikh": { lat: 31.1117, lng: 30.9391 },
      Monufia: { lat: 30.5972, lng: 30.9876 },
      Qalyubia: { lat: 30.1790, lng: 31.2053 },
      "Port Said": { lat: 31.2653, lng: 32.3019 },
      Ismailia: { lat: 30.5965, lng: 32.2715 },
      Suez: { lat: 29.9737, lng: 32.5263 },
      Faiyum: { lat: 29.3084, lng: 30.8428 },
      "Beni Suef": { lat: 29.0661, lng: 31.0994 },
      Minya: { lat: 28.1099, lng: 30.7503 },
      Asyut: { lat: 27.1809, lng: 31.1837 },
      Sohag: { lat: 26.5560, lng: 31.6948 },
      Qena: { lat: 26.1642, lng: 32.7267 },
      Luxor: { lat: 25.6872, lng: 32.6396 },
      Aswan: { lat: 24.0889, lng: 32.8998 },
      "Red Sea": { lat: 27.2579, lng: 33.8116 },
      "New Valley": { lat: 25.4519, lng: 30.5463 },
      Matrouh: { lat: 31.3543, lng: 27.2373 },
      "North Sinai": { lat: 31.1317, lng: 33.7983 },
      "South Sinai": { lat: 28.5500, lng: 33.9740 }
    };

    function saveCart() {
      try {
        localStorage.setItem("zaai-cart", JSON.stringify(zaaiCart));
      } catch (error) {
        console.warn("Could not save the ZAAI cart.", error);
      }
    }

    function cartQuantity() {
      return zaaiCart.reduce((sum, item) => sum + item.quantity, 0);
    }

    function paidQuantity() {
      return zaaiCart.reduce((sum, item) => sum + (item.promotionGift ? 0 : item.quantity), 0);
    }

    function selectedGiftQuantity() {
      return zaaiCart.reduce((sum, item) => sum + (item.promotionGift ? item.quantity : 0), 0);
    }

    function calculateCartPricing() {
      const units = [];
      zaaiCart.forEach((item) => {
        const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
        const price = item.promotionGift
          ? 0
          : Number.isFinite(Number(item.price)) ? Math.max(0, Number(item.price)) : 800;
        for (let index = 0; index < quantity; index += 1) {
          units.push({ item, price, charge: price, promotionGift: Boolean(item.promotionGift) });
        }
      });

      const giftSlots = Math.floor(paidQuantity() / 5);
      const paidUnits = units.filter((unit) => !unit.promotionGift);
      const bundleCandidates = paidUnits.slice(giftSlots * 5);
      const bundles = [];

      for (let index = 0; index + 1 < bundleCandidates.length; index += 2) {
        const first = bundleCandidates[index];
        const second = bundleCandidates[index + 1];
        const regularTotal = first.price + second.price;
        first.charge = Math.round((1500 * first.price / regularTotal) * 100) / 100;
        second.charge = 1500 - first.charge;
        if (regularTotal > 1500) {
          bundles.push({ regularTotal, savings: regularTotal - 1500 });
        }
      }

      const lineTotals = new Map();
      units.forEach((unit) => {
        lineTotals.set(unit.item.key, (lineTotals.get(unit.item.key) || 0) + unit.charge);
      });
      const total = units.reduce((sum, unit) => sum + unit.charge, 0);

      return {
        units,
        lineTotals,
        total,
        giftSlots,
        giftsSelected: selectedGiftQuantity(),
        bundles,
        bundleSavings: bundles.reduce((sum, bundle) => sum + bundle.savings, 0)
      };
    }

    function cartTotal() {
      return calculateCartPricing().total;
    }

    function trimExcessGifts() {
      let availableSlots = Math.floor(paidQuantity() / 5);
      let removedCount = 0;
      zaaiCart = zaaiCart.filter((item) => {
        if (!item.promotionGift) return true;
        const keepQuantity = Math.min(item.quantity, availableSlots);
        availableSlots -= keepQuantity;
        removedCount += item.quantity - keepQuantity;
        item.quantity = keepQuantity;
        return keepQuantity > 0;
      });
      return removedCount;
    }

    function promotionMessages(pricing, english) {
      const messages = [];
      if (pricing.bundles.length) {
        messages.push(english
          ? `${pricing.bundles.length} two-product bundle(s): save ${pricing.bundleSavings.toLocaleString("en-US")} EGP`
          : `${pricing.bundles.length} باقة (منتجان بـ 1,500 ج.م): وفرت ${pricing.bundleSavings.toLocaleString("ar-EG")} ج.م`);
      }
      if (pricing.giftSlots) {
        const remaining = Math.max(0, pricing.giftSlots - pricing.giftsSelected);
        messages.push(english
          ? `${pricing.giftsSelected} of ${pricing.giftSlots} free gift(s) selected${remaining ? `; choose ${remaining} more` : ""}`
          : `تم اختيار ${pricing.giftsSelected} من ${pricing.giftSlots} هدية مجانية${remaining ? `؛ اختر ${remaining} أخرى` : ""}`);
      }
      return messages;
    }

    function renderGiftOptions(form, product) {
      const container = form.querySelector("[data-gift-variants]");
      const button = form.querySelector("[data-add-gift]");
      const sizes = Array.isArray(product.sizes) ? product.sizes : [];
      const colors = Array.isArray(product.colors)
        ? product.colors.filter((color) => typeof color === "string" || (color && typeof color === "object"))
        : [];
      const sizeOptions = sizes.length
        ? sizes.map((size) => `<option value="${escapeCatalogText(size)}">${escapeCatalogText(size)}</option>`).join("")
        : `<option value="">${document.documentElement.lang === "en" ? "One size" : "مقاس موحد"}</option>`;
      const colorSelect = colors.length
        ? `<label>${document.documentElement.lang === "en" ? "Color" : "اللون"}<select data-gift-color>${colors.map((color, index) => {
          const item = typeof color === "string" ? { nameAr: color, nameEn: color } : color;
          const label = document.documentElement.lang === "en"
            ? item.nameEn || item.nameAr || item.id || `Color ${index + 1}`
            : item.nameAr || item.nameEn || item.id || `لون ${index + 1}`;
          return `<option value="${index}">${escapeCatalogText(label)}</option>`;
        }).join("")}</select></label>`
        : "";
      container.innerHTML = `
        <label>${document.documentElement.lang === "en" ? "Size" : "المقاس"}<select data-gift-size>${sizeOptions}</select></label>
        ${colorSelect}
      `;
      button.disabled = false;
    }

    function renderGiftOffers(pricing, english) {
      const remaining = Math.max(0, pricing.giftSlots - pricing.giftsSelected);
      if (!pricing.giftSlots) return "";
      const summary = promotionMessages(pricing, english)
        .map((message) => `<p class="zaai-promotion-message">${escapeCatalogText(message)}</p>`)
        .join("");
      if (!remaining) return `<div class="zaai-cart-promotion-summary">${summary}</div>`;
      if (!storeCatalog.length) {
        return `<div class="zaai-cart-promotion-summary">${summary}<p>${english ? "The catalog is unavailable, so gifts cannot be selected right now." : "الكتالوج غير متاح حاليًا، لذلك لا يمكن اختيار الهدايا الآن."}</p></div>`;
      }

      const offers = Array.from({ length: remaining }, (_, index) => {
        const slot = pricing.giftsSelected + index + 1;
        const options = storeCatalog.map((product) =>
          `<option value="${Number(product.id)}">${escapeCatalogText(product.name)} — ${product.category === "women" ? (english ? "Women" : "نسائي") : (english ? "Men" : "رجالي")}</option>`
        ).join("");
        return `<div class="zaai-gift-offer" data-gift-slot="${slot}">
          <strong>${english ? `Choose free gift ${slot}` : `اختيار الهدية المجانية ${slot}`}</strong>
          <label>${english ? "Product" : "المنتج"}<select data-gift-product><option value="">${english ? "Choose a product" : "اختاري المنتج"}</option>${options}</select></label>
          <div class="zaai-gift-variants" data-gift-variants></div>
          <button type="button" class="zaai-gift-add" data-add-gift disabled>${english ? "Add free gift" : "إضافة الهدية المجانية"}</button>
        </div>`;
      }).join("");

      return `<div class="zaai-cart-promotion-summary">${summary}${offers}</div>`;
    }

    function addGiftFromOffer(form) {
      const productId = Number(form.querySelector("[data-gift-product]")?.value);
      const product = storeCatalog.find((item) => item.id === productId);
      const pricing = calculateCartPricing();
      if (!product || pricing.giftsSelected >= pricing.giftSlots) return;

      const colors = Array.isArray(product.colors)
        ? product.colors.filter((color) => typeof color === "string" || (color && typeof color === "object"))
        : [];
      const colorIndex = Number(form.querySelector("[data-gift-color]")?.value || 0);
      const selectedColor = colors[colorIndex];
      const color = typeof selectedColor === "string"
        ? { nameAr: selectedColor, nameEn: selectedColor }
        : selectedColor || {};
      const colorName = color.nameAr || color.nameEn || color.id || "";
      const size = form.querySelector("[data-gift-size]")?.value
        || (document.documentElement.lang === "en" ? "One size" : "مقاس موحد");
      const image = resolveStoreAssetUrl(
        (Array.isArray(product.images) && product.images[0]) || color.image || ""
      );

      zaaiCart.push({
        key: `gift-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        productId: product.id,
        product: product.name,
        price: 0,
        size,
        colorAr: color.nameAr || colorName,
        colorEn: color.nameEn || colorName,
        image,
        quantity: 1,
        promotionGift: true
      });
      saveCart();
      renderCart();
      showToast("تمت إضافة الهدية المجانية", "Free gift added", "اختر منتجاتك الأخرى لإتمام الطلب", "Choose your other products to complete your order");
    }

    function calculateGovernorateDistance(governorate) {
      if (!governorate || governorate === "Dakahlia") return 0;
      const destination = zaaiGovernorateCoordinates[governorate];
      if (!destination) return 0;
      const toRadians = (degrees) => degrees * Math.PI / 180;
      const earthRadiusKm = 6371;
      const latitudeDifference = toRadians(destination.lat - zaaiMansouraCoordinates.lat);
      const longitudeDifference = toRadians(destination.lng - zaaiMansouraCoordinates.lng);
      const first = Math.sin(latitudeDifference / 2) ** 2
        + Math.cos(toRadians(zaaiMansouraCoordinates.lat))
        * Math.cos(toRadians(destination.lat))
        * Math.sin(longitudeDifference / 2) ** 2;
      return Math.round(earthRadiusKm * 2 * Math.atan2(Math.sqrt(first), Math.sqrt(1 - first)));
    }

    function calculateDelivery(governorate) {
      if (!governorate) return { distance: 0, fee: 0 };
      if (governorate === "Dakahlia") return { distance: 0, fee: 0 };
      const distance = calculateGovernorateDistance(governorate);
      let fee = 120;
      if (distance <= 100) fee = 50;
      else if (distance <= 200) fee = 70;
      else if (distance <= 300) fee = 90;
      return { distance, fee };
    }

    function openCart() {
      zaaiCartOverlay.hidden = false;
      zaaiCartDrawer.classList.add("is-open");
      zaaiCartDrawer.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      const mobileBagCount = document.getElementById("zaai-mobile-bag-count");
      if (mobileBagCount) {
        mobileBagCount.classList.remove("is-bumping");
        void mobileBagCount.offsetWidth;
        mobileBagCount.classList.add("is-bumping");
      }
      zaaiCartClose.focus();
    }

    function closeCart() {
      zaaiCartDrawer.classList.remove("is-open");
      zaaiCartDrawer.setAttribute("aria-hidden", "true");
      zaaiCartOverlay.hidden = true;
      document.body.style.removeProperty("overflow");
    }

    if (window.matchMedia("(max-width: 760px)").matches) {
      let sheetStartY = 0;
      let sheetMovedY = 0;
      zaaiCartDrawer.addEventListener("touchstart", (event) => {
        sheetStartY = event.touches[0].clientY;
        sheetMovedY = 0;
      }, { passive: true });
      zaaiCartDrawer.addEventListener("touchmove", (event) => {
        sheetMovedY = Math.max(0, event.touches[0].clientY - sheetStartY);
        if (sheetMovedY > 0) zaaiCartDrawer.style.transform = `translateY(${sheetMovedY}px)`;
      }, { passive: true });
      zaaiCartDrawer.addEventListener("touchend", () => {
        if (sheetMovedY > 110) closeCart();
        zaaiCartDrawer.style.removeProperty("transform");
      }, { passive: true });
    }

    function showToast(titleAr, titleEn, detailAr, detailEn) {
      const english = document.documentElement.lang === "en";
      const title = zaaiOrderToast.querySelector("strong");
      const detail = zaaiOrderToast.querySelector("span");
      title.textContent = english ? titleEn : titleAr;
      detail.textContent = english ? detailEn : detailAr;
      zaaiOrderToast.classList.remove("is-cart-toast");
      zaaiOrderToast.classList.add("is-visible");
      window.clearTimeout(showToast.timeout);
      showToast.timeout = window.setTimeout(() => {
        zaaiOrderToast.classList.remove("is-visible");
        zaaiOrderToast.classList.remove("is-cart-toast");
      }, 3200);
    }

    function renderCart() {
      const quantity = cartQuantity();
      const english = document.documentElement.lang === "en";
      const pricing = calculateCartPricing();
      zaaiHeaderCount.textContent = String(paidQuantity());
      const mobileBagCount = document.getElementById("zaai-mobile-bag-count");
      if (mobileBagCount) mobileBagCount.textContent = String(quantity);
      zaaiHeaderCart.setAttribute("aria-label", english ? `Open bag, ${quantity} items` : `فتح السلة، ${quantity} قطع`);
      zaaiCartEmpty.classList.toggle("is-hidden", zaaiCart.length > 0);
      zaaiCartItems.innerHTML = "";

      zaaiCart.forEach((item) => {
        const row = document.createElement("article");
        row.className = "zaai-cart-item";
        const isGift = Boolean(item.promotionGift);
        const lineTotal = pricing.lineTotals.get(item.key) || 0;
        const color = english
          ? item.colorEn || item.colorAr || "Not selected"
          : item.colorAr || item.colorEn || "غير محدد";
        row.innerHTML = `
          <img class="zaai-cart-item-image" src="${escapeCatalogText(resolveStoreAssetUrl(item.image || ""))}" alt="">
          <button class="zaai-cart-remove" type="button" data-remove="${escapeCatalogText(item.key)}" aria-label="${english ? "Remove item" : "إزالة المنتج"}">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
          <div>
            <h3>${escapeCatalogText(item.product || "ZAAI Scrub Set")}${isGift ? `<span class="zaai-gift-badge">${english ? "Free gift" : "هدية مجانية"}</span>` : ""}</h3>
            <p class="zaai-cart-item-meta">${english ? "Color" : "اللون"}: ${escapeCatalogText(color)} · ${english ? "Size" : "المقاس"}: ${escapeCatalogText(item.size || "")}</p>
            <strong class="zaai-cart-item-price">${isGift
              ? (english ? "FREE" : "مجاني")
              : `${english ? "EGP" : "ج.م"} ${lineTotal.toLocaleString(english ? "en-US" : "ar-EG")}`}</strong>
          </div>
          <div class="zaai-cart-quantity" aria-label="${english ? "Quantity" : "الكمية"}">
            ${isGift
              ? `<span>${item.quantity}</span>`
              : `<button type="button" data-cart-minus="${escapeCatalogText(item.key)}" aria-label="${english ? "Decrease quantity" : "تقليل الكمية"}">−</button>
                <span>${item.quantity}</span>
                <button type="button" data-cart-plus="${escapeCatalogText(item.key)}" aria-label="${english ? "Increase quantity" : "زيادة الكمية"}">+</button>`}
          </div>
        `;
        zaaiCartItems.appendChild(row);
      });

      const promoContent = renderGiftOffers(pricing, english);
      if (promoContent) zaaiCartItems.insertAdjacentHTML("beforeend", promoContent);

      zaaiCartItems.querySelectorAll("[data-cart-plus]").forEach((button) => {
        button.addEventListener("click", () => updateItem(button.dataset.cartPlus, 1));
      });
      zaaiCartItems.querySelectorAll("[data-cart-minus]").forEach((button) => {
        button.addEventListener("click", () => updateItem(button.dataset.cartMinus, -1));
      });
      zaaiCartItems.querySelectorAll("[data-remove]").forEach((button) => {
        button.addEventListener("click", () => {
          const removedItem = zaaiCart.find((item) => item.key === button.dataset.remove);
          zaaiCart = zaaiCart.filter((item) => item.key !== button.dataset.remove);
          const removedGifts = removedItem && !removedItem.promotionGift ? trimExcessGifts() : 0;
          saveCart();
          renderCart();
          if (removedGifts) {
            showToast("تمت إزالة هدية لعدم اكتمال العرض", "A gift was removed because the offer no longer applies", "أضيفي 5 منتجات مدفوعة لاختيار هدية أخرى", "Add 5 paid products to choose another gift");
          }
        });
      });

      const total = pricing.total;
      zaaiCartTotal.textContent = english ? `EGP ${total.toLocaleString("en-US")}` : `${total.toLocaleString("ar-EG")} ج.م`;
      zaaiCheckoutButton.disabled = quantity === 0;
    }

    function updateItem(key, change) {
      const item = zaaiCart.find((entry) => entry.key === key);
      if (!item || item.promotionGift) return;
      item.quantity += change;
      if (item.quantity <= 0) {
        zaaiCart = zaaiCart.filter((entry) => entry.key !== key);
      }
      const removedGifts = change < 0 ? trimExcessGifts() : 0;
      saveCart();
      renderCart();
      if (removedGifts) {
        showToast("تمت إزالة هدية لعدم اكتمال العرض", "A gift was removed because the offer no longer applies", "أضيفي 5 منتجات مدفوعة لاختيار هدية أخرى", "Add 5 paid products to choose another gift");
      }
    }

    zaaiHeaderCart.addEventListener("click", openCart);
    zaaiCartClose.addEventListener("click", closeCart);
    zaaiCartOverlay.addEventListener("click", closeCart);

    zaaiCartItems.addEventListener("change", (event) => {
      const select = event.target.closest("[data-gift-product]");
      if (!select) return;
      const form = select.closest("[data-gift-slot]");
      const product = storeCatalog.find((item) => item.id === Number(select.value));
      const button = form.querySelector("[data-add-gift]");
      if (!product) {
        form.querySelector("[data-gift-variants]").innerHTML = "";
        button.disabled = true;
        return;
      }
      renderGiftOptions(form, product);
    });

    zaaiCartItems.addEventListener("click", (event) => {
      const button = event.target.closest("[data-add-gift]");
      if (!button) return;
      addGiftFromOffer(button.closest("[data-gift-slot]"));
    });

    document.addEventListener("zaai:cart-add", (event) => {
      const detail = event.detail || {};
      const product = storeCatalog.find((item) => item.id === Number(detail.productId));
      if (!product) return;
      const english = document.documentElement.lang === "en";
      const colors = normalizeCatalogColors(product.colors, product.stock);
      const selectedColorIndex = Number(detail.colorIndex || 0);
      const selectedColor = colors[selectedColorIndex];
      const color = typeof selectedColor === "string"
        ? { nameAr: selectedColor, nameEn: selectedColor }
        : selectedColor || {};
      const colorName = color.nameAr || color.nameEn || color.id || "";
      const size = detail.size || (document.documentElement.lang === "en" ? "One size" : "مقاس موحد");
      const quantity = Math.max(1, Math.floor(Number(detail.quantity) || 1));
      const stock = Math.max(0, Number(product.stock) || 0);
      const variantStock = Number(color.stock);
      const sizeOption = normalizeCatalogSizes(product.sizes, product.stock).find((item) => item.name === size);
      const sizeStock = Number(sizeOption?.stock);
      if (stock <= 0
        || (sizeOption?.stock != null && Number.isFinite(sizeStock) && sizeStock <= 0)
        || (selectedColor?.stock != null && Number.isFinite(variantStock) && variantStock <= 0)) {
        const message = english
          ? "This selection is currently unavailable. Please choose another option."
          : "هذا الاختيار غير متاح حاليًا، يرجى اختيار خيارات أخرى.";
        if (!setProductExperienceMessage(message, "error")) {
          showToast("الكمية المطلوبة غير متوفرة", "Requested quantity unavailable", "هذا الاختيار غير متاح حاليًا", "This selection is currently unavailable");
        }
        return;
      }
      const availableStock = Number.isFinite(variantStock) && variantStock > 0
        ? variantStock
        : Number.isFinite(sizeStock) && sizeStock > 0
          ? sizeStock
          : stock > 0 ? stock : 999;
      const productImage = resolveStoreAssetUrl(
        color.image
        || (Array.isArray(product.images) && product.images[0])
        || ""
      );
      const key = `${product.id}-${selectedColorIndex}-${size}`;
      const existing = zaaiCart.find((item) => item.key === key);
      const currentQuantity = existing ? existing.quantity : 0;
      const nextQuantity = Math.min(availableStock, currentQuantity + quantity);
      if (nextQuantity <= currentQuantity) {
        const message = english
          ? "The available stock limit has been reached."
          : "تم الوصول إلى الحد المتاح من المخزون.";
        if (!setProductExperienceMessage(message, "error")) {
          showToast("الكمية المطلوبة غير متوفرة", "Requested quantity unavailable", "تم الوصول إلى الحد المتاح من المخزون", "The available stock limit has been reached");
        }
        return;
      }
      if (existing) {
        existing.quantity = nextQuantity;
      } else {
        zaaiCart.push({
          key,
          productId: product.id,
          product: product.name,
          price: Number(product.sale_price) || 0,
          size,
          colorAr: color.nameAr || colorName,
          colorEn: color.nameEn || colorName,
          image: productImage,
          quantity: nextQuantity
        });
      }
      saveCart();
      renderCart();
      animateProductToCart();
      const experienceMessageShown = setProductExperienceMessage(
        english ? "✓ Added to your bag" : "✓ تمت الإضافة إلى السلة",
        "success"
      );
      if (!experienceMessageShown) {
        showToast("تمت إضافة طلبك إلى السلة", "ADDED TO YOUR BAG", "تمت الإضافة بنجاح", "The product has been added successfully.");
        const toastCartButton = zaaiOrderToast.querySelector("[data-open-toast-cart]");
        if (toastCartButton) {
          toastCartButton.textContent = english ? "View bag" : "عرض السلة";
          zaaiOrderToast.classList.add("is-cart-toast");
          toastCartButton.onclick = () => {
            zaaiOrderToast.classList.remove("is-visible");
            openCart();
          };
        }
      }
      const experienceAddButton = document.querySelector("#zaai-product-experience-overlay.is-open [data-experience-add]");
      if (experienceAddButton) {
        experienceAddButton.classList.remove("is-success");
        void experienceAddButton.offsetWidth;
        experienceAddButton.classList.add("is-success");
        window.clearTimeout(experienceAddButton.zaaiResetSuccess);
        experienceAddButton.zaaiResetSuccess = window.setTimeout(() => {
          experienceAddButton.classList.remove("is-success");
          const icon = experienceAddButton.querySelector("i");
          if (icon) {
            icon.className = "fa-solid fa-bag-shopping";
          }
        }, 1800);
      }
      const headerCount = document.getElementById("header-cart-count");
      const mobileCount = document.getElementById("zaai-mobile-bag-count");
      [headerCount, mobileCount].forEach((count) => {
        if (!count) return;
        count.classList.remove("is-bumping");
        void count.offsetWidth;
        count.classList.add("is-bumping");
      });
      const bagButton = document.querySelector(
        "#zaai-product-experience-overlay.is-open [data-open-existing-cart]"
      );
      if (bagButton) {
        bagButton.classList.remove("is-receiving");
        void bagButton.offsetWidth;
        bagButton.classList.add("is-receiving");
      }
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest(".zaai-add-button[data-product-id]");
      if (!button) return;
      const card = button.closest(".zaai-product-card");
      const product = storeCatalog.find((item) => item.id === Number(button.dataset.productId));
      if (!card || !product) return;
      const size = card.querySelector(".zaai-product-size")?.value
        || (document.documentElement.lang === "en" ? "One size" : "مقاس موحد");
      const selectedColorIndex = Number(card.querySelector(".zaai-product-color")?.value || 0);
      const colors = Array.isArray(product.colors)
        ? product.colors.filter((color) => typeof color === "string" || (color && typeof color === "object"))
        : [];
      const selectedColor = colors[selectedColorIndex];
      const color = typeof selectedColor === "string"
        ? { nameAr: selectedColor, nameEn: selectedColor }
        : selectedColor || {};
      const colorName = color.nameAr || color.nameEn || color.id || "";
      const productImage = resolveStoreAssetUrl(
        (Array.isArray(product.images) && product.images[0]) || color.image || ""
      );
      const key = `${product.id}-${selectedColorIndex}-${size}`;
      const existing = zaaiCart.find((item) => item.key === key);
      if (existing) {
        existing.quantity += 1;
      } else {
        zaaiCart.push({
          key,
          productId: product.id,
          product: product.name,
          price: Number(product.sale_price) || 0,
          size,
          colorAr: color.nameAr || colorName,
          colorEn: color.nameEn || colorName,
          image: productImage,
          quantity: 1
        });
      }
      saveCart();
      renderCart();
      showToast("تم إضافة طلبك إلى السلة", "Added to your bag", "أكمل اختيار المنتجات أو انتقل لإتمام الطلب", "Choose more products or proceed to checkout");
    });

    function openCheckout() {
      if (cartQuantity() === 0) return;
      const english = document.documentElement.lang === "en";
      updateCheckoutSummary();
      closeCart();
      zaaiCheckoutOverlay.hidden = false;
      document.getElementById("zaai-customer-name").focus();
    }

    function updateCheckoutSummary() {
      const english = document.documentElement.lang === "en";
      const governorateSelect = document.getElementById("zaai-delivery-governorate");
      const governorate = governorateSelect?.value || "";
      const delivery = calculateDelivery(governorate);
      const productsTotal = cartTotal();
      const grandTotal = productsTotal + delivery.fee;
      const deliveryLabel = !governorate
        ? (english ? "Select governorate" : "اختر المحافظة")
        : governorate === "Dakahlia"
          ? (english ? "Free — Dakahlia" : "مجاني — الدقهلية")
          : `${english ? "Approximately" : "تقريبًا"} ${delivery.distance} ${english ? "km" : "كم"} — ${delivery.fee} ${english ? "EGP" : "ج.م"}`;

      zaaiCheckoutSummary.innerHTML = zaaiCart.map((item) => `
        <span>${item.quantity} × ${escapeCatalogText(item.product || "ZAAI Scrub Set")} — ${escapeCatalogText(english ? item.colorEn || item.colorAr || "" : item.colorAr || item.colorEn || "")} — ${english ? "Size" : "المقاس"} ${escapeCatalogText(item.size || "")}${item.promotionGift ? ` — ${english ? "Free" : "هدية مجانية"}` : ""}</span>
      `).join("")
        + `<span>${english ? "Products" : "المنتجات"}: ${productsTotal.toLocaleString(english ? "en-US" : "ar-EG")} ${english ? "EGP" : "ج.م"}</span>`
        + `<span>${english ? "Delivery" : "التوصيل"}: ${deliveryLabel}</span>`
        + `<strong>${english ? "Total" : "الإجمالي"}: ${grandTotal.toLocaleString(english ? "en-US" : "ar-EG")} ${english ? "EGP" : "ج.م"}</strong>`;
    }

    zaaiCheckoutButton.addEventListener("click", openCheckout);
    zaaiCheckoutClose.addEventListener("click", () => { zaaiCheckoutOverlay.hidden = true; });
    zaaiCheckoutOverlay.addEventListener("click", (event) => {
      if (event.target === zaaiCheckoutOverlay) zaaiCheckoutOverlay.hidden = true;
    });
    document.getElementById("zaai-delivery-governorate").addEventListener("change", updateCheckoutSummary);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (zaaiCheckoutOverlay.hidden === false) zaaiCheckoutOverlay.hidden = true;
      else if (zaaiCartDrawer.classList.contains("is-open")) closeCart();
    });

    zaaiCheckoutForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = document.getElementById("zaai-customer-name").value.trim();
      const phone = document.getElementById("zaai-customer-phone").value.trim();
      const address = document.getElementById("zaai-customer-address").value.trim();
      const governorateSelect = document.getElementById("zaai-delivery-governorate");
      const governorate = governorateSelect.value;
      if (!name || !phone || !address || !governorate) return;

      const english = document.documentElement.lang === "en";
      const delivery = calculateDelivery(governorate);
      const governorateLabel = governorateSelect.options[governorateSelect.selectedIndex].textContent;
      const grandTotal = cartTotal() + delivery.fee;
      const itemsMessage = zaaiCart.map((item) =>
        `- ${item.product || "ZAAI Scrub Set"} | ${english ? item.colorEn || item.colorAr : item.colorAr || item.colorEn} | ${english ? "Size" : "المقاس"} ${item.size} | ${english ? "Qty" : "الكمية"} ${item.quantity}${item.promotionGift ? ` | ${english ? "Free gift" : "هدية مجانية"}` : ""}`
      ).join("\n");
      const message = [
        english ? "New ZAAI order" : "طلب ZAAI جديد",
        `${english ? "Name" : "الاسم"}: ${name}`,
        `${english ? "Phone" : "رقم الهاتف"}: ${phone}`,
        `${english ? "Governorate" : "المحافظة"}: ${governorateLabel}`,
        `${english ? "Address" : "العنوان"}: ${address}`,
        "",
        english ? "Items:" : "المنتجات:",
        itemsMessage,
        "",
        `${english ? "Products" : "المنتجات"}: ${cartTotal()} ${english ? "EGP" : "ج.م"}`,
        `${english ? "Delivery" : "التوصيل"}: ${delivery.fee === 0 ? (english ? "Free" : "مجاني") : `${delivery.distance} ${english ? "km" : "كم"} — ${delivery.fee} ${english ? "EGP" : "ج.م"}`}`,
        `${english ? "Total" : "الإجمالي"}: ${grandTotal} ${english ? "EGP" : "ج.م"}`
      ].join("\n");

      const whatsappUrl = `https://wa.me/201022591767?text=${encodeURIComponent(message)}`;
      fetch(storeApiUrl("/api/store/orders"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          governorate,
          address,
          items: zaaiCart.map((item) => ({
            productId: item.productId,
            product: item.product || "ZAAI Scrub Set",
            colorAr: item.colorAr,
            colorEn: item.colorEn,
            size: item.size,
            quantity: item.quantity,
            price: item.promotionGift ? 0 : (Number.isFinite(Number(item.price)) ? Number(item.price) : 800),
            promotionGift: Boolean(item.promotionGift)
          }))
        })
      }).catch((error) => console.warn("Could not save the ZAAI order to the database.", error));
      window.open(whatsappUrl, "_blank", "noopener,noreferrer");
      zaaiCheckoutOverlay.hidden = true;
      zaaiCart = [];
      saveCart();
      renderCart();
      zaaiCheckoutForm.reset();
      showToast(
        "تم إرسال طلبك بنجاح",
        "Your order was sent successfully",
        "هنرد عليك خلال 24 ساعة",
        "We will contact you within 24 hours"
      );
    });

    languageButton.addEventListener("click", () => {
      window.requestAnimationFrame(renderCart);
    });

    renderCart();
  }
}

function updateThemeLabel(language) {
  const isDark = document.body.dataset.theme === "dark";
  const copy = labels[language];
  themeLabel.textContent = isDark ? copy.light : copy.dark;
  themeIcon.classList.toggle("fa-sun", isDark);
  themeIcon.classList.toggle("fa-moon", !isDark);
  themeButton.setAttribute("aria-label", isDark ? copy.enableLight : copy.enableDark);
}

function setTheme(theme) {
  const selectedTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = selectedTheme;
  document.querySelector('meta[name="theme-color"]').content = selectedTheme === "dark" ? "#141414" : "#f5f3ef";
  updateThemeLabel(document.documentElement.lang);
  const mobileThemeIcon = document.querySelector("#mobile-theme-toggle .theme-icon");
  if (mobileThemeIcon) {
    mobileThemeIcon.classList.toggle("fa-sun", selectedTheme === "dark");
    mobileThemeIcon.classList.toggle("fa-moon", selectedTheme !== "dark");
  }

  try {
    localStorage.setItem("zaai-theme", selectedTheme);
  } catch (error) {
    console.warn("Could not save the selected theme.", error);
  }
}

let savedLanguage = "ar";
let savedTheme = "light";

try {
  savedLanguage = localStorage.getItem("zaai-language") || savedLanguage;
  savedTheme = localStorage.getItem("zaai-theme") || savedTheme;
} catch (error) {
  console.warn("Could not read saved appearance preferences.", error);
}

setLanguage(savedLanguage);
renderStoreProducts();
setTheme(savedTheme);

languageButton.addEventListener("click", () => {
  setLanguage(document.documentElement.lang === "ar" ? "en" : "ar");
  renderStoreProducts();
});

document.getElementById("mobile-language-toggle")?.addEventListener("click", () => {
  const button = document.getElementById("mobile-language-toggle");
  button.classList.remove("is-rippling", "is-changing");
  void button.offsetWidth;
  button.classList.add("is-rippling", "is-changing");
  window.setTimeout(() => button.classList.remove("is-rippling", "is-changing"), 420);
  languageButton.click();
});

themeButton.addEventListener("click", () => {
  setTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});

document.getElementById("mobile-theme-toggle")?.addEventListener("click", () => {
  const button = document.getElementById("mobile-theme-toggle");
  button.classList.remove("is-rippling", "is-changing");
  void button.offsetWidth;
  button.classList.add("is-rippling", "is-changing");
  window.setTimeout(() => button.classList.remove("is-rippling", "is-changing"), 420);
  themeButton.click();
});

menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  menuButton.setAttribute("aria-label", !isOpen ? labels[document.documentElement.lang].closeMenu : labels[document.documentElement.lang].openMenu);
  menuIcon.classList.toggle("fa-bars", isOpen);
  menuIcon.classList.toggle("fa-times", !isOpen);
  navigation.classList.toggle("mobile-open", !isOpen);
});

navigation.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", labels[document.documentElement.lang].openMenu);
    menuIcon.classList.add("fa-bars");
    menuIcon.classList.remove("fa-times");
    navigation.classList.remove("mobile-open");
  });
});

document.getElementById("zaai-mobile-nav-bag")?.addEventListener("click", () => {
  document.getElementById("header-cart")?.click();
});
document.querySelectorAll(".zaai-mobile-nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".zaai-mobile-nav-item").forEach((navItem) => navItem.classList.remove("is-active"));
    if (item.matches("a")) item.classList.add("is-active");
    item.animate(
      [
        { transform: "scale(.92)" },
        { transform: "scale(1.06)" },
        { transform: "scale(1)" }
      ],
      { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
  });
});

if ("IntersectionObserver" in window && window.matchMedia("(max-width: 760px)").matches) {
  const mobileNavItems = Array.from(document.querySelectorAll(".zaai-mobile-nav-item[href^='#']"));
  const sectionTargets = mobileNavItems
    .map((item) => ({ item, target: document.querySelector(item.getAttribute("href")) }))
    .filter(({ target }) => target);

  const setActiveMobileNav = (item) => {
    mobileNavItems.forEach((navItem) => navItem.classList.remove("is-active"));
    item?.classList.add("is-active");
  };

  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const match = sectionTargets.find(({ target }) => target === visible.target);
    if (match) setActiveMobileNav(match.item);
  }, { threshold: [0.25, 0.45, 0.65], rootMargin: "-18% 0px -48% 0px" });

  sectionTargets.forEach(({ target }) => sectionObserver.observe(target));
}

document.querySelectorAll('a[href="/admin/login"]').forEach((link) => {
 link.addEventListener("click", (event) => {
   if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
     event.preventDefault();
     window.location.assign("https://zaai-production.up.railway.app/admin/login");
   }
 });
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const href = link.getAttribute("href");
    if (!href || href === "#") return;
    const target = document.querySelector(href);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", href);
  });
});

const labPoints = [...document.querySelectorAll(".lab-hotspot")];
const labStage = document.getElementById("lab-stage");
const labImageLayer = document.getElementById("lab-image-layer");
const labCalloutLine = document.getElementById("lab-callout-line");
const labPanel = document.getElementById("lab-panel");
const labDetail = document.getElementById("lab-detail");
const labClose = document.getElementById("lab-close");
let activeLabPoint = -1;
let calloutAnimationFrame = 0;

function updateLabProgress(index) {
  const suffix = document.documentElement.lang === "en" ? "En" : "Ar";
  const currentIndex = index + 1;

  document.getElementById("lab-total-count").textContent = String(labPoints.length).padStart(2, "0");
  document.getElementById("lab-current-index").textContent = String(currentIndex).padStart(2, "0");
  document.getElementById("lab-progress-fill").style.width = `${(currentIndex / labPoints.length) * 100}%`;
  document.querySelector(".lab-progress").setAttribute(
    "aria-label",
    suffix === "En" ? `Detail ${currentIndex} of ${labPoints.length}` : `التفصيل ${currentIndex} من ${labPoints.length}`
  );
}

function updateLabLanguage() {
  const suffix = document.documentElement.lang === "en" ? "En" : "Ar";

  labPoints.forEach((point) => {
    const label = point.dataset[`label${suffix}`];
    point.dataset.tooltip = label;
    point.title = label;
    point.setAttribute("aria-label", `${suffix === "En" ? "Explore" : "استكشاف"} ${label}`);
  });

  labClose.setAttribute("aria-label", suffix === "En" ? "Close details" : "إغلاق التفاصيل");
  labPanel.setAttribute("aria-label", suffix === "En" ? "Selected product detail" : "تفاصيل الجزء المحدد");
  document.getElementById("lab-previous").setAttribute("aria-label", suffix === "En" ? "Previous detail" : "التفصيل السابق");
  document.getElementById("lab-next").setAttribute("aria-label", suffix === "En" ? "Next detail" : "التفصيل التالي");
  updateLabProgress(Number(document.getElementById("lab-current-index").textContent) - 1);

  if (activeLabPoint >= 0) {
    showLabPoint(activeLabPoint);
  }
}

function positionLabCalloutPanel() {
  if (activeLabPoint < 0) {
    return;
  }

  const stageRect = labStage.getBoundingClientRect();
  const panelRect = labPanel.getBoundingClientRect();
  const pointRect = labPoints[activeLabPoint].getBoundingClientRect();
  if (!stageRect.width || !stageRect.height || !panelRect.width || !panelRect.height) {
    return;
  }

  const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom || 0;
  const safeTop = Math.max(12, headerBottom + 8);
  const margin = 12;
  const preferredPosition = labPoints[activeLabPoint].dataset.panelPosition;
  const positions = ["top-left", "top-right", "bottom-left", "bottom-right"];
  positions.sort((a, b) => Number(b === preferredPosition) - Number(a === preferredPosition));

  let bestPosition = preferredPosition;
  let bestScore = Infinity;

  positions.forEach((position) => {
    const left = position.endsWith("left")
      ? stageRect.left + 14
      : stageRect.right - 14 - panelRect.width;
    const top = position.startsWith("top")
      ? stageRect.top + 14
      : stageRect.bottom - 14 - panelRect.height;
    const right = left + panelRect.width;
    const bottom = top + panelRect.height;
    const overlapWidth = Math.max(0, Math.min(right, pointRect.right + 8) - Math.max(left, pointRect.left - 8));
    const overlapHeight = Math.max(0, Math.min(bottom, pointRect.bottom + 8) - Math.max(top, pointRect.top - 8));
    const overflow = Math.max(0, margin - left)
      + Math.max(0, right - (window.innerWidth - margin))
      + Math.max(0, safeTop - top)
      + Math.max(0, bottom - (window.innerHeight - margin));
    const score = overflow * 10 + overlapWidth * overlapHeight + (position === preferredPosition ? 0 : 1);

    if (score < bestScore) {
      bestScore = score;
      bestPosition = position;
    }
  });

  labStage.dataset.panelPosition = bestPosition;
}

function positionLabCalloutArrow() {
  if (activeLabPoint < 0) {
    return;
  }

  const stageRect = labStage.getBoundingClientRect();
  const panelRect = labPanel.getBoundingClientRect();
  const pointRect = labPoints[activeLabPoint].getBoundingClientRect();
  if (!stageRect.width || !stageRect.height || !panelRect.width || !panelRect.height) {
    return;
  }

  const focusX = pointRect.left + pointRect.width / 2;
  const focusY = pointRect.top + pointRect.height / 2;
  const centerX = (panelRect.left + panelRect.right) / 2;
  const centerY = (panelRect.top + panelRect.bottom) / 2;
  const deltaX = focusX - centerX;
  const deltaY = focusY - centerY;
  const distance = Math.hypot(deltaX, deltaY);
  if (!distance) {
    return;
  }

  const horizontalScale = deltaX === 0 ? Infinity : panelRect.width / 2 / Math.abs(deltaX);
  const verticalScale = deltaY === 0 ? Infinity : panelRect.height / 2 / Math.abs(deltaY);
  const edgeScale = Math.min(horizontalScale, verticalScale);
  const arrowGap = Math.min(distance, pointRect.width / 2 + 5);
  const endX = focusX - deltaX / distance * arrowGap;
  const endY = focusY - deltaY / distance * arrowGap;
  const toStageX = (x) => (x - stageRect.left) / stageRect.width * 100;
  const toStageY = (y) => (y - stageRect.top) / stageRect.height * 100;

  labCalloutLine.setAttribute("x1", toStageX(centerX + deltaX * edgeScale).toFixed(2));
  labCalloutLine.setAttribute("y1", toStageY(centerY + deltaY * edgeScale).toFixed(2));
  labCalloutLine.setAttribute("x2", toStageX(endX).toFixed(2));
  labCalloutLine.setAttribute("y2", toStageY(endY).toFixed(2));
}

function updateLabCallout() {
  if (activeLabPoint < 0) {
    return;
  }

  positionLabCalloutPanel();
  positionLabCalloutArrow();
}

function animateLabCalloutArrow() {
  cancelAnimationFrame(calloutAnimationFrame);
  const endTime = performance.now() + 700;

  function updateArrow() {
    updateLabCallout();
    if (activeLabPoint >= 0 && performance.now() < endTime) {
      calloutAnimationFrame = requestAnimationFrame(updateArrow);
    }
  }

  calloutAnimationFrame = requestAnimationFrame(updateArrow);
}

function showLabPoint(index) {
  const point = labPoints[index];
  if (!point) {
    return;
  }

  activeLabPoint = index;
  const suffix = document.documentElement.lang === "en" ? "En" : "Ar";

  labPoints.forEach((item, pointIndex) => {
    const selected = pointIndex === index;
    item.classList.toggle("is-active", selected);
    item.setAttribute("aria-pressed", String(selected));
  });

  labStage.dataset.panelPosition = point.dataset.panelPosition;
  labStage.classList.add("has-selection");
  labImageLayer.style.setProperty("--focus-x", `${point.dataset.zoomX}%`);
  labImageLayer.style.setProperty("--focus-y", `${point.dataset.zoomY}%`);
  labImageLayer.style.setProperty("--lab-image-scale", point.dataset.zoomScale || "1.55");
  labImageLayer.classList.add("is-zoomed");
  document.getElementById("lab-part-label").textContent = point.dataset[`label${suffix}`].toUpperCase();
  document.getElementById("lab-part-number").textContent = `${String(index + 1).padStart(2, "0")} / ${String(labPoints.length).padStart(2, "0")}`;
  updateLabProgress(index);
  document.getElementById("lab-detail-title").textContent = point.dataset[`title${suffix}`];
  document.getElementById("lab-detail-headline").textContent = point.dataset[`headline${suffix}`];
  document.getElementById("lab-detail-description").textContent = point.dataset[`description${suffix}`];
  labDetail.hidden = false;
  labPanel.classList.add("is-open");
  labPanel.setAttribute("aria-hidden", "false");
  labPanel.inert = false;
  animateLabCalloutArrow();
}

function closeLabDetails() {
  const focusPoint = activeLabPoint;
  labPoints.forEach((point) => {
    point.classList.remove("is-active");
    point.setAttribute("aria-pressed", "false");
  });

  activeLabPoint = -1;
  cancelAnimationFrame(calloutAnimationFrame);
  calloutAnimationFrame = 0;
  labStage.classList.remove("has-selection");
  labStage.removeAttribute("data-panel-position");
  labImageLayer.classList.remove("is-zoomed");
  labImageLayer.style.removeProperty("--lab-image-scale");
  labPanel.classList.remove("is-open");
  labPanel.setAttribute("aria-hidden", "true");
  labPanel.inert = true;
  labDetail.hidden = true;
  if (focusPoint >= 0) {
    labPoints[focusPoint].focus();
  }
}

labPoints.forEach((point, index) => {
  const suffix = document.documentElement.lang === "en" ? "En" : "Ar";
  point.dataset.tooltip = point.dataset[`label${suffix}`];
  point.addEventListener("click", () => showLabPoint(index));
});

document.getElementById("lab-previous").addEventListener("click", () => {
  showLabPoint((activeLabPoint - 1 + labPoints.length) % labPoints.length);
});

document.getElementById("lab-next").addEventListener("click", () => {
  showLabPoint((activeLabPoint + 1) % labPoints.length);
});

labClose.addEventListener("click", closeLabDetails);
labStage.addEventListener("click", (event) => {
  if (activeLabPoint < 0 || event.target.closest(".lab-hotspot, .lab-panel")) {
    return;
  }

  closeLabDetails();
});
labImageLayer.addEventListener("transitionend", (event) => {
  if (event.propertyName === "transform") {
    updateLabCallout();
  }
});
languageButton.addEventListener("click", updateLabLanguage);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeLabPoint >= 0) {
    closeLabDetails();
  }
});

labPanel.setAttribute("aria-hidden", "true");
labPanel.inert = true;
window.addEventListener("resize", updateLabCallout);
window.addEventListener("scroll", updateLabCallout, { passive: true });

updateLabLanguage();

const aboutVideo = document.querySelector(".about-video");
const aboutVideoElement = aboutVideo?.querySelector("video");

if (aboutVideo) {
  const aboutObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      aboutVideo.classList.toggle("is-visible", entry.isIntersecting);

      if (entry.isIntersecting) {
        aboutVideoElement?.play().catch(() => {});
      } else {
        aboutVideoElement?.pause();
      }
    });
  }, { threshold: 0.25 });

  aboutObserver.observe(aboutVideo);
}

const orderNowSection = document.querySelector(".order-now-section");
const orderNowVideo = orderNowSection?.querySelector(".order-now-video");
const orderNowSource = orderNowVideo?.querySelector("source");
const orderNowAudioButton = orderNowSection?.querySelector(".order-now-audio");
const orderNowAudioLabel = document.getElementById("order-now-audio-label");
let orderNowIsVisible = false;
let orderNowParallaxFrame = 0;

function updateOrderNowAudioControl() {
  if (!orderNowVideo || !orderNowAudioButton || !orderNowAudioLabel) {
    return;
  }

  const isEnglish = document.documentElement.lang === "en";
  orderNowAudioLabel.textContent = orderNowVideo.muted
    ? (isEnglish ? "SOUND OFF" : "الصوت مغلق")
    : (isEnglish ? "SOUND ON" : "الصوت يعمل");
  orderNowAudioButton.setAttribute(
    "aria-label",
    orderNowVideo.muted
      ? (isEnglish ? "Turn sound on" : "تشغيل الصوت")
      : (isEnglish ? "Turn sound off" : "إيقاف الصوت")
  );
}

if (orderNowSection && orderNowVideo && orderNowSource && orderNowAudioButton) {
  const orderNowObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      orderNowIsVisible = entry.isIntersecting;
      orderNowSection.classList.toggle("is-visible", orderNowIsVisible);

      if (orderNowIsVisible) {
        if (!orderNowSource.src) {
          orderNowSource.src = orderNowSource.dataset.src;
          orderNowVideo.load();
        }

        orderNowVideo.muted = false;
        updateOrderNowAudioControl();
        orderNowVideo.play().catch((error) => {
          if (error.name === "AbortError") {
            return;
          }

          if (error.name === "NotAllowedError") {
            orderNowVideo.muted = true;
            updateOrderNowAudioControl();
            orderNowVideo.play().catch((fallbackError) => {
              if (fallbackError.name !== "AbortError") {
                console.warn("Could not autoplay the order-now video.", fallbackError);
              }
            });
            return;
          }

          console.warn("Could not autoplay the order-now video.", error);
        });
        updateOrderNowParallax();
      } else {
        orderNowVideo.pause();
        orderNowVideo.style.removeProperty("--order-now-parallax");
      }
    });
  }, { threshold: 0.2 });

  function updateOrderNowParallax() {
    if (!orderNowIsVisible
        || orderNowParallaxFrame
        || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    orderNowParallaxFrame = window.requestAnimationFrame(() => {
      orderNowParallaxFrame = 0;
      const bounds = orderNowSection.getBoundingClientRect();
      const offset = (bounds.top + bounds.height / 2 - window.innerHeight / 2) / 80;
      const parallax = Math.max(-3, Math.min(3, offset));
      orderNowVideo.style.setProperty("--order-now-parallax", `${parallax}px`);
    });
  }

  orderNowVideo.style.setProperty("transform", "translateY(var(--order-now-parallax, 0px))");
  orderNowObserver.observe(orderNowSection);
  window.addEventListener("scroll", updateOrderNowParallax, { passive: true });
  window.addEventListener("resize", updateOrderNowParallax);

  orderNowAudioButton.addEventListener("click", () => {
    orderNowVideo.muted = !orderNowVideo.muted;
    updateOrderNowAudioControl();
  });

  if (window.matchMedia("(pointer: fine) and (min-width: 761px)").matches
      && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const orderNowButton = orderNowSection.querySelector(".order-now-button");

    orderNowButton.addEventListener("pointermove", (event) => {
      const bounds = orderNowButton.getBoundingClientRect();
      const x = (event.clientX - bounds.left - bounds.width / 2) / bounds.width;
      const y = (event.clientY - bounds.top - bounds.height / 2) / bounds.height;
      orderNowButton.style.transform = `translate(${x * 6}px, ${y * 5}px)`;
    });

    orderNowButton.addEventListener("pointerleave", () => {
      orderNowButton.style.removeProperty("transform");
    });
  }

  languageButton.addEventListener("click", updateOrderNowAudioControl);
  updateOrderNowAudioControl();
}

const servicesSection = document.getElementById("services");

if (servicesSection) {
  const sizeGuideImage = document.getElementById("size-guide-image");
  const sizeGuideTabs = Array.from(servicesSection.querySelectorAll("[data-size-guide]"));
  const sizeGuideDownload = document.getElementById("size-guide-download");
  const sizeGuideStatus = document.getElementById("size-guide-status");
  const sizeGuideZoomButton = document.getElementById("size-guide-zoom");
  const sizeGuideDialog = document.getElementById("size-guide-lightbox");
  const sizeGuideDialogImage = document.getElementById("size-guide-lightbox-image");
  const sizeGuideDialogClose = document.getElementById("size-guide-lightbox-close");
  const sizeGuideSources = {
    men: sizeGuideImage.dataset.menSrc,
    women: sizeGuideImage.dataset.womenSrc
  };
  const sizeGuideAlt = {
    men: {
      ar: "دليل مقاسات الملابس الطبية من ZAAI للرجال",
      en: "ZAAI men's medical wear size guide"
    },
    women: {
      ar: "دليل مقاسات الملابس الطبية من ZAAI للنساء",
      en: "ZAAI women's medical wear size guide"
    }
  };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let activeSizeGuide = "men";
  let requestedSizeGuide = "men";
  let sizeGuideChangeToken = 0;
  let sizeGuideZoom = 1;
  let pinchStartDistance = 0;
  let pinchStartZoom = 1;
  const pinchPointers = new Map();

  function setSizeGuideStatus(message) {
    sizeGuideStatus.textContent = message;
  }

  function updateSizeGuideSelection(gender) {
    const language = document.documentElement.lang === "en" ? "en" : "ar";
    const source = sizeGuideSources[gender];
    const filename = gender === "men" ? "zaai-mens-size-guide.jpeg" : "zaai-womens-size-guide.jpeg";

    sizeGuideTabs.forEach((tab) => {
      const selected = tab.dataset.sizeGuide === gender;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-pressed", String(selected));
    });
    sizeGuideImage.alt = sizeGuideAlt[gender][language];
    sizeGuideDownload.href = source;
    sizeGuideDownload.download = filename;
    sizeGuideDialogImage.alt = sizeGuideAlt[gender][language];
  }

  function selectSizeGuide(gender) {
    if (!sizeGuideSources[gender] || gender === requestedSizeGuide) {
      return;
    }

    requestedSizeGuide = gender;
    const changeToken = ++sizeGuideChangeToken;
    const nextImage = new Image();
    sizeGuideImage.classList.add("is-changing");
    sizeGuideTabs.forEach((tab) => {
      const selected = tab.dataset.sizeGuide === gender;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-pressed", String(selected));
    });
    setSizeGuideStatus(document.documentElement.lang === "en" ? "Loading size guide…" : "جارٍ تحميل دليل المقاسات…");

    nextImage.onload = () => {
      if (changeToken !== sizeGuideChangeToken) {
        return;
      }

      activeSizeGuide = gender;
      sizeGuideImage.src = sizeGuideSources[gender];
      updateSizeGuideSelection(gender);
      if (sizeGuideDialog.open) {
        sizeGuideDialogImage.src = sizeGuideImage.src;
      }
      setSizeGuideStatus("");
      window.requestAnimationFrame(() => sizeGuideImage.classList.remove("is-changing"));
    };

    nextImage.onerror = () => {
      if (changeToken !== sizeGuideChangeToken) {
        return;
      }

      requestedSizeGuide = activeSizeGuide;
      sizeGuideTabs.forEach((tab) => {
        const selected = tab.dataset.sizeGuide === activeSizeGuide;
        tab.classList.toggle("is-active", selected);
        tab.setAttribute("aria-pressed", String(selected));
      });
      sizeGuideImage.classList.remove("is-changing");
      setSizeGuideStatus(document.documentElement.lang === "en" ? "The size guide could not be loaded." : "تعذر تحميل دليل المقاسات.");
      console.error("Could not load the selected ZAAI size guide.", sizeGuideSources[gender]);
    };

    nextImage.src = sizeGuideSources[gender];
  }

  sizeGuideTabs.forEach((tab) => {
    tab.addEventListener("click", () => selectSizeGuide(tab.dataset.sizeGuide));
  });

  updateSizeGuideSelection(activeSizeGuide);
  sizeGuideImage.addEventListener("error", () => {
    setSizeGuideStatus(document.documentElement.lang === "en" ? "The size guide could not be loaded." : "تعذر تحميل دليل المقاسات.");
    console.error("Could not load the active ZAAI size guide.", sizeGuideImage.src);
  });

  languageButton.addEventListener("click", () => {
    updateSizeGuideSelection(activeSizeGuide);
  });

  sizeGuideZoomButton.addEventListener("click", () => {
    if (typeof sizeGuideDialog.showModal !== "function") {
      console.error("The browser does not support the size guide dialog.");
      return;
    }

    sizeGuideDialogImage.src = sizeGuideImage.currentSrc || sizeGuideImage.src;
    sizeGuideDialogImage.alt = sizeGuideAlt[activeSizeGuide][document.documentElement.lang === "en" ? "en" : "ar"];
    sizeGuideZoom = 1;
    sizeGuideDialogImage.style.transform = "scale(1)";
    sizeGuideDialog.showModal();
    sizeGuideDialogClose.focus();
  });

  sizeGuideDialogClose.addEventListener("click", () => sizeGuideDialog.close());
  sizeGuideDialog.addEventListener("click", (event) => {
    if (event.target === sizeGuideDialog) {
      sizeGuideDialog.close();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sizeGuideDialog.open) {
      event.preventDefault();
      sizeGuideDialog.close();
    }
  });
  sizeGuideDialog.addEventListener("close", () => {
    pinchPointers.clear();
    pinchStartDistance = 0;
    sizeGuideZoom = 1;
    sizeGuideDialogImage.style.transform = "scale(1)";
    sizeGuideZoomButton.focus({ preventScroll: true });
  });

  function getPinchDistance(points) {
    const [first, second] = points;
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  sizeGuideDialogImage.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") {
      return;
    }

    sizeGuideDialogImage.setPointerCapture(event.pointerId);
    pinchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinchPointers.size === 2) {
      pinchStartDistance = getPinchDistance(Array.from(pinchPointers.values()));
      pinchStartZoom = sizeGuideZoom;
    }
  });

  sizeGuideDialogImage.addEventListener("pointermove", (event) => {
    if (!pinchPointers.has(event.pointerId)) {
      return;
    }

    pinchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchPointers.size === 2 && pinchStartDistance > 0) {
      const currentDistance = getPinchDistance(Array.from(pinchPointers.values()));
      sizeGuideZoom = Math.max(1, Math.min(3, pinchStartZoom * currentDistance / pinchStartDistance));
      sizeGuideDialogImage.style.transform = `scale(${sizeGuideZoom})`;
      event.preventDefault();
    }
  });

  ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
    sizeGuideDialogImage.addEventListener(eventName, (event) => {
      pinchPointers.delete(event.pointerId);
      if (pinchPointers.size < 2) {
        pinchStartDistance = 0;
      }
    });
  });

  const serviceRevealItems = Array.from(servicesSection.querySelectorAll(".services-reveal"));
  servicesSection.querySelectorAll(".service-item").forEach((item, index) => {
    item.style.setProperty("--service-stagger", `${index * 90}ms`);
  });

  function revealServicesInView() {
    serviceRevealItems.forEach((item) => {
      if (item.classList.contains("is-visible")) {
        return;
      }

      const bounds = item.getBoundingClientRect();
      if (bounds.bottom > 0 && bounds.top < window.innerHeight) {
        item.classList.add("is-visible");
      }
    });
  }

  if ("IntersectionObserver" in window && !reducedMotion) {
    document.documentElement.classList.add("services-motion-ready");
    const servicesObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    serviceRevealItems.forEach((item) => servicesObserver.observe(item));
    window.addEventListener("scroll", revealServicesInView, { passive: true });
    window.addEventListener("resize", revealServicesInView);
    window.requestAnimationFrame(revealServicesInView);
  } else {
    serviceRevealItems.forEach((item) => item.classList.add("is-visible"));
  }

  const sizeGuideFrame = servicesSection.querySelector(".size-guide-frame");
  let sizeGuideParallaxFrame = 0;

  function updateSizeGuideParallax() {
    if (reducedMotion || sizeGuideParallaxFrame) {
      return;
    }

    sizeGuideParallaxFrame = window.requestAnimationFrame(() => {
      sizeGuideParallaxFrame = 0;
      const bounds = sizeGuideFrame.getBoundingClientRect();
      const offset = (bounds.top + bounds.height / 2 - window.innerHeight / 2) / 120;
      const parallax = Math.max(-3, Math.min(3, offset));
      sizeGuideFrame.style.setProperty("--size-guide-parallax", `${parallax}px`);
    });
  }

  window.addEventListener("scroll", updateSizeGuideParallax, { passive: true });
  window.addEventListener("resize", updateSizeGuideParallax);
  updateSizeGuideParallax();

  if (window.matchMedia("(pointer: fine) and (min-width: 761px)").matches && !reducedMotion) {
    servicesSection.querySelectorAll(".service-link").forEach((link) => {
      link.addEventListener("pointermove", (event) => {
        const bounds = link.getBoundingClientRect();
        const x = (event.clientX - bounds.left - bounds.width / 2) / bounds.width;
        const y = (event.clientY - bounds.top - bounds.height / 2) / bounds.height;
        link.style.setProperty("--service-magnetic-x", `${Math.max(-3, Math.min(3, x * 6))}px`);
        link.style.setProperty("--service-magnetic-y", `${Math.max(-3, Math.min(3, y * 6))}px`);
      });

      link.addEventListener("pointerleave", () => {
        link.style.removeProperty("--service-magnetic-x");
        link.style.removeProperty("--service-magnetic-y");
      });
    });
  }
}

const footerYear = document.getElementById("zaai-footer-year");
if (footerYear) {
  footerYear.textContent = String(new Date().getFullYear());
}

function setDataText(element, ar, en) {
  if (!element) return;
  if (ar) element.dataset.ar = ar;
  if (en) element.dataset.en = en;
  const english = document.documentElement.lang === "en";
  element.textContent = english ? (en || ar || "") : (ar || en || "");
}

function applyHomeHeading(ar, en) {
  const heading = document.querySelector(".home-copy h1");
  if (!heading) return;

  const splitAr = splitHomeTitle(ar || "", "ar");
  const splitEn = splitHomeTitle(en || "", "en");
  const english = document.documentElement.lang === "en";

  heading.innerHTML =
    `<span data-ar="${escapeCatalogText(splitAr.firstAr)}" data-en="${escapeCatalogText(splitEn.firstEn)}">${escapeCatalogText(english ? splitEn.firstEn : splitAr.firstAr)}</span>` +
    `<span class="home-title-accent" data-ar="${escapeCatalogText(splitAr.secondAr)}" data-en="${escapeCatalogText(splitEn.secondEn)}">${escapeCatalogText(english ? splitEn.secondEn : splitAr.secondAr)}</span>`;
  heading.dataset.ar = ar || splitAr.firstAr;
  heading.dataset.en = en || splitEn.firstEn;
}

function splitHomeTitle(title, language) {
  const value = String(title || "").trim();
  if (!value) return language === "ar"
    ? { firstAr:"", secondAr:"" }
    : { firstEn:"", secondEn:"" };

  if (language === "en") {
    const match = /\s+with\s+/i.exec(value);
    if (match) {
      const splitAt = match.index;
      return {
        firstEn: value.slice(0, splitAt).trim(),
        secondEn: value.slice(splitAt).trim()
      };
    }
  } else {
    const marker = value.includes("براحة") ? "براحة" : "";
    if (marker) {
      const splitAt = value.indexOf(marker);
      return {
        firstAr: value.slice(0, splitAt).trim(),
        secondAr: value.slice(splitAt).trim()
      };
    }
  }

  const words = value.split(/\s+/);
  const splitAt = Math.ceil(words.length / 2);
  return language === "ar"
    ? { firstAr: words.slice(0, splitAt).join(" "), secondAr: words.slice(splitAt).join(" ") }
    : { firstEn: words.slice(0, splitAt).join(" "), secondEn: words.slice(splitAt).join(" ") };
}

function applyStoreSections(sections) {
  const byKey = new Map((Array.isArray(sections) ? sections : []).map((section) => [section.section_key, section]));
  sections.forEach((section) => {
    const draft = section.draft && typeof section.draft === "object" ? section.draft : {};
    const elementStyles = draft.elements && typeof draft.elements === "object" ? draft.elements : {};
    Object.entries(elementStyles).forEach(([selector, responsive]) => {
      const element = document.querySelectorAll(selector);
      if (!element.length) return;
      element.forEach((target) => {
        const apply = (styles) => Object.entries(styles || {}).forEach(([property, value]) => {
            if (value) target.style.setProperty(property, value);
        });
        apply(responsive.global);
        if (window.matchMedia("(min-width:981px)").matches) apply(responsive.desktop);
        if (window.matchMedia("(min-width:761px) and (max-width:980px)").matches) apply(responsive.tablet);
        if (window.matchMedia("(max-width:760px)").matches) apply(responsive.mobile);
      });
    });
  });

  const mappings = {
    home: { element: "home", heading: ".home-copy h1", text: ".home-description", image: ".home-image-frame img", video: null },
    about: { element: "about", heading: "#about-title", text: ".about-lead", image: null, video: ".about-video video source" },
    services: { element: "services", heading: "#services-title", text: ".services-intro > p", image: null, video: null },
    products: { element: "products", heading: "#style-discovery-title", text: ".style-discovery-heading > p", image: null, video: null },
    contact: { element: "contact", heading: "#zaai-contact-title", text: ".zaai-contact-heading > p", image: null, video: null }
  };

  Object.entries(mappings).forEach(([key, map]) => {
    const section = byKey.get(key);
    if (!section) return;
    const element = document.getElementById(map.element);
    if (!element) return;
    element.hidden = Number(section.visible) === 0;

    if (key === "home") {
      applyHomeHeading(section.title_ar, section.title_en);
    } else {
      setDataText(element.querySelector(map.heading), section.title_ar, section.title_en);
    }
    setDataText(element.querySelector(map.text), section.content_ar, section.content_en);

    if (map.image && section.image) {
      const image = element.querySelector(map.image);
      if (image) image.src = resolveStoreAssetUrl(section.image);
    }
    if (map.video && section.video) {
      const source = element.querySelector(map.video);
      if (source) {
        source.src = resolveStoreAssetUrl(section.video);
        source.parentElement?.load();
      }
    }

    if (section.button_text_ar || section.button_text_en) {
      const button = key === "home"
        ? element.querySelector(".home-button-primary")
        : key === "about"
          ? element.querySelector(".about-copy a")
          : key === "services"
            ? null
            : key === "products"
              ? null
              : element.querySelector(".zaai-contact-cta");
      setDataText(button, section.button_text_ar, section.button_text_en);
      if (button && section.button_link) button.href = section.button_link;
    }
  });

  const sectionElements = [
    "home","product-lab","about","order-now","services","products","contact"
  ].map((key) => document.getElementById(key)).filter(Boolean);
  sectionElements.sort((a, b) => {
    const aSection = byKey.get(a.id);
    const bSection = byKey.get(b.id);
    return (aSection?.sort_order ?? 999) - (bSection?.sort_order ?? 999) || (aSection?.id ?? 999) - (bSection?.id ?? 999);
  });
  const parent = sectionElements[0]?.parentElement;
  const footer = document.querySelector(".zaai-footer") || document.querySelector("footer");
  sectionElements.forEach((element) => {
    if (footer && parent === footer.parentElement) parent.insertBefore(element, footer);
    else if (parent) parent.appendChild(element);
  });

  if (new URLSearchParams(location.search).get("preview") === "1") {
    sectionElements.forEach((element) => {
      element.classList.add("zaai-preview-section");
      const names = { home:"Home", "product-lab":"Product Lab", about:"About", "order-now":"Order Now", services:"Services", products:"Products", contact:"Contact" };
      element.dataset.adminSectionName = names[element.id] || element.id;
      element.addEventListener("click", () => {
        window.parent?.postMessage({ type:"zaai-preview-select", sectionKey:element.id }, "*");
      });
    });
    document.querySelectorAll(".zaai-preview-section *").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const previewElement = event.currentTarget;
        const section = previewElement.closest(".zaai-preview-section");
        const tag = previewElement.tagName.toLowerCase();
        let siblingIndex = 1;
        let sibling = previewElement.previousElementSibling;
        while (sibling) {
          if (sibling.tagName.toLowerCase() === tag) siblingIndex += 1;
          sibling = sibling.previousElementSibling;
        }
        const selector = `#${section?.id || "zaai-preview"} ${tag}${siblingIndex > 1 ? `:nth-of-type(${siblingIndex})` : ""}`;
        const computed = getComputedStyle(previewElement);
        window.parent?.postMessage({
          type:"zaai-preview-element",
          tag:previewElement.tagName.toLowerCase(),
          label: previewElement.tagName.toLowerCase() === "img" ? "صورة" : previewElement.tagName.toLowerCase(),
          selector,
          styles:{
            width:previewElement.style.width || computed.width,
            height:previewElement.style.height || computed.height,
            "text-align":previewElement.style.textAlign || computed.textAlign,
            "background-color":previewElement.style.backgroundColor || computed.backgroundColor,
            color:previewElement.style.color || computed.color,
            "font-size":previewElement.style.fontSize || computed.fontSize,
            padding:previewElement.style.padding || computed.padding,
            margin:previewElement.style.margin || computed.margin,
            display:previewElement.style.display || computed.display
          }
        }, "*");
      });
    });
  }
}

fetch(storeApiUrl("/api/store/settings"), { cache: "no-store" })
  .then((response) => response.ok ? response.json() : Promise.reject(new Error("Settings unavailable")))
  .then((settings) => {
    settings = {
      siteName: "ZAAI STORE",
      whatsapp: "+201022591767",
      email: "",
      address: "المنصورة، مصر",
      currency: "EGP",
      defaultLanguage: "ar",
      primaryColor: "#98866a",
      accentColor: "#171717",
      ...(settings && typeof settings === "object" ? settings : {})
    };
    if (settings.siteName) {
      document.title = String(document.title).replace(/ZAAI STORE/g, settings.siteName);
      document.querySelectorAll(".logo h2, .zaai-footer-logo span").forEach((element) => {
        element.textContent = settings.siteName;
      });
    }
    if (settings.primaryColor) document.documentElement.style.setProperty("--header-accent", settings.primaryColor);
    if (settings.accentColor) {
      document.documentElement.style.setProperty("--page-text", settings.accentColor);
      document.documentElement.style.setProperty("--header-text", settings.accentColor);
    }
    if (settings.defaultLanguage === "en" && document.documentElement.lang !== "en") {
      document.getElementById("language-toggle")?.click();
    }
    const whatsapp = String(settings.whatsapp || "").replace(/\D/g, "");
    if (whatsapp) {
      document.querySelectorAll('a[href*="wa.me/"]').forEach((link) => {
        link.href = `https://wa.me/${whatsapp}`;
      });
    }
    if (settings.email) {
      document.querySelectorAll(".zaai-footer-contact a[href^='mailto:']").forEach((link) => {
        link.href = `mailto:${settings.email}`;
        link.textContent = settings.email;
      });
    }
    if (settings.address) {
      document.querySelectorAll(".zaai-footer-contact > span").forEach((element) => {
        element.textContent = settings.address;
      });
    }
  })
  .catch(() => {});

fetch(storeApiUrl("/api/store/sections"), { cache: "no-store" })
  .then((response) => response.ok ? response.json() : Promise.reject(new Error("Sections unavailable")))
  .then(applyStoreSections)
  .catch((error) => console.error("Could not load ZAAI sections.", error));

window.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;
  if (event.data.type === "zaai-element-preview") {
    const breakpoint = event.data.breakpoint || "global";
    let style = document.getElementById("zaai-live-builder-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "zaai-live-builder-style";
      document.head.appendChild(style);
    }
    const cssText = Object.entries(event.data.styles || {})
      .filter(([, value]) => String(value || "").trim())
      .map(([property, value]) => `${property}:${value} !important;`)
      .join("");
    const block = `${event.data.selector}{${cssText}}`;
    const existing = style.textContent;
    style.textContent = `${existing}\n${breakpoint === "global" ? block : `@media (${breakpoint === "desktop" ? "min-width:981px" : breakpoint === "tablet" ? "min-width:761px and max-width:980px" : "max-width:760px"}){${block}}`}`;
  }
  if (event.data.type === "zaai-element-preview") {
    const selector = event.data.selector;
    const styles = event.data.styles || {};
    document.querySelectorAll(selector).forEach((element) => {
      Object.entries(styles).forEach(([property, value]) => {
        if (value) element.style.setProperty(property, value);
        else element.style.removeProperty(property);
      });
    });
    return;
  }
  if (event.data.type === "zaai-preview-select-local") {
    document.querySelectorAll(".zaai-preview-section").forEach((element) => {
      element.classList.toggle("is-admin-selected", element.id === event.data.sectionKey);
    });
    const target = document.getElementById(event.data.sectionKey);
    target?.scrollIntoView({ behavior:"smooth", block:"start" });
    return;
  }
  if (event.data.type === "zaai-language") {
    setLanguage(event.data.language);
    return;
  }
  if (event.data.type !== "zaai-section-preview") return;

  const key = String(event.data.sectionKey || "").trim();
  const mappings = {
    home: { heading: ".home-copy h1", text: ".home-description", image: ".home-image-frame img", button: ".home-button-primary" },
    about: { heading: "#about-title", text: ".about-lead", image: null, button: null },
    services: { heading: "#services-title", text: ".services-intro > p", image: null, button: null },
    products: { heading: "#style-discovery-title", text: ".style-discovery-heading > p", image: null, button: null },
    contact: { heading: "#zaai-contact-title", text: ".zaai-contact-heading > p", image: null, button: ".zaai-contact-cta" }
  };
  const map = mappings[key];
  if (!map) return;
  const english = document.documentElement.lang === "en";
  const heading = document.querySelector(map.heading);
  const text = document.querySelector(map.text);
  if (key === "home") {
    applyHomeHeading(event.data.titleAr, event.data.titleEn);
  } else {
    setDataText(heading, event.data.titleAr, event.data.titleEn);
  }
  setDataText(text, event.data.contentAr, event.data.contentEn);
  if (map.image && event.data.image) {
    const image = document.querySelector(map.image);
    if (image) image.src = resolveStoreAssetUrl(event.data.image);
  }
  if (event.data.video) {
    const source = document.querySelector(".about-video video source");
    if (source && key === "about") {
      source.src = resolveStoreAssetUrl(event.data.video);
      source.parentElement?.load();
    }
  }
  if (map.button) {
    const button = document.querySelector(map.button);
    setDataText(button, event.data.buttonAr, event.data.buttonEn);
    if (event.data.link) button.href = event.data.link;
  }
  const sectionElement = document.getElementById(key);
  if (sectionElement) sectionElement.hidden = !event.data.visible;
});

loadStoreProducts();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js?v=20261123-live-fix-4").catch((error) => {
      console.warn("Could not register the ZAAI service worker.", error);
    });
  });
}

