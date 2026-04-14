/* ══════════════════════════════════════════════════════════════════
   La Antigua Barbería — Módulo de Reservas
   Requiere: firebase-app-compat.js + firebase-firestore-compat.js
   Fallback:  localStorage (modo demo cuando Firebase no está listo)
   ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── Constantes ──────────────────────────────────────────────── */

  const BARBEROS = [
    {
      id: "don-ramon",
      nombre: "Don Ramón",
      especialidad: "Corte clásico y afeitado tradicional",
      inicial: "R",
    },
    {
      id: "el-guero",
      nombre: "El Güero",
      especialidad: "Diseño de barba y degradado",
      inicial: "G",
    },
    {
      id: "la-morena",
      nombre: "La Morena",
      especialidad: "Corte moderno y peinados vintage",
      inicial: "M",
    },
  ];

  const SLOTS = [
    "09:00","09:30","10:00","10:30","11:00","11:30","12:00",
    "13:00","13:30","14:00","14:30","15:00","15:30","16:00",
    "16:30","17:00","17:30","18:00","18:30",
  ];

  const DIAS_SEMANA  = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const DIAS_LARGO   = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  const MESES_LARGO  = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const MESES_CORTO  = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

  const LS_KEY = "antigua_barberia_reservas";
  const WA_NUM = "526623124199";

  /* ── Estado ──────────────────────────────────────────────────── */

  const state = {
    barbero:   null,   // objeto del BARBEROS[]
    fecha:     null,   // "YYYY-MM-DD"
    hora:      null,   // "HH:MM"
    calYear:   new Date().getFullYear(),
    calMonth:  new Date().getMonth(),
  };

  let currentOcupados  = [];   // slots ya reservados (sincronizados con Firestore o LS)
  let slotsUnsubscribe = null; // función para cancelar el listener de Firestore

  /* ── Detección de Firebase ───────────────────────────────────── */

  function isFirebaseReady() {
    try {
      return (
        typeof firebase !== "undefined" &&
        typeof db !== "undefined" &&
        db !== null &&
        firebase.apps.length > 0 &&
        !firebase.app().options.apiKey.includes("PEGA_AQUI")
      );
    } catch (_) {
      return false;
    }
  }

  /* ── Modo demo (localStorage) ────────────────────────────────── */

  function lsGetAll() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  function lsGetOcupados(barberoId, fecha) {
    return lsGetAll()
      .filter((r) => r.barbero_id === barberoId && r.fecha === fecha)
      .map((r) => r.hora);
  }

  function lsSave(data) {
    const all = lsGetAll();
    const conflict = all.some(
      (r) =>
        r.barbero_id === data.barbero_id &&
        r.fecha      === data.fecha &&
        r.hora       === data.hora
    );
    if (conflict) throw new Error("SLOT_TAKEN");
    data.id        = Date.now().toString();
    data.timestamp = new Date().toISOString();
    all.push(data);
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  }

  /* ── Utilidades de fecha ─────────────────────────────────────── */

  /** Devuelve "YYYY-MM-DD" para un día del mes */
  function toDateStr(year, month, day) {
    return (
      year + "-" +
      String(month + 1).padStart(2, "0") + "-" +
      String(day).padStart(2, "0")
    );
  }

  /** "2025-04-20" → "Domingo 20 de abril de 2025" */
  function formatDateDisplay(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    return DIAS_LARGO[dow] + " " + d + " de " + MESES_CORTO[m - 1] + " de " + y;
  }

  /* ── Helpers DOM ─────────────────────────────────────────────── */

  function el(id) { return document.getElementById(id); }

  /* ── Gestión de pasos ────────────────────────────────────────── */

  function unlockStep(n) {
    const s = el("res-step-" + n);
    if (s) s.classList.remove("res-locked");
  }
  function lockStep(n) {
    const s = el("res-step-" + n);
    if (s) s.classList.add("res-locked");
  }
  function checkStep(n) {
    const c = el("res-check-" + n);
    if (c) c.classList.add("res-checked");
  }
  function uncheckStep(n) {
    const c = el("res-check-" + n);
    if (c) c.classList.remove("res-checked");
  }
  function updateConfirmBtn() {
    const btn = el("res-btn-confirmar");
    if (btn) btn.disabled = !(state.barbero && state.fecha && state.hora);
  }

  /* ── Paso 1: Barberos ────────────────────────────────────────── */

  function renderBarberos() {
    const body = el("res-body-1");
    if (!body) return;

    body.innerHTML =
      '<div class="res-barbers-grid">' +
      BARBEROS.map((b) => {
        const sel = state.barbero && state.barbero.id === b.id;
        return (
          '<div class="res-barber-card' + (sel ? " res-selected" : "") +
          '" data-id="' + b.id + '">' +
          '<div class="res-barber-avatar">' + b.inicial + "</div>" +
          '<div class="res-barber-name">' + b.nombre + "</div>" +
          '<div class="res-barber-esp">'  + b.especialidad + "</div>" +
          (sel ? '<div class="res-barber-tag">✓ Seleccionado</div>' : "") +
          "</div>"
        );
      }).join("") +
      "</div>";

    body.querySelectorAll(".res-barber-card").forEach((card) => {
      card.addEventListener("click", () => selectBarbero(card.dataset.id));
    });
  }

  function selectBarbero(id) {
    const barbero = BARBEROS.find((b) => b.id === id);
    if (!barbero) return;

    // Cancelar listener anterior
    if (slotsUnsubscribe) { slotsUnsubscribe(); slotsUnsubscribe = null; }

    state.barbero  = barbero;
    state.fecha    = null;
    state.hora     = null;
    state.calYear  = new Date().getFullYear();
    state.calMonth = new Date().getMonth();
    currentOcupados = [];

    checkStep(1);
    renderBarberos();

    // Desbloquear paso 2 y limpiar pasos posteriores
    unlockStep(2);
    uncheckStep(2);
    renderCalendar();

    lockStep(3);
    uncheckStep(3);
    const body3 = el("res-body-3");
    if (body3) body3.innerHTML = "";

    updateConfirmBtn();

    // Scroll suave al paso 2
    const step2 = el("res-step-2");
    if (step2) setTimeout(() => step2.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
  }

  /* ── Paso 2: Calendario ──────────────────────────────────────── */

  function renderCalendar() {
    const body = el("res-body-2");
    if (!body) return;

    const today   = new Date();
    today.setHours(0, 0, 0, 0);

    // Máximo 2 meses hacia adelante (comparamos year*12+month)
    const currentYM = today.getFullYear() * 12 + today.getMonth();
    const maxYM     = currentYM + 2;
    const viewYM    = state.calYear * 12 + state.calMonth;

    const canPrev   = viewYM > currentYM;
    const canNext   = viewYM < maxYM;

    const firstDow  = new Date(state.calYear, state.calMonth, 1).getDay();
    const daysInMo  = new Date(state.calYear, state.calMonth + 1, 0).getDate();

    // Encabezado con navegación
    let html =
      '<div class="res-cal-container">' +
      '<div class="res-cal-nav">' +
      '<button class="res-cal-nav-btn" id="res-cal-prev"' + (canPrev ? "" : " disabled") + ">‹</button>" +
      '<span class="res-cal-title">' + MESES_LARGO[state.calMonth] + " " + state.calYear + "</span>" +
      '<button class="res-cal-nav-btn" id="res-cal-next"' + (canNext ? "" : " disabled") + ">›</button>" +
      "</div>" +
      '<div class="res-cal-grid">';

    // Cabeceras de día
    DIAS_SEMANA.forEach((d) => {
      html += '<div class="res-cal-head">' + d + "</div>";
    });

    // Celdas vacías antes del día 1
    for (let i = 0; i < firstDow; i++) {
      html += '<div class="res-cal-empty"></div>';
    }

    // Días del mes
    for (let d = 1; d <= daysInMo; d++) {
      const dayDate = new Date(state.calYear, state.calMonth, d);
      const dateStr = toDateStr(state.calYear, state.calMonth, d);
      const isPast  = dayDate < today;
      const isSun   = dayDate.getDay() === 0;
      const isSel   = state.fecha === dateStr;
      const isOff   = isPast || isSun;

      let cls  = "res-cal-day ";
      let attr = "";
      if (isOff)       { cls += "res-day-disabled"; }
      else if (isSel)  { cls += "res-day-selected"; attr = 'data-date="' + dateStr + '"'; }
      else             { cls += "res-day-available"; attr = 'data-date="' + dateStr + '"'; }

      html += '<div class="' + cls + '"' + (attr ? " " + attr : "") + ">" + d + "</div>";
    }

    html += "</div></div>"; // .res-cal-grid + .res-cal-container

    body.innerHTML = html;

    // Navegación
    const btnPrev = el("res-cal-prev");
    const btnNext = el("res-cal-next");

    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (state.calMonth === 0) { state.calMonth = 11; state.calYear--; }
        else { state.calMonth--; }
        renderCalendar();
      });
    }
    if (btnNext) {
      btnNext.addEventListener("click", () => {
        if (state.calMonth === 11) { state.calMonth = 0; state.calYear++; }
        else { state.calMonth++; }
        renderCalendar();
      });
    }

    // Selección de día
    body.querySelectorAll("[data-date]").forEach((cell) => {
      cell.addEventListener("click", () => selectFecha(cell.dataset.date));
    });
  }

  function selectFecha(dateStr) {
    if (slotsUnsubscribe) { slotsUnsubscribe(); slotsUnsubscribe = null; }

    state.fecha = dateStr;
    state.hora  = null;
    currentOcupados = [];

    checkStep(2);
    renderCalendar();

    unlockStep(3);
    uncheckStep(3);
    subscribeToSlots();
    updateConfirmBtn();

    const step3 = el("res-step-3");
    if (step3) setTimeout(() => step3.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
  }

  /* ── Paso 3: Franjas horarias ────────────────────────────────── */

  function renderSlotsLoading() {
    const body = el("res-body-3");
    if (body) body.innerHTML = '<div class="res-slots-loading">Cargando disponibilidad…</div>';
  }

  function renderSlots(ocupados) {
    const body = el("res-body-3");
    if (!body) return;

    // Si el slot seleccionado ya fue tomado, limpiar selección
    if (state.hora && ocupados.includes(state.hora)) {
      state.hora = null;
      uncheckStep(3);
      updateConfirmBtn();
      showErrorModal(
        "Este horario acaba de ser reservado por otro cliente. Por favor selecciona uno diferente."
      );
    }

    let html = '<div class="res-slots-grid">';
    SLOTS.forEach((slot) => {
      const isOcupado = ocupados.includes(slot);
      const isSel     = state.hora === slot;
      let cls = "res-slot ";
      if (isOcupado)   cls += "res-slot-ocupado";
      else if (isSel)  cls += "res-slot-selected";
      else             cls += "res-slot-libre";

      html +=
        '<button class="' + cls + '"' +
        (isOcupado ? " disabled" : ' data-hora="' + slot + '"') +
        ">" + slot +
        (isOcupado ? '<span class="res-ocupado-label">Ocupado</span>' : "") +
        "</button>";
    });
    html += "</div>";

    body.innerHTML = html;

    body.querySelectorAll("[data-hora]").forEach((btn) => {
      btn.addEventListener("click", () => selectHora(btn.dataset.hora));
    });
  }

  function subscribeToSlots() {
    if (!state.barbero || !state.fecha) return;
    renderSlotsLoading();

    if (!isFirebaseReady()) {
      // Modo demo: leer localStorage de forma síncrona
      currentOcupados = lsGetOcupados(state.barbero.id, state.fecha);
      renderSlots(currentOcupados);
      return;
    }

    try {
      const query = db
        .collection("reservas")
        .where("barbero_id", "==", state.barbero.id)
        .where("fecha",      "==", state.fecha);

      slotsUnsubscribe = query.onSnapshot(
        (snapshot) => {
          currentOcupados = snapshot.docs.map((doc) => doc.data().hora);
          renderSlots(currentOcupados);
        },
        (err) => {
          console.warn("[Reservas] Firestore error:", err);
          currentOcupados = lsGetOcupados(state.barbero.id, state.fecha);
          renderSlots(currentOcupados);
        }
      );
    } catch (e) {
      console.warn("[Reservas] query error:", e);
      currentOcupados = [];
      renderSlots(currentOcupados);
    }
  }

  function selectHora(hora) {
    state.hora = hora;
    checkStep(3);
    renderSlots(currentOcupados); // actualiza la selección visual inmediatamente
    updateConfirmBtn();

    // Scroll al botón confirmar
    const btn = el("res-btn-confirmar");
    if (btn) setTimeout(() => btn.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  /* ── Modal: abrir / cerrar ───────────────────────────────────── */

  function openModal() {
    if (!state.barbero || !state.fecha || !state.hora) return;

    // Llenar resumen
    const summary = el("res-summary");
    if (summary) {
      summary.innerHTML =
        buildSummaryRow("✂️ Barbero", state.barbero.nombre) +
        buildSummaryRow("📅 Fecha",   formatDateDisplay(state.fecha)) +
        buildSummaryRow("🕐 Hora",    state.hora);
    }

    // Limpiar formulario
    const nombre    = el("res-nombre");
    const telefono  = el("res-telefono");
    if (nombre)   nombre.value   = "";
    if (telefono) telefono.value = "";
    hideErrorModal();

    const overlay = el("res-modal");
    if (overlay) {
      overlay.style.display = "flex";
      requestAnimationFrame(() => overlay.classList.add("res-modal-visible"));
    }
    if (nombre) setTimeout(() => nombre.focus(), 320);
  }

  function closeModal() {
    const overlay = el("res-modal");
    if (!overlay) return;
    overlay.classList.remove("res-modal-visible");
    setTimeout(() => { overlay.style.display = "none"; }, 320);
  }

  function buildSummaryRow(label, value) {
    return (
      '<div class="res-summary-row">' +
      '<span class="res-summary-label">' + label + "</span>" +
      '<span class="res-summary-val">'   + value + "</span>" +
      "</div>"
    );
  }

  function showErrorModal(msg) {
    const err = el("res-error-msg");
    if (err) { err.textContent = msg; err.style.display = "block"; }
  }
  function hideErrorModal() {
    const err = el("res-error-msg");
    if (err) err.style.display = "none";
  }

  /* ── Confirmar reserva ───────────────────────────────────────── */

  async function submitReserva() {
    const nombreInput    = el("res-nombre");
    const telefonoInput  = el("res-telefono");
    const nombre         = nombreInput   ? nombreInput.value.trim()   : "";
    const telefono       = telefonoInput ? telefonoInput.value.trim() : "";

    if (!nombre) {
      showErrorModal("Por favor ingresa tu nombre completo.");
      if (nombreInput) nombreInput.focus();
      return;
    }
    if (!telefono) {
      showErrorModal("Por favor ingresa tu número de teléfono.");
      if (telefonoInput) telefonoInput.focus();
      return;
    }
    hideErrorModal();

    const submitBtn = el("res-btn-submit");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Guardando…"; }

    const fechaDisplay = formatDateDisplay(state.fecha);
    const data = {
      barbero:       state.barbero.nombre,
      barbero_id:    state.barbero.id,
      fecha:         state.fecha,
      fecha_display: fechaDisplay,
      hora:          state.hora,
      cliente:       nombre,
      telefono:      telefono,
      estado:        "pendiente",
    };

    try {
      if (isFirebaseReady()) {
        // Verificar que el slot siga disponible
        const existing = await db
          .collection("reservas")
          .where("barbero_id", "==", data.barbero_id)
          .where("fecha",      "==", data.fecha)
          .where("hora",       "==", data.hora)
          .get();

        if (!existing.empty) throw new Error("SLOT_TAKEN");

        await db.collection("reservas").add({
          ...data,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        lsSave(data);
        // Actualizar ocupados locales para reflejar la nueva reserva
        currentOcupados = lsGetOcupados(data.barbero_id, data.fecha);
      }

      closeModal();
      openWhatsApp(data);
      showSuccess(data);

    } catch (e) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Confirmar y enviar a WhatsApp ↗";
      }

      if (e.message === "SLOT_TAKEN") {
        showErrorModal(
          "Este horario acaba de ser reservado. Por favor selecciona otro."
        );
        // Cerrar modal y refrescar slots tras 2 s
        setTimeout(() => {
          closeModal();
          state.hora = null;
          uncheckStep(3);
          subscribeToSlots();
          updateConfirmBtn();
        }, 2000);
      } else {
        showErrorModal(
          "Ocurrió un error al guardar tu reserva. Por favor intenta de nuevo."
        );
        console.error("[Reservas] Error al guardar:", e);
      }
    }
  }

  /* ── WhatsApp ────────────────────────────────────────────────── */

  function openWhatsApp(data) {
    const msg =
      "Hola, acabo de reservar en La Antigua Barbería 💈\n\n" +
      "👤 Nombre: "  + data.cliente       + "\n" +
      "✂️ Barbero: " + data.barbero       + "\n" +
      "📅 Fecha: "   + data.fecha_display + "\n" +
      "🕐 Hora: "    + data.hora          + "\n" +
      "📞 Tel: "     + data.telefono      + "\n\n" +
      "¡Nos vemos pronto!";
    window.open("https://wa.me/" + WA_NUM + "?text=" + encodeURIComponent(msg), "_blank");
  }

  /* ── Pantalla de éxito ───────────────────────────────────────── */

  function showSuccess(data) {
    const content = el("res-success-content");
    if (content) {
      content.innerHTML =
        '<div class="res-summary" style="margin-top:1.4rem;text-align:left">' +
        buildSummaryRow("👤 Cliente", data.cliente)       +
        buildSummaryRow("✂️ Barbero", data.barbero)       +
        buildSummaryRow("📅 Fecha",   data.fecha_display) +
        buildSummaryRow("🕐 Hora",    data.hora)          +
        buildSummaryRow("📞 Tel",     data.telefono)      +
        "</div>" +
        '<p class="res-success-note">Se ha abierto WhatsApp con los detalles de tu cita. ¡Te esperamos!</p>';
    }

    const overlay = el("res-success");
    if (overlay) {
      overlay.style.display = "flex";
      requestAnimationFrame(() => overlay.classList.add("res-modal-visible"));
    }
  }

  /* ── Resetear todo ───────────────────────────────────────────── */

  function resetAll() {
    // Cerrar pantalla de éxito
    const overlay = el("res-success");
    if (overlay) {
      overlay.classList.remove("res-modal-visible");
      setTimeout(() => { overlay.style.display = "none"; }, 320);
    }

    // Cancelar listener
    if (slotsUnsubscribe) { slotsUnsubscribe(); slotsUnsubscribe = null; }

    // Resetear estado
    state.barbero   = null;
    state.fecha     = null;
    state.hora      = null;
    state.calYear   = new Date().getFullYear();
    state.calMonth  = new Date().getMonth();
    currentOcupados = [];

    // Resetear UI
    [1, 2, 3].forEach((n) => uncheckStep(n));
    lockStep(2);
    lockStep(3);

    renderBarberos();
    const b2 = el("res-body-2"); if (b2) b2.innerHTML = "";
    const b3 = el("res-body-3"); if (b3) b3.innerHTML = "";

    updateConfirmBtn();

    // Volver arriba de la sección
    const section = el("reservas");
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── Inicialización ──────────────────────────────────────────── */

  function init() {
    // Mostrar badge demo si Firebase no está configurado
    if (!isFirebaseReady()) {
      const badge = el("res-demo-badge");
      if (badge) badge.style.display = "block";
    }

    // Renderizar barberos iniciales
    renderBarberos();

    // Botón confirmar (abre modal)
    const confirmBtn = el("res-btn-confirmar");
    if (confirmBtn) confirmBtn.addEventListener("click", openModal);

    // Cerrar modal
    const modalClose = el("res-modal-close");
    if (modalClose) modalClose.addEventListener("click", closeModal);

    // Clic en fondo del overlay cierra modal
    const modal = el("res-modal");
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });
    }

    // Enviar reserva
    const submitBtn = el("res-btn-submit");
    if (submitBtn) submitBtn.addEventListener("click", submitReserva);

    // Enter en campos del formulario
    ["res-nombre", "res-telefono"].forEach((id) => {
      const input = el(id);
      if (input) {
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") submitReserva();
        });
      }
    });

    // Nueva reserva (desde pantalla de éxito)
    const nuevaBtn = el("res-btn-nueva");
    if (nuevaBtn) nuevaBtn.addEventListener("click", resetAll);

    // Tecla Escape cierra cualquier overlay
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const m = el("res-modal");
      if (m && m.style.display !== "none") { closeModal(); return; }
      const s = el("res-success");
      if (s && s.style.display !== "none") resetAll();
    });
  }

  // Arrancar cuando el DOM esté listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
