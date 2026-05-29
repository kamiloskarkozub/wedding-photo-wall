(function () {
  const acceptedImageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]);
  const adminStorageKey = "weddingPhotoWallAdminToken";

  const state = {
    mode: "locked",
    token: "",
    admin: "",
    photos: [],
    sort: "newest",
    config: null,
    adminLimits: null,
    lightboxIndex: -1,
    swipeStartX: 0,
    swipeStartY: 0
  };

  const elements = {
    guestView: document.querySelector("#guestView"),
    adminView: document.querySelector("#adminView"),
    adminLoginView: document.querySelector("#adminLoginView"),
    lockedView: document.querySelector("#lockedView"),
    adminButton: document.querySelector("#adminButton"),
    refreshButton: document.querySelector("#refreshButton"),
    modeBadge: document.querySelector("#modeBadge"),
    eyebrow: document.querySelector("#eyebrow"),
    pageTitle: document.querySelector("#pageTitle"),
    pageLead: document.querySelector("#pageLead"),
    uploadForm: document.querySelector("#uploadForm"),
    photoInput: document.querySelector("#photoInput"),
    selectedFiles: document.querySelector("#selectedFiles"),
    uploadButton: document.querySelector("#uploadButton"),
    galleryGrid: document.querySelector("#galleryGrid"),
    photoCounter: document.querySelector("#photoCounter"),
    statusMessage: document.querySelector("#statusMessage"),
    adminGalleryGrid: document.querySelector("#adminGalleryGrid"),
    adminPhotoCounter: document.querySelector("#adminPhotoCounter"),
    adminStatusMessage: document.querySelector("#adminStatusMessage"),
    adminLoginForm: document.querySelector("#adminLoginForm"),
    adminPassword: document.querySelector("#adminPassword"),
    adminLoginButton: document.querySelector("#adminLoginButton"),
    adminLoginStatus: document.querySelector("#adminLoginStatus"),
    qrImage: document.querySelector("#qrImage"),
    guestLink: document.querySelector("#guestLink"),
    copyLinkButton: document.querySelector("#copyLinkButton"),
    printButton: document.querySelector("#printButton"),
    adminStats: document.querySelector("#adminStats"),
    lightbox: document.querySelector("#lightbox"),
    lightboxStage: document.querySelector("#lightboxStage"),
    lightboxImage: document.querySelector("#lightboxImage"),
    lightboxCaption: document.querySelector("#lightboxCaption"),
    closeLightbox: document.querySelector("#closeLightbox"),
    prevLightbox: document.querySelector("#prevLightbox"),
    nextLightbox: document.querySelector("#nextLightbox")
  };

  init();

  function init() {
    detectMode();
    bindEvents();

    if (state.mode === "guest") {
      showOnly(elements.guestView);
      loadGuest();
      return;
    }

    if (state.mode === "admin") {
      showOnly(elements.adminView);
      loadAdmin();
      return;
    }

    if (state.mode === "admin-login") {
      showAdminLogin();
      return;
    }

    showLocked();
  }

  function detectMode() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts[0] === "w" && parts[1]) {
      state.mode = "guest";
      state.token = parts[1];
    } else if (parts[0] === "admin") {
      const storedToken = sessionStorage.getItem(adminStorageKey);
      state.mode = storedToken ? "admin" : "admin-login";
      state.admin = storedToken || "";
    }
  }

  function bindEvents() {
    elements.adminButton.addEventListener("click", () => {
      window.location.assign("/admin");
    });

    elements.refreshButton.addEventListener("click", () => {
      if (state.mode === "guest") loadPhotos();
      if (state.mode === "admin") loadAdmin();
    });

    elements.photoInput.addEventListener("change", handlePhotoSelection);
    elements.uploadForm.addEventListener("submit", uploadPhotos);
    elements.adminLoginForm.addEventListener("submit", loginAdmin);

    document.querySelectorAll(".segment").forEach((button) => {
      button.addEventListener("click", () => {
        state.sort = button.dataset.sort;
        document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        renderGallery();
      });
    });

    elements.copyLinkButton.addEventListener("click", copyGuestLink);
    elements.printButton.addEventListener("click", () => window.print());
    elements.closeLightbox.addEventListener("click", closeLightbox);
    elements.prevLightbox.addEventListener("click", () => showAdjacentPhoto(-1));
    elements.nextLightbox.addEventListener("click", () => showAdjacentPhoto(1));
    elements.lightboxStage.addEventListener("pointerdown", startSwipe);
    elements.lightboxStage.addEventListener("pointerup", finishSwipe);
    elements.lightbox.addEventListener("click", (event) => {
      if (event.target === elements.lightbox) closeLightbox();
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeLightbox();
      if (!elements.lightbox.hidden && event.key === "ArrowLeft") {
        event.preventDefault();
        showAdjacentPhoto(-1);
      }
      if (!elements.lightbox.hidden && event.key === "ArrowRight") {
        event.preventDefault();
        showAdjacentPhoto(1);
      }
    });
  }

  async function loadGuest() {
    elements.refreshButton.hidden = false;
    setBusy("Ładuję galerię...");
    try {
      const config = await api(`/api/config?token=${encodeURIComponent(state.token)}`);
      state.config = config;
      document.title = config.siteTitle;
      elements.eyebrow.textContent = config.coupleNames;
      elements.pageTitle.textContent = "Dodaj zdjęcia z wesela";
      elements.pageLead.textContent = config.weddingDate
        ? `Galeria z dnia ${config.weddingDate}.`
        : "Wspólne kadry od gości w jednym miejscu.";
      elements.modeBadge.textContent = "Galeria gości";
      await loadPhotos();
    } catch (error) {
      showLocked(error.message);
    }
  }

  async function loadPhotos() {
    setBusy("Odświeżam galerię...");
    try {
      const response = await api(`/api/photos?${accessQuery()}`);
      state.photos = response.photos || [];
      renderGallery();
      setStatus("");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function uploadPhotos(event) {
    event.preventDefault();

    const files = Array.from(elements.photoInput.files || []);
    if (!files.length) {
      setStatus("Wybierz przynajmniej jedno zdjęcie.", true);
      return;
    }

    elements.uploadButton.disabled = true;
    elements.uploadButton.classList.add("loading");
    setStatus("Wgrywam zdjęcia...");

    const formData = new FormData(elements.uploadForm);
    try {
      const response = await fetch(`/api/photos?token=${encodeURIComponent(state.token)}`, {
        method: "POST",
        body: formData
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Nie udało się wgrać zdjęć.");

      state.photos = payload.photos || [];
      elements.uploadForm.reset();
      renderSelectedFiles();
      renderGallery();

      const savedCount = payload.saved ? payload.saved.length : 0;
      const rejectedCount = payload.rejected ? payload.rejected.length : 0;
      const message = rejectedCount
        ? `Zapisano ${savedCount}, odrzucono ${rejectedCount}.`
        : `Zapisano ${savedCount} ${savedCount === 1 ? "zdjęcie" : "zdjęcia"}.`;
      setStatus(message);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      elements.uploadButton.disabled = false;
      elements.uploadButton.classList.remove("loading");
    }
  }

  async function loginAdmin(event) {
    event.preventDefault();

    const password = elements.adminPassword.value.trim();
    if (!password) {
      setAdminLoginStatus("Wpisz hasło administratora.", true);
      return;
    }

    elements.adminLoginButton.disabled = true;
    setAdminLoginStatus("Loguję...");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Nie udało się zalogować.");

      state.mode = "admin";
      state.admin = payload.adminToken;
      sessionStorage.setItem(adminStorageKey, state.admin);
      history.replaceState(null, "", "/admin");
      elements.adminPassword.value = "";
      await loadAdmin();
    } catch (error) {
      setAdminLoginStatus(error.message, true);
    } finally {
      elements.adminLoginButton.disabled = false;
    }
  }

  async function loadAdmin() {
    showOnly(elements.adminView);
    elements.refreshButton.hidden = false;
    setBusy("Ładuję panel...");

    try {
      const data = await api(`/api/admin?admin=${encodeURIComponent(state.admin)}`);
      document.title = `${data.siteTitle} - panel`;
      elements.eyebrow.textContent = data.coupleNames;
      elements.pageTitle.textContent = "Panel galerii weselnej";
      elements.pageLead.textContent = "Tu możesz przeglądać i usuwać wgrane zdjęcia.";
      elements.modeBadge.textContent = "Panel";
      elements.guestLink.value = data.guestUrl;
      elements.qrImage.src = data.qrImageUrl;
      state.adminLimits = data.limits;
      updateAdminStats(data.photoCount);
      await loadPhotos();
    } catch (error) {
      sessionStorage.removeItem(adminStorageKey);
      state.admin = "";
      state.mode = "admin-login";
      showAdminLogin(error.message);
    }
  }

  function renderSelectedFiles() {
    const files = Array.from(elements.photoInput.files || []);
    if (!files.length) {
      elements.selectedFiles.textContent = "";
      elements.selectedFiles.hidden = true;
      elements.uploadButton.hidden = true;
      return;
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    elements.selectedFiles.hidden = false;
    elements.uploadButton.hidden = false;
    elements.selectedFiles.innerHTML = `
      <strong>${files.length} ${photoWord(files.length)}</strong>
      <span>${formatBytes(totalSize)} łącznie</span>
    `;
  }

  function handlePhotoSelection() {
    const files = Array.from(elements.photoInput.files || []);
    const accepted = files.filter(isAcceptedImageFile);
    const rejectedCount = files.length - accepted.length;

    if (rejectedCount > 0) {
      if (accepted.length && window.DataTransfer) {
        const dataTransfer = new DataTransfer();
        accepted.forEach((file) => dataTransfer.items.add(file));
        elements.photoInput.files = dataTransfer.files;
        setStatus(`Pominięto ${rejectedCount} ${fileWord(rejectedCount)} bez formatu zdjęcia.`, true);
      } else {
        elements.photoInput.value = "";
        setStatus("Wybierz tylko zdjęcia z galerii.", true);
      }
    } else if (files.length) {
      setStatus("");
    }

    renderSelectedFiles();
  }

  function isAcceptedImageFile(file) {
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    return file.type.startsWith("image/") || acceptedImageExtensions.has(extension);
  }

  function renderGallery() {
    const photos = sortedPhotos();
    const grid = activeGalleryGrid();
    const counter = activePhotoCounter();

    if (!grid || !counter) return;

    counter.textContent = `${photos.length} ${photoWord(photos.length)}`;
    grid.innerHTML = "";

    if (!photos.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>Galeria czeka na pierwsze zdjęcia</h3>
          <p>Po wgraniu kadry pojawią się tutaj automatycznie.</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    photos.forEach((photo) => fragment.appendChild(photoTile(photo)));
    grid.appendChild(fragment);
  }

  function photoTile(photo) {
    const article = document.createElement("article");
    article.className = "photo-tile";

    const mediaUrl = mediaUrlFor(photo);
    const canPreview = canPreviewPhoto(photo);
    const byline = photo.guestName ? escapeHtml(photo.guestName) : "Gość";
    const date = formatDate(photo.uploadedAt);

    if (canPreview) {
      const button = document.createElement("button");
      button.className = "photo-button";
      button.type = "button";
      button.innerHTML = `<img src="${mediaUrl}" alt="${escapeHtml(photo.note || photo.originalName || "Zdjęcie z wesela")}" loading="lazy">`;
      button.addEventListener("click", () => openLightbox(photo));
      article.appendChild(button);
    } else {
      const fallback = document.createElement("a");
      fallback.className = "photo-fallback";
      fallback.href = mediaUrl;
      fallback.textContent = "Pobierz HEIC";
      fallback.download = photo.originalName || "zdjęcie.heic";
      article.appendChild(fallback);
    }

    const meta = document.createElement("div");
    meta.className = "photo-meta";
    meta.innerHTML = `
      <strong>${byline}</strong>
      <span>${date}${photo.note ? ` · ${escapeHtml(photo.note)}` : ""}</span>
    `;
    article.appendChild(meta);

    if (state.mode === "admin") {
      const actions = document.createElement("div");
      actions.className = "photo-actions";

      const deleteButton = document.createElement("button");
      deleteButton.className = "danger-button";
      deleteButton.type = "button";
      deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>Usuń';
      deleteButton.addEventListener("click", () => deletePhoto(photo.id));

      actions.appendChild(deleteButton);
      article.appendChild(actions);
    }

    return article;
  }

  async function deletePhoto(id) {
    if (!window.confirm("Usunąć to zdjęcie z galerii?")) return;

    setStatus("Usuwam zdjęcie...");

    try {
      const response = await fetch(`/api/photos/${encodeURIComponent(id)}?admin=${encodeURIComponent(state.admin)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Nie udało się usunąć zdjęcia.");

      state.photos = state.photos.filter((photo) => photo.id !== id);
      renderGallery();
      updateAdminStats(state.photos.length);
      setStatus("Zdjęcie usunięte.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function openLightbox(photo) {
    const photos = previewablePhotos();
    const index = photos.findIndex((item) => item.id === photo.id);
    state.lightboxIndex = index >= 0 ? index : 0;
    renderLightboxPhoto();
    elements.lightbox.hidden = false;
    document.body.classList.add("no-scroll");
  }

  function renderLightboxPhoto() {
    const photos = previewablePhotos();
    const photo = photos[state.lightboxIndex];
    if (!photo) return closeLightbox();

    elements.lightboxImage.src = mediaUrlFor(photo);
    elements.lightboxImage.alt = photo.note || photo.originalName || "Zdjęcie z wesela";
    elements.lightboxCaption.textContent = lightboxCaption(photo, state.lightboxIndex, photos.length);
    elements.prevLightbox.disabled = photos.length < 2;
    elements.nextLightbox.disabled = photos.length < 2;
  }

  function showAdjacentPhoto(direction) {
    const photos = previewablePhotos();
    if (photos.length < 2) return;
    state.lightboxIndex = (state.lightboxIndex + direction + photos.length) % photos.length;
    renderLightboxPhoto();
  }

  function startSwipe(event) {
    state.swipeStartX = event.clientX;
    state.swipeStartY = event.clientY;
  }

  function finishSwipe(event) {
    const deltaX = event.clientX - state.swipeStartX;
    const deltaY = event.clientY - state.swipeStartY;
    const isHorizontalSwipe = Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4;

    if (!isHorizontalSwipe) return;
    showAdjacentPhoto(deltaX < 0 ? 1 : -1);
  }

  function closeLightbox() {
    elements.lightbox.hidden = true;
    elements.lightboxImage.src = "";
    state.lightboxIndex = -1;
    document.body.classList.remove("no-scroll");
  }

  async function copyGuestLink() {
    try {
      await navigator.clipboard.writeText(elements.guestLink.value);
      elements.copyLinkButton.textContent = "Skopiowano";
      setTimeout(() => {
        elements.copyLinkButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h11v11H8z"/><path d="M5 16H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h10a1 1 0 0 1 1 1v1"/></svg>Kopiuj link';
      }, 1600);
    } catch {
      elements.guestLink.select();
      document.execCommand("copy");
    }
  }

  function sortedPhotos() {
    return [...state.photos].sort((a, b) => {
      const left = new Date(a.uploadedAt).getTime();
      const right = new Date(b.uploadedAt).getTime();
      return state.sort === "oldest" ? left - right : right - left;
    });
  }

  function previewablePhotos() {
    return sortedPhotos().filter(canPreviewPhoto);
  }

  function canPreviewPhoto(photo) {
    return !/heic|heif/i.test(photo.contentType || "");
  }

  function lightboxCaption(photo, index, total) {
    const details = [photo.guestName, photo.note].filter(Boolean).join(" · ");
    const position = `${index + 1} z ${total}`;
    return details ? `${details} · ${position}` : position;
  }

  async function api(path) {
    const response = await fetch(path, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Nie udało się pobrać danych.");
    return payload;
  }

  function mediaUrlFor(photo) {
    const query = accessQuery();
    return `/media/${encodeURIComponent(photo.id)}?${query}`;
  }

  function accessQuery() {
    return state.mode === "admin"
      ? `admin=${encodeURIComponent(state.admin)}`
      : `token=${encodeURIComponent(state.token)}`;
  }

  function activeGalleryGrid() {
    return state.mode === "admin" ? elements.adminGalleryGrid : elements.galleryGrid;
  }

  function activePhotoCounter() {
    return state.mode === "admin" ? elements.adminPhotoCounter : elements.photoCounter;
  }

  function updateAdminStats(count) {
    const limit = state.adminLimits ? ` Limit: ${formatBytes(state.adminLimits.maxSingleFileBytes)} na plik.` : "";
    elements.adminStats.textContent = `${count} ${photoWord(count)} w galerii.${limit}`;
  }

  function showAdminLogin(message) {
    showOnly(elements.adminLoginView);
    elements.refreshButton.hidden = true;
    elements.modeBadge.textContent = "Panel";
    elements.pageTitle.textContent = "Panel administratora";
    elements.pageLead.textContent = "Zaloguj się hasłem, żeby zarządzać zdjęciami i kodem QR.";
    setAdminLoginStatus(message || "");
    setTimeout(() => elements.adminPassword.focus(), 0);
  }

  function showLocked(message) {
    showOnly(elements.lockedView);
    elements.refreshButton.hidden = true;
    elements.modeBadge.textContent = "Zamknięte";
    elements.pageTitle.textContent = "Prywatna galeria";
    elements.pageLead.textContent = message || "Otwórz poprawny link do galerii.";
  }

  function showOnly(active) {
    [elements.guestView, elements.adminView, elements.adminLoginView, elements.lockedView].forEach((view) => {
      view.hidden = view !== active;
    });
  }

  function setBusy(message) {
    setStatus(message);
  }

  function setStatus(message, isError) {
    const statusElement = state.mode === "admin" ? elements.adminStatusMessage : elements.statusMessage;
    if (!statusElement) return;
    statusElement.textContent = message || "";
    statusElement.classList.toggle("error", Boolean(isError));
  }

  function setAdminLoginStatus(message, isError) {
    elements.adminLoginStatus.textContent = message || "";
    elements.adminLoginStatus.classList.toggle("error", Boolean(isError));
  }

  function photoWord(count) {
    if (count === 1) return "zdjęcie";
    if (count > 1 && count < 5) return "zdjęcia";
    return "zdjęć";
  }

  function fileWord(count) {
    if (count === 1) return "plik";
    if (count > 1 && count < 5) return "pliki";
    return "plików";
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
