(() => {
  const gallery = document.querySelector(".zaai-video-gallery");
  if (!gallery) return;

  const viewport = gallery.querySelector(".zaai-video-gallery-viewport");
  const cards = Array.from(gallery.querySelectorAll(".zaai-video-card"));
  const arrows = Array.from(gallery.querySelectorAll("[data-gallery-direction]"));
  const dialog = gallery.querySelector(".zaai-video-lightbox");
  const lightboxVideo = gallery.querySelector(".zaai-video-lightbox-player");
  const closeButton = gallery.querySelector(".zaai-video-lightbox-close");
  const playButton = gallery.querySelector(".zaai-video-lightbox-play");
  const muteButton = gallery.querySelector(".zaai-video-lightbox-mute");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const visibility = new Map(cards.map((card) => [card, 0]));
  const pendingPlayback = new WeakSet();
  let activeCard = null;
  let sectionVisible = false;

  function getVideo(card) {
    return card.querySelector("video");
  }

  function getSource(card) {
    return card.querySelector("source");
  }

  function loadVideo(card) {
    const video = getVideo(card);
    const source = getSource(card);

    if (video && source && !source.src && source.dataset.src) {
      source.src = source.dataset.src;
      video.load();
    }

    return video;
  }

  function getCardVisibility(card) {
    if ("IntersectionObserver" in window) {
      return visibility.get(card) || 0;
    }

    const rect = card.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return rect.width && rect.height ? (visibleWidth * visibleHeight) / (rect.width * rect.height) : 0;
  }

  function requestPlayback(card) {
    const video = loadVideo(card);
    if (!video || !video.paused || pendingPlayback.has(video)) return;

    video.muted = true;
    pendingPlayback.add(video);
    video.play()
      .then(() => {
        if (activeCard !== card || document.hidden || dialog.open || !sectionVisible) {
          video.pause();
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError" && error.name !== "NotAllowedError") {
          console.warn("Could not autoplay a ZAAI gallery video.", error);
        }
      })
      .finally(() => {
        pendingPlayback.delete(video);
      });
  }

  function syncPlayback() {
    const shouldPlay = sectionVisible && !document.hidden && !dialog.open;
    const mostVisibleCard = shouldPlay
      ? cards.reduce((best, card) => {
          const ratio = getCardVisibility(card);
          if (ratio < 0.15) return best;
          if (!best || ratio > best.ratio) return { card, ratio };
          if (ratio === best.ratio && best.card === activeCard) return best;
          if (ratio === best.ratio && card === activeCard) return { card, ratio };
          return best;
        }, null)?.card || null
      : null;

    activeCard = mostVisibleCard;
    cards.forEach((card) => {
      const video = getVideo(card);
      if (card === activeCard) {
        requestPlayback(card);
      } else {
        video.pause();
      }
    });
  }

  function updateNavigation() {
    const maxScroll = viewport.scrollWidth - viewport.clientWidth;
    arrows.forEach((button) => {
      const direction = Number(button.dataset.galleryDirection);
      button.disabled = direction < 0
        ? viewport.scrollLeft <= 1
        : viewport.scrollLeft >= maxScroll - 1;
    });
  }

  function updateLightboxControls() {
    const isPlaying = !lightboxVideo.paused;
    const isMuted = lightboxVideo.muted;
    playButton.setAttribute("aria-label", isPlaying ? "Pause video" : "Play video");
    playButton.querySelector("i").className = isPlaying ? "fa-solid fa-pause" : "fa-solid fa-play";
    playButton.querySelector("span").textContent = isPlaying ? "PAUSE" : "PLAY";
    muteButton.setAttribute("aria-label", isMuted ? "Turn sound on" : "Turn sound off");
    muteButton.querySelector("i").className = isMuted ? "fa-solid fa-volume-xmark" : "fa-solid fa-volume-high";
    muteButton.querySelector("span").textContent = isMuted ? "SOUND OFF" : "SOUND ON";
  }

  function openLightbox(card) {
    const source = getSource(card);
    const video = loadVideo(card);
    if (!source || !video || !source.src) return;

    cards.forEach((item) => getVideo(item).pause());
    lightboxVideo.pause();
    lightboxVideo.removeAttribute("src");
    lightboxVideo.src = source.src;
    lightboxVideo.poster = video.poster;
    lightboxVideo.muted = true;
    lightboxVideo.load();
    dialog.showModal();
    syncPlayback();
    lightboxVideo.play().catch((error) => {
      if (error.name !== "AbortError" && error.name !== "NotAllowedError") {
        console.warn("Could not start the ZAAI gallery lightbox video.", error);
      }
    });
    updateLightboxControls();
  }

  function stopLightbox() {
    lightboxVideo.pause();
    lightboxVideo.removeAttribute("src");
    lightboxVideo.removeAttribute("poster");
    lightboxVideo.load();
    syncPlayback();
  }

  arrows.forEach((button) => {
    button.addEventListener("click", () => {
      const distance = Math.max(viewport.clientWidth * 0.82, 240);
      viewport.scrollBy({
        left: Number(button.dataset.galleryDirection) * distance,
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    });
  });

  viewport.addEventListener("scroll", updateNavigation, { passive: true });
  window.addEventListener("resize", () => {
    updateNavigation();
    syncPlayback();
  }, { passive: true });

  cards.forEach((card) => {
    const video = getVideo(card);
    card.addEventListener("click", () => openLightbox(card));
    video.addEventListener("loadeddata", () => card.classList.add("is-loaded"));
    video.addEventListener("error", () => card.classList.add("is-error"));
  });

  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", stopLightbox);
  lightboxVideo.addEventListener("play", updateLightboxControls);
  lightboxVideo.addEventListener("pause", updateLightboxControls);
  lightboxVideo.addEventListener("volumechange", updateLightboxControls);

  playButton.addEventListener("click", () => {
    if (lightboxVideo.paused) {
      lightboxVideo.play().catch((error) => {
        if (error.name !== "AbortError" && error.name !== "NotAllowedError") {
          console.warn("Could not play the ZAAI gallery lightbox video.", error);
        }
      });
    } else {
      lightboxVideo.pause();
    }
  });

  muteButton.addEventListener("click", () => {
    lightboxVideo.muted = !lightboxVideo.muted;
    updateLightboxControls();
  });

  if ("IntersectionObserver" in window) {
    gallery.classList.add("is-motion-ready");

    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        sectionVisible = entry.isIntersecting;
        gallery.classList.toggle("is-visible", sectionVisible);
        syncPlayback();
      });
    }, { threshold: 0.05 });
    sectionObserver.observe(gallery);

    const preloadObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          loadVideo(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "160px 240px", threshold: 0 });

    const playbackObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        visibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
      });
      syncPlayback();
    }, { threshold: [0, 0.15, 0.3, 0.5, 0.7, 0.9, 1] });

    cards.forEach((card) => {
      preloadObserver.observe(card);
      playbackObserver.observe(card);
    });
  } else {
    const updateFallbackVisibility = () => {
      const rect = gallery.getBoundingClientRect();
      sectionVisible = rect.bottom > 0 && rect.top < window.innerHeight;
      gallery.classList.add("is-visible");
      syncPlayback();
    };

    window.addEventListener("scroll", updateFallbackVisibility, { passive: true });
    viewport.addEventListener("scroll", updateFallbackVisibility, { passive: true });
    updateFallbackVisibility();
  }

  document.addEventListener("visibilitychange", syncPlayback);
  updateNavigation();
})();
