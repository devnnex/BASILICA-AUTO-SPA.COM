/* ===============================
   AUTENTICACION Y SESION DIARIA
   =============================== */
const AUTH_STORAGE_KEY = "basilica-session";
let currentSession = null;
let sessionExpiryTimer = null;

function getStoredSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function saveSession(session) {
  currentSession = session;
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    // La sesion sigue viva en memoria aunque el navegador bloquee localStorage.
  }
}

function clearSession() {
  currentSession = null;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (error) {}
}

function getSessionToken() {
  return currentSession?.token || getStoredSession()?.token || "";
}

function getTodayMidnightTimestamp() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getSessionExpiry(session) {
  return Math.min(Number(session?.expiresAt || 0), getTodayMidnightTimestamp());
}

function metodoPagoTexto(metodo) {
  const labels = {
    efectivo: "Efectivo",
    transferencia: "Transferencia",
    bre_b: "Bre-B",
    mixto: "Mixto",
    pendiente: "Pendiente por pagar",
    sin_registrar: "Sin registrar"
  };
  return labels[metodo] || "Sin registrar";
}

const nativeFetch = window.fetch.bind(window);
window.fetch = function fetchConSesion(input, init) {
  if (typeof input === "string" && typeof API_URL !== "undefined" && input.startsWith(API_URL)) {
    const token = getSessionToken();
    if (token && !input.includes("sessionToken=")) {
      const glue = input.includes("?") ? "&" : "?";
      input = `${input}${glue}sessionToken=${encodeURIComponent(token)}`;
    }
  }
  return nativeFetch(input, init);
};

function scheduleSessionExpiry(session) {
  clearTimeout(sessionExpiryTimer);
  const expiresAt = getSessionExpiry(session);
  const delay = expiresAt - Date.now();

  if (delay <= 0) {
    cerrarSesion({ silent: true, expired: true });
    return;
  }

  sessionExpiryTimer = setTimeout(() => {
    cerrarSesion({ silent: true, expired: true });
  }, delay);
}

function setAuthenticatedUI(session) {
  document.documentElement.classList.remove("auth-checking");
  document.body.classList.remove("auth-checking");
  document.body.classList.add("is-authenticated");
  const user = document.getElementById("sessionUser");
  const role = document.getElementById("sessionRole");
  if (user) user.textContent = session?.nombre || session?.correo || "Usuario";
  if (role) role.textContent = session?.rol || "admin";
  configurarVisibilidadPorRol(session);
}

function configurarVisibilidadPorRol(session) {
  const esJefe = String(session?.rol || "").toLowerCase() === "jefe";
  const botonInteligencia = document.querySelector('.sidebar button[data-section="ganancias"]');
  const seccionInteligencia = document.getElementById("ganancias");
  const filtroAutor = document.getElementById("filtroIngresosAutor");
  const filtroFecha = document.getElementById("filtroIngresosFecha");
  const kpiMesCard = document.getElementById("kpiMesCard");
  const btnLimpiarHistorial = document.getElementById("btnLimpiarHistorial");

  botonInteligencia?.classList.toggle("hidden", !esJefe);
  seccionInteligencia?.classList.toggle("role-restricted", !esJefe);
  filtroAutor?.classList.toggle("hidden", !esJefe);
  kpiMesCard?.classList.toggle("hidden", !esJefe);
  btnLimpiarHistorial?.classList.toggle("hidden", !esJefe);

  if (filtroFecha) {
    filtroFecha.disabled = !esJefe;
    if (!esJefe) filtroFecha.value = "hoy";
  }
}

function setLoggedOutUI() {
  document.documentElement.classList.remove("auth-checking");
  document.body.classList.remove("auth-checking");
  document.body.classList.remove("is-authenticated");
  document.getElementById("loginPassword")?.focus();
}

function cerrarSesion(options = {}) {
  const token = getSessionToken();
  if (token && !options.silent) {
    fetch(`${API_URL}?action=logout&sessionToken=${encodeURIComponent(token)}`).catch(() => {});
  }

  clearTimeout(sessionExpiryTimer);
  clearSession();
  setLoggedOutUI();

  if (options.expired) {
    Swal.fire("Sesion finalizada", "Debes iniciar sesion nuevamente.", "info");
  }
}

function normalizarSessionDesdeLogin(resp) {
  return {
    token: resp.token,
    nombre: resp.nombre,
    correo: resp.correo,
    rol: resp.rol,
    expiresAt: Number(resp.expiresAt || getTodayMidnightTimestamp())
  };
}

function iniciarDashboardConSesion(session) {
  saveSession(session);
  setAuthenticatedUI(session);
  scheduleSessionExpiry(session);
  inicializarDashboard();
}

function configurarLogin() {
  const form = document.getElementById("loginForm");
  const btnLogout = document.getElementById("btnLogout");
  const btnSetupJefe = document.getElementById("btnSetupJefe");

  btnLogout?.addEventListener("click", () => cerrarSesion());
  btnSetupJefe?.addEventListener("click", abrirSetupJefeInicial);
  actualizarBotonSetupJefe();

  form?.addEventListener("submit", event => {
    event.preventDefault();

    const correo = document.getElementById("loginCorreo").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;
    const btn = document.getElementById("btnLogin");

    if (!correo || !password) return;
    btn.disabled = true;

    fetch(
      `${API_URL}?action=login` +
      `&correo=${encodeURIComponent(correo)}` +
      `&password=${encodeURIComponent(password)}`
    )
      .then(res => res.json())
      .then(resp => {
        if (!resp.ok) {
          Swal.fire("Acceso denegado", resp.error || "Credenciales incorrectas", "error");
          return;
        }

        document.getElementById("loginPassword").value = "";
        iniciarDashboardConSesion(normalizarSessionDesdeLogin(resp));
      })
      .catch(() => Swal.fire("Error", "No se pudo iniciar sesion.", "error"))
      .finally(() => {
        btn.disabled = false;
      });
  });
}

function actualizarBotonSetupJefe() {
  const btnSetupJefe = document.getElementById("btnSetupJefe");
  if (!btnSetupJefe) return;

  btnSetupJefe.classList.add("hidden");
  fetch(`${API_URL}?action=estadoSetup`)
    .then(res => res.json())
    .then(resp => {
      btnSetupJefe.classList.toggle("hidden", Boolean(resp.tieneJefe));
    })
    .catch(() => {
      btnSetupJefe.classList.add("hidden");
    });
}

function abrirSetupJefeInicial() {
  Swal.fire({
    title: "Primer jefe",
    html: `
      <input id="setupNombre" class="swal2-input" placeholder="Nombre">
      <input id="setupCorreo" type="email" class="swal2-input" placeholder="Correo">
      <input id="setupPassword" type="password" class="swal2-input" placeholder="Contrasena">
    `,
    confirmButtonText: "Crear jefe",
    showCancelButton: true,
    preConfirm: () => {
      const nombre = document.getElementById("setupNombre").value.trim();
      const correo = document.getElementById("setupCorreo").value.trim().toLowerCase();
      const password = document.getElementById("setupPassword").value;

      if (!nombre || !correo || !password) {
        Swal.showValidationMessage("Completa todos los campos");
        return false;
      }

      if (!correo.includes("@")) {
        Swal.showValidationMessage("Correo invalido");
        return false;
      }

      return { nombre, correo, password };
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    const { nombre, correo, password } = result.value;
    fetch(
      `${API_URL}?action=setupJefeInicial` +
      `&nombre=${encodeURIComponent(nombre)}` +
      `&correo=${encodeURIComponent(correo)}` +
      `&password=${encodeURIComponent(password)}`
    )
      .then(res => res.json())
      .then(resp => {
        if (resp.error) {
          Swal.fire("No se pudo crear", resp.error, "warning");
          return;
        }

        document.getElementById("loginCorreo").value = correo;
        Swal.fire("Jefe creado", "Ahora puedes iniciar sesion.", "success");
      })
      .catch(() => Swal.fire("Error", "No se pudo crear el jefe inicial.", "error"));
  });
}

function validarSesionGuardada() {
  const session = getStoredSession();
  if (!session?.token || getSessionExpiry(session) <= Date.now()) {
    clearSession();
    setLoggedOutUI();
    return Promise.resolve(false);
  }

  currentSession = session;
  iniciarDashboardConSesion(session);
  return Promise.resolve(true);
}

/* ===============================
   TEMA CLARO / NOCHE
   =============================== */
(function inicializarTemaGlobal() {
  const themeKey = "yacar-theme";

  function aplicarTema(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;

  document.querySelectorAll(".theme-toggle").forEach(btn => {
    btn.innerHTML = nextTheme === "dark"
      ? '<i class="fa-solid fa-moon" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-sun" aria-hidden="true"></i>';
    btn.setAttribute(
      "aria-label",
      nextTheme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo noche"
      );
    });
  }

  let savedTheme = "light";
  try {
    savedTheme = localStorage.getItem(themeKey) || "light";
  } catch (error) {
    savedTheme = "light";
  }

  aplicarTema(savedTheme);

  document.querySelectorAll(".theme-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      const nextTheme = currentTheme === "dark" ? "light" : "dark";

      try {
        localStorage.setItem(themeKey, nextTheme);
      } catch (error) {
        // El tema sigue funcionando aunque el navegador bloquee localStorage.
      }

      aplicarTema(nextTheme);
    });
  });
})();

/* ===============================
   RECOGIDAS PROGRAMADAS
   =============================== */
const listaRecogidas = document.getElementById("listaRecogidas");
let recogidasData = [];


/* ===============================
   SERVICIOS
   =============================== */
let serviciosData = [];

/* ===============================
   TRABAJADORES
   =============================== */
let trabajadoresData = [];

/* ===============================
   LIQUIDACIONES (estado)
=============================== */
let liquidacionesData = {};
let liquidacionesDetalle = [];
let liquidacionesExcluidas = new Set();
let liquidacionesCargadas = false;


//Variables globales de los graficos de ganancias/ingresos
let chartIngresosMes = null;
let chartTopServicios = null;





/* ===============================
   LAVADOS ACTIVOS
   =============================== */

const lista = document.getElementById("lista");
const buscadorActivos = document.getElementById("buscadorActivos");
const placaHistorialInput = document.getElementById("placaHistorialInput");
const placaHistorialResumen = document.getElementById("placaHistorialResumen");
const placaHistorialLista = document.getElementById("placaHistorialLista");



const trabNombre = document.getElementById("trabNombre");
const trabCorreo = document.getElementById("trabCorreo");
const trabRol = document.getElementById("trabRol");
const trabPassword = document.getElementById("trabPassword");
const srvNombre = document.getElementById("srvNombre");
const srvPrecio = document.getElementById("srvPrecio");
const buscadorServicios = document.getElementById("buscadorServicios");
const selectorServicios = document.getElementById("selectorServicios");
const buscadorTrabajadores = document.getElementById("buscadorTrabajadores");
const selectorTrabajadores = document.getElementById("selectorTrabajadores");
const buscadorLiquidaciones = document.getElementById("buscadorLiquidaciones");

let activosData = [];
const gastosPorLavado = new Map();
const gastosCargados = new Set();
const gastosCargando = new Set();
const ingresosPageSize = 12;
let ingresosPaginaActual = 1;

const kpiActivos = document.getElementById("kpiActivos");
const kpiActivosIngresos = document.getElementById("kpiActivosIngresos");
const kpiActivosGastos = document.getElementById("kpiActivosGastos");
const kpiActivosNeto = document.getElementById("kpiActivosNeto");
const appLoader = document.getElementById("loader");
const appLoaderText = appLoader?.querySelector(".loader-text");
let appLoaderCount = 0;

function showAppLoader(texto = "Cargando...") {
  appLoaderCount++;
  if (appLoaderText) appLoaderText.textContent = texto;
  appLoader?.classList.remove("hidden");
}

function hideAppLoader() {
  appLoaderCount = Math.max(0, appLoaderCount - 1);
  if (appLoaderCount === 0) {
    appLoader?.classList.add("hidden");
  }
}

function formatCOP(valor) {
  return Number(valor || 0).toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  });
}

function escapeHTML(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizarTexto(valor) {
  return String(valor ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function esOperarioAsignable(trabajador) {
  return Boolean(
    trabajador &&
    normalizarTexto(trabajador.estado) === "libre" &&
    !normalizarTexto(trabajador.rol) &&
    normalizarTexto(trabajador.activo || "activo") !== "inactivo"
  );
}

function esOperarioLiquidable(trabajador) {
  return Boolean(trabajador && !normalizarTexto(trabajador.rol));
}

function normalizarPlaca(valor) {
  return String(valor || "").trim().toUpperCase().replace(/\s+/g, "");
}

function toDateSafe(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !isNaN(valor)) return valor;
  if (typeof valor === "number") {
    const d = new Date(valor);
    return isNaN(d) ? null : d;
  }
  const d = new Date(valor);
  return isNaN(d) ? null : d;
}

function getLavadoStartTimestamp(lavado) {
  const inicio = toDateSafe(lavado?.hora);
  return inicio ? inicio.getTime() : null;
}

function formatTiempoCorto(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const horas = Math.floor(totalSeconds / 3600);
  const minutos = Math.floor((totalSeconds % 3600) / 60);
  const segundos = totalSeconds % 60;

  if (horas > 0) return `${horas}h ${String(minutos).padStart(2, "0")}m ${String(segundos).padStart(2, "0")}s`;
  if (minutos > 0) return `${minutos}m ${String(segundos).padStart(2, "0")}s`;
  return `${segundos}s`;
}

function crearTimerHTML(startTimestamp) {
  return `
    <div class="active-card-timer elapsed-timer" data-start="${startTimestamp || ""}">
      <span><b data-time-part="hours">00</b><small>Horas</small></span>
      <span><b data-time-part="minutes">00</b><small>Min</small></span>
      <span><b data-time-part="seconds">00</b><small>Seg</small></span>
    </div>
  `;
}

function updateElapsedTimers() {
  document.querySelectorAll(".elapsed-timer").forEach(timer => {
    const start = Number(timer.dataset.start);
    const parts = {
      hours: timer.querySelector('[data-time-part="hours"]'),
      minutes: timer.querySelector('[data-time-part="minutes"]'),
      seconds: timer.querySelector('[data-time-part="seconds"]')
    };

    if (!start || Number.isNaN(start)) {
      Object.values(parts).forEach(part => {
        if (part) part.textContent = "--";
      });
      return;
    }

    const totalSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const horas = Math.floor(totalSeconds / 3600);
    const minutos = Math.floor((totalSeconds % 3600) / 60);
    const segundos = totalSeconds % 60;

    if (parts.hours) parts.hours.textContent = String(horas).padStart(2, "0");
    if (parts.minutes) parts.minutes.textContent = String(minutos).padStart(2, "0");
    if (parts.seconds) parts.seconds.textContent = String(segundos).padStart(2, "0");
  });
}

function getGastosLavado(id) {
  return gastosPorLavado.get(String(id)) || [];
}

function totalGastosLavado(id) {
  return getGastosLavado(id).reduce(
    (acc, gasto) => acc + parsePrecio(gasto.costo),
    0
  );
}

function getAdicionalesLavado(lavado) {
  return Array.isArray(lavado?.adicionales) ? lavado.adicionales : [];
}

function renderAdicionalesLavado(lavado) {
  const adicionales = getAdicionalesLavado(lavado);
  if (!adicionales.length) {
    return `<div class="expense-row empty">Sin adicionales registrados para este lavado.</div>`;
  }

  return adicionales.map(adicional => `
    <div class="expense-row">
      <span>${escapeHTML(adicional.nombre || "Adicional")}</span>
      <b>${formatCOP(adicional.precio)}</b>
    </div>
  `).join("");
}

function renderResumenActivos() {
  if (!kpiActivos || !kpiActivosIngresos || !kpiActivosGastos || !kpiActivosNeto) return;

  const ingresos = activosData.reduce(
    (acc, lavado) => acc + parsePrecio(lavado.precio),
    0
  );

  const gastos = activosData.reduce(
    (acc, lavado) => acc + totalGastosLavado(lavado.id),
    0
  );

  kpiActivos.textContent = activosData.length;
  kpiActivosIngresos.textContent = formatCOP(ingresos);
  kpiActivosGastos.textContent = formatCOP(gastos);
  kpiActivosNeto.textContent = formatCOP(ingresos - gastos);
}

function cargarGastosLavado(lavadoId) {
  const id = String(lavadoId);
  if (gastosCargados.has(id) || gastosCargando.has(id)) return Promise.resolve(getGastosLavado(id));

  gastosCargando.add(id);

  return fetch(`${API_URL}?action=getGastosPorLavado&lavado_id=${encodeURIComponent(id)}`)
    .then(res => res.json())
    .then(data => {
      gastosPorLavado.set(id, Array.isArray(data) ? data : []);
      gastosCargados.add(id);
      return getGastosLavado(id);
    })
    .catch(err => {
      console.error("Error gastos lavado:", err);
      gastosPorLavado.set(id, []);
      return [];
    })
    .finally(() => {
      gastosCargando.delete(id);
      renderActivos();
      renderResumenActivos();
    });
}

/* ---------- Cargar desde API (solo fetch) ---------- */
function cargarActivos(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) showAppLoader("Cargando servicios activos...");

  return fetch(`${API_URL}?action=activos`)
    .then(res => res.json())
    .then(data => {
      activosData = Array.isArray(data) ? data : [];
      const idsActivos = new Set(activosData.map(lavado => String(lavado.id)));
      [...gastosPorLavado.keys()].forEach(id => {
        if (!idsActivos.has(id)) {
          gastosPorLavado.delete(id);
          gastosCargados.delete(id);
          gastosCargando.delete(id);
        }
      });
      renderActivos();
      renderResumenActivos();

    })
    .catch(err => {
      console.error("Error activos:", err);
      lista.innerHTML = "<p>Error cargando lavados</p>";
    })
    .finally(() => {
      if (!silent) hideAppLoader();
    });
}

/* ---------- Render + filtro (buscador) ---------- */
function renderActivos() {
  const q = buscadorActivos.value.toLowerCase().trim();
  const nuevosIds = new Set();

  activosData
    .filter(l => (l.placa || "").toLowerCase().includes(q))
    .forEach(l => {
      nuevosIds.add(String(l.id));

      let item = lista.querySelector(`[data-id="${l.id}"]`);

      if (!item) {
        item = document.createElement("div");
        item.className = "item";
        item.dataset.id = l.id;
        lista.appendChild(item);
      }

      cargarGastosLavado(l.id);

      const precio = parsePrecio(l.precio);
      const gastos = getGastosLavado(l.id);
      const totalGastos = totalGastosLavado(l.id);
      const neto = precio - totalGastos;
      const cargandoGastos = gastosCargando.has(String(l.id));
      const ultimoGasto = gastos[gastos.length - 1];
      const startTimestamp = getLavadoStartTimestamp(l);

      item.innerHTML = `
        <div class="active-card">
          <div class="active-card-header">
            <div>
              <div class="plate">${escapeHTML(l.placa || "-")}</div>
              <small>${new Date(l.hora).toLocaleString("es-CO")}</small>
            </div>
            <div class="active-card-status">
              <span class="state-pill">En proceso</span>
            </div>
          </div>

          <div class="active-card-meta">
            <span><i class="fa-solid fa-spray-can-sparkles"></i> ${escapeHTML(l.servicio || "-")}</span>
            <button class="worker-reassign" type="button"><i class="fa-solid fa-user"></i> ${escapeHTML(l.trabajador || "-")}</button>
          </div>

          ${crearTimerHTML(startTimestamp)}

          <div class="active-card-money">
            <div class="money-block">
              <small>Ingreso</small>
              <strong>${formatCOP(precio)}</strong>
            </div>
            <div class="money-block expense">
              <small>Gastos</small>
              <strong>${cargandoGastos ? "..." : formatCOP(totalGastos)}</strong>
            </div>
            <div class="money-block net">
              <small>Neto</small>
              <strong>${cargandoGastos ? "..." : formatCOP(neto)}</strong>
            </div>
          </div>

          <div class="expense-preview">
            ${renderAdicionalesLavado(l)}
            ${
              cargandoGastos
                ? `<div class="expense-row empty">Cargando gastos...</div>`
                : ultimoGasto
                  ? `<div class="expense-row"><span>${escapeHTML(ultimoGasto.material)} x ${escapeHTML(ultimoGasto.cantidad || 1)}</span><b>${formatCOP(ultimoGasto.costo)}</b></div>`
                  : `<div class="expense-row empty">Sin gastos registrados para este lavado.</div>`
            }
          </div>

          <div class="acciones">
            <button class="add-extra"><i class="fa-solid fa-circle-plus"></i> Adicional</button>
            <button class="add-expense"><i class="fa-solid fa-plus"></i> Gasto</button>
            <button class="ghost detail"><i class="fa-solid fa-list-check"></i> Ver gastos</button>
            <button class="print"><i class="fa-solid fa-print"></i> Recibo</button>
            <button class="delete cancel-active" title="Eliminar lavado activo"><i class="fa-solid fa-trash-can"></i> Eliminar</button>
            <button class="confirm"><i class="fa-solid fa-check"></i> Confirmar</button>
          </div>
        </div>
      `;

      item.querySelector(".add-expense").onclick = () => abrirModalGasto(l);
      item.querySelector(".add-extra").onclick = () => abrirModalAdicional(l);
      item.querySelector(".worker-reassign").onclick = () => abrirModalReasignarTrabajador(l);
      item.querySelector(".detail").onclick = () => abrirDetalleGastos(l);
      item.querySelector(".print").onclick = () => imprimirRecibo(l);
      item.querySelector(".cancel-active").onclick = () => eliminarLavadoActivo(l.id);
      item.querySelector(".confirm").onclick = () => confirmarLavado(l.id);

    });

  // Eliminar solo los que ya no existen
  [...lista.children].forEach(el => {
    if (!nuevosIds.has(el.dataset.id)) el.remove();
  });

  if (!lista.children.length) {
    lista.innerHTML = `<p class="empty-state">No hay lavados activos</p>`;
  }

  renderResumenActivos();
  updateElapsedTimers();
}

function abrirModalGasto(lavado) {
  SwalPremium.fire({
    title: `Gasto para ${lavado.placa}`,
    html: `
      <div class="swal-form-grid">
        <input id="gastoMaterial" class="swal2-input" placeholder="Material o insumo">
        <input id="gastoCantidad" class="swal2-input" type="number" min="0" step="0.01" placeholder="Cantidad" value="1">
        <input id="gastoCosto" class="swal2-input" type="number" min="0" step="100" placeholder="Costo total">
      </div>
    `,
    confirmButtonText: "Guardar gasto",
    cancelButtonText: "Cancelar",
    showCancelButton: true,
    preConfirm: () => {
      const material = document.getElementById("gastoMaterial").value.trim();
      const cantidad = Number(document.getElementById("gastoCantidad").value || 0);
      const costo = Number(document.getElementById("gastoCosto").value || 0);

      if (!material) {
        Swal.showValidationMessage("El material es obligatorio");
        return false;
      }

      if (cantidad <= 0) {
        Swal.showValidationMessage("La cantidad debe ser mayor a cero");
        return false;
      }

      if (costo < 0) {
        Swal.showValidationMessage("El costo no puede ser negativo");
        return false;
      }

      return { material, cantidad, costo };
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    const { material, cantidad, costo } = result.value;

    const url =
      `${API_URL}?action=agregarGastoMaterial` +
      `&lavado_id=${encodeURIComponent(lavado.id)}` +
      `&material=${encodeURIComponent(material)}` +
      `&cantidad=${encodeURIComponent(cantidad)}` +
      `&costo=${encodeURIComponent(costo)}`;

    fetch(url)
      .then(res => res.json())
      .then(resp => {
        if (resp.error) {
          SwalPremium.fire("Error", resp.error, "error");
          return;
        }

        gastosCargados.delete(String(lavado.id));
        return cargarGastosLavado(lavado.id).then(() => {
          SwalPremium.fire({
            icon: "success",
            title: "Gasto guardado",
            timer: 1200,
            showConfirmButton: false
          });
        });
      })
      .catch(() => {
        SwalPremium.fire("Error", "No se pudo guardar el gasto", "error");
      });
  });
}

function abrirDetalleGastos(lavado) {
  cargarGastosLavado(lavado.id).then(gastos => {
    const total = gastos.reduce((acc, gasto) => acc + parsePrecio(gasto.costo), 0);
    const precio = parsePrecio(lavado.precio);

    SwalPremium.fire({
      title: `Gastos de ${lavado.placa}`,
      html: `
        <div class="swal-summary">
          <span>Ingreso: <b>${formatCOP(precio)}</b></span>
          <span>Gastos: <b>${formatCOP(total)}</b></span>
          <span>Neto: <b>${formatCOP(precio - total)}</b></span>
        </div>
        <div class="swal-expense-list">
          ${
            gastos.length
              ? gastos.map(gasto => `
                  <div>
                    <span>${escapeHTML(gasto.material)} x ${escapeHTML(gasto.cantidad || 1)}</span>
                    <b>${formatCOP(gasto.costo)}</b>
                  </div>
                `).join("")
              : `<p>Este lavado todavia no tiene gastos registrados.</p>`
          }
        </div>
      `,
      confirmButtonText: "Cerrar"
    });
  });
}

function abrirModalAdicional(lavado) {
  SwalPremium.fire({
    title: `Adicional para ${lavado.placa}`,
    html: `
      <div class="swal-form-grid">
        <input id="adicionalNombre" class="swal2-input" placeholder="Nombre del adicional">
        <input id="adicionalPrecio" class="swal2-input" type="number" min="0" step="100" placeholder="Valor adicional">
      </div>
    `,
    confirmButtonText: "Agregar adicional",
    cancelButtonText: "Cancelar",
    showCancelButton: true,
    preConfirm: () => {
      const nombre = document.getElementById("adicionalNombre").value.trim();
      const precio = Number(document.getElementById("adicionalPrecio").value || 0);

      if (!nombre) {
        Swal.showValidationMessage("El nombre del adicional es obligatorio");
        return false;
      }

      if (precio <= 0) {
        Swal.showValidationMessage("El valor debe ser mayor a cero");
        return false;
      }

      return { nombre, precio };
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    const { nombre, precio } = result.value;
    showAppLoader("Agregando adicional...");

    fetch(
      `${API_URL}?action=agregarAdicionalLavado` +
      `&id=${encodeURIComponent(lavado.id)}` +
      `&nombre=${encodeURIComponent(nombre)}` +
      `&precio=${encodeURIComponent(precio)}`
    )
      .then(res => res.json())
      .then(resp => {
        if (resp.error) {
          SwalPremium.fire("Error", resp.error, "error");
          return;
        }

        return cargarActivos({ silent: true }).then(() => {
          SwalPremium.fire({
            icon: "success",
            title: "Adicional agregado",
            timer: 1200,
            showConfirmButton: false
          });
        });
      })
      .catch(() => SwalPremium.fire("Error", "No se pudo agregar el adicional", "error"))
      .finally(() => hideAppLoader());
  });
}

function abrirModalReasignarTrabajador(lavado) {
  const libres = trabajadoresData.filter(t => esOperarioAsignable(t) && t.nombre !== lavado.trabajador);

  if (!libres.length) {
    SwalPremium.fire("Sin disponibilidad", "No hay trabajadores libres para reasignar.", "info");
    return;
  }

  SwalPremium.fire({
    title: `Reasignar ${lavado.placa}`,
    html: `
      <select id="nuevoTrabajadorLavado" class="swal2-input">
        <option value="">Selecciona trabajador libre</option>
        ${libres.map(t => `<option value="${escapeHTML(t.nombre)}">${escapeHTML(t.nombre)}</option>`).join("")}
      </select>
    `,
    confirmButtonText: "Reasignar",
    cancelButtonText: "Cancelar",
    showCancelButton: true,
    preConfirm: () => {
      const trabajador = document.getElementById("nuevoTrabajadorLavado").value;
      if (!trabajador) {
        Swal.showValidationMessage("Selecciona un trabajador");
        return false;
      }
      return { trabajador };
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    showAppLoader("Reasignando trabajador...");
    fetch(
      `${API_URL}?action=reasignarTrabajador` +
      `&id=${encodeURIComponent(lavado.id)}` +
      `&trabajador=${encodeURIComponent(result.value.trabajador)}`
    )
      .then(res => res.json())
      .then(resp => {
        if (resp.error) {
          SwalPremium.fire("Error", resp.error, "error");
          return;
        }

        return Promise.all([
          cargarActivos({ silent: true }),
          cargarTrabajadores({ silent: true })
        ]).then(() => {
          SwalPremium.fire({
            icon: "success",
            title: "Trabajador reasignado",
            timer: 1200,
            showConfirmButton: false
          });
        });
      })
      .catch(() => SwalPremium.fire("Error", "No se pudo reasignar el trabajador", "error"))
      .finally(() => hideAppLoader());
  });
}

/* ---------- IMPRIMIR RECIBO A4 ---------- */
function imprimirRecibo(servicio) {
  const win = window.open("", "PRINT", "width=1600,height=1800");

  win.document.write(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>RECIBO</title>

<style>
  @page {
    size: A4;
    margin: 6mm;
  }

  @media print {
    * {
      box-sizing: border-box;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    body {
      margin: 0;
      padding: 0;
      font-family: "Courier New", monospace;
      font-size: 30px; /* +2px */
      font-weight: 800;
      color: #000;
      background: #fff;
    }

    .recibo {
      width: 100%;
      height: 100%;
      padding: 6mm;
    }

    .center {
      text-align: center;
    }

    /* LOGO */
    .logo {
      max-width: 320px;
      margin: 0 auto 16px;
      display: block;
    }

    /* TITULOS */
    .title {
      font-size: 52px; /* +2px */
      font-weight: 900;
      margin-bottom: 6px;
    }

    .subtitle {
      font-size: 30px; /* +2px */
      font-weight: 800;
      margin-bottom: 22px;
    }

    /* LINEA */
    .line {
      border-top: 4px dashed #000;
      margin: 22px 0;
    }

    /* FILAS */
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 14px 0;
      font-size: 32px; /* +2px */
      font-weight: 900;
    }

    .label {
      font-weight: 900;
    }

    .value {
      text-align: right;
      font-weight: 900;
    }

    /* TOTAL (NO SE TOCA) */
    .total-box {
      border: 4px dashed #000;
      padding: 24px;
      margin-top: 26px;
    }

    .total-box .label {
      font-size: 30px; /* IGUAL */
    }

    .total {
      font-size: 64px; /* IGUAL */
      font-weight: 900;
      text-align: center;
      margin-top: 10px;
    }

    /* FOOTER */
    .footer {
      font-size: 26px; /* +2px */
      font-weight: 800;
      text-align: center;
      margin-top: 26px;
    }
  }
</style>
</head>

<body>

<div class="recibo">

  <div class="center">
    <img src="images/logo.png" class="logo" alt="LOGO">
    <div class="title">LAVADERO</div>
    <div class="subtitle">RECIBO DE SERVICIO</div>
  </div>

  <div class="line"></div>

  <div class="row">
    <div class="label">PLACA</div>
    <div class="value">${servicio.placa}</div>
  </div>

  <div class="row">
    <div class="label">SERVICIO</div>
    <div class="value">${servicio.servicio}</div>
  </div>

  <div class="row">
    <div class="label">TRABAJADOR</div>
    <div class="value">${servicio.trabajador}</div>
  </div>

  <div class="row">
    <div class="label">FECHA</div>
    <div class="value">
      ${new Date(servicio.hora).toLocaleString("es-CO")}
    </div>
  </div>

  <div class="line"></div>

  <div class="total-box">
    <div class="center label">TOTAL A PAGAR</div>
    <div class="total">
      $${Number(servicio.precio).toLocaleString("es-CO")}
    </div>
  </div>

  <div class="footer">
    Â¡GRACIAS POR SU VISITA!<br>
    CONSERVE ESTE RECIBO
  </div>

</div>

<script>
  window.onload = function () {
    window.print();
    window.onafterprint = () => window.close();
  };
</script>

</body>
</html>
  `);

  win.document.close();
}

function contarVisitasPlaca(placa) {
  const placaNormalizada = normalizarPlaca(placa);
  if (!placaNormalizada || !Array.isArray(ingresosDetalle)) return 0;

  return ingresosDetalle.filter(i =>
    normalizarPlaca(i.placa) === placaNormalizada
  ).length;
}

function getHistorialLocalPlaca(placa) {
  const placaNormalizada = normalizarPlaca(placa);
  if (!placaNormalizada || !Array.isArray(ingresosDetalle)) return [];

  return ingresosDetalle
    .filter(i => normalizarPlaca(i.placa) === placaNormalizada)
    .sort((a, b) => Number(toTimestamp(b.fecha) || 0) - Number(toTimestamp(a.fecha) || 0));
}

function renderHistorialPlaca(placa, registros = [], cargando = false) {
  if (!placaHistorialResumen || !placaHistorialLista) return;

  const placaNormalizada = normalizarPlaca(placa);

  if (!placaNormalizada) {
    placaHistorialResumen.innerHTML = `
      <div>
        <strong>Sin placa seleccionada</strong>
        <small>Historial comercial del cliente</small>
      </div>
    `;
    placaHistorialLista.innerHTML = "";
    return;
  }

  if (cargando) {
    placaHistorialResumen.innerHTML = `
      <div>
        <strong>${escapeHTML(placaNormalizada)}</strong>
        <small>Consultando historial...</small>
      </div>
    `;
    placaHistorialLista.innerHTML = "";
    return;
  }

  const totalGastado = registros.reduce((acc, item) => acc + parsePrecio(item.precio), 0);
  const ultimaVisita = registros[0];

  placaHistorialResumen.innerHTML = `
    <div>
      <strong>${escapeHTML(placaNormalizada)}</strong>
      <small>${registros.length} ${registros.length === 1 ? "visita registrada" : "visitas registradas"}</small>
    </div>
    <div>
      <strong>${formatCOP(totalGastado)}</strong>
      <small>Total historico</small>
    </div>
    <div>
      <strong>${escapeHTML(ultimaVisita?.servicio || "-")}</strong>
      <small>Ultimo servicio</small>
    </div>
  `;

  if (!registros.length) {
    placaHistorialLista.innerHTML = `<p class="empty-state">No hay servicios completados para esta placa.</p>`;
    return;
  }

  placaHistorialLista.innerHTML = registros.slice(0, 8).map(item => {
    const fecha = item.fecha ? new Date(item.fecha).toLocaleString("es-CO") : "-";
    const tiempo = item.tiempo || item.duracion || "-";

    return `
      <article class="plate-history-item">
        <div>
          <strong>${escapeHTML(item.servicio || "Servicio")}</strong>
          <small>${escapeHTML(fecha)} - ${escapeHTML(item.trabajador || "Sin trabajador")}</small>
        </div>
        <div>
          <b>${formatCOP(item.precio)}</b>
          <small>${escapeHTML(tiempo)}</small>
        </div>
      </article>
    `;
  }).join("");
}

function cargarHistorialPlaca(placa) {
  const placaNormalizada = normalizarPlaca(placa);

  if (!placaNormalizada) {
    renderHistorialPlaca("");
    return;
  }

  renderHistorialPlaca(placaNormalizada, [], true);

  fetch(`${API_URL}?action=historialPlaca&placa=${encodeURIComponent(placaNormalizada)}`)
    .then(res => res.json())
    .then(data => {
      if (data?.error) {
        renderHistorialPlaca(placaNormalizada, getHistorialLocalPlaca(placaNormalizada));
        return;
      }

      const registros = Array.isArray(data?.detalle)
        ? data.detalle
        : getHistorialLocalPlaca(placaNormalizada);

      renderHistorialPlaca(placaNormalizada, registros);
    })
    .catch(() => {
      renderHistorialPlaca(placaNormalizada, getHistorialLocalPlaca(placaNormalizada));
    });
}

function seleccionarPlacaHistorial(placa) {
  if (!placaHistorialInput) return;

  placaHistorialInput.value = normalizarPlaca(placa);
  cargarHistorialPlaca(placaHistorialInput.value);

}

function renderHistorialPlacaModal(placa, registros = [], cargando = false) {
  const placaNormalizada = normalizarPlaca(placa);

  if (!placaNormalizada) {
    return `
      <div class="modal-history-empty">
        Digita una placa para ver frecuencia, fechas, duracion y servicios adquiridos.
      </div>
    `;
  }

  if (cargando) {
    return `
      <div class="modal-history-loading">
        <div class="section-spinner"></div>
        <span>Consultando historial de ${escapeHTML(placaNormalizada)}...</span>
      </div>
    `;
  }

  const totalGastado = registros.reduce((acc, item) => acc + parsePrecio(item.precio), 0);
  const servicios = registros.reduce((acc, item) => {
    const nombre = item.servicio || "Servicio";
    acc[nombre] = (acc[nombre] || 0) + 1;
    return acc;
  }, {});
  const servicioFavorito = Object.entries(servicios).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

  if (!registros.length) {
    return `
      <div class="modal-history-summary">
        <div><strong>${escapeHTML(placaNormalizada)}</strong><small>0 visitas registradas</small></div>
        <div><strong>${formatCOP(0)}</strong><small>Total historico</small></div>
        <div><strong>-</strong><small>Servicio frecuente</small></div>
      </div>
      <div class="modal-history-empty">No hay servicios completados para esta placa.</div>
    `;
  }

  return `
    <div class="modal-history-summary">
      <div><strong>${escapeHTML(placaNormalizada)}</strong><small>${registros.length} ${registros.length === 1 ? "visita" : "visitas"}</small></div>
      <div><strong>${formatCOP(totalGastado)}</strong><small>Total historico</small></div>
      <div><strong>${escapeHTML(servicioFavorito)}</strong><small>Servicio frecuente</small></div>
    </div>
    <div class="modal-history-list">
      ${registros.map(item => {
        const fecha = item.fecha ? new Date(item.fecha).toLocaleString("es-CO") : "-";
        const tiempo = item.tiempo || item.duracion || "-";

        return `
          <article>
            <div>
              <strong>${escapeHTML(item.servicio || "Servicio")}</strong>
              <small>${escapeHTML(fecha)}</small>
            </div>
            <div>
              <b>${escapeHTML(tiempo)}</b>
              <small>${formatCOP(item.precio)}</small>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function consultarHistorialPlacaModal(placa, contenedor) {
  const placaNormalizada = normalizarPlaca(placa);
  if (!contenedor) return;

  if (!placaNormalizada) {
    contenedor.innerHTML = renderHistorialPlacaModal("");
    return;
  }

  const local = getHistorialLocalPlaca(placaNormalizada);
  contenedor.innerHTML = local.length
    ? renderHistorialPlacaModal(placaNormalizada, local)
    : renderHistorialPlacaModal(placaNormalizada, [], true);

  fetch(`${API_URL}?action=historialPlaca&placa=${encodeURIComponent(placaNormalizada)}`)
    .then(res => res.json())
    .then(data => {
      const registros = Array.isArray(data?.detalle) ? data.detalle : local;
      contenedor.innerHTML = renderHistorialPlacaModal(placaNormalizada, registros);
    })
    .catch(() => {
      contenedor.innerHTML = renderHistorialPlacaModal(placaNormalizada, local);
    });
}

function abrirModalHistorialPlaca(placaInicial = "") {
  const placaSugerida = normalizarPlaca(
    placaInicial ||
    buscador?.value ||
    placaHistorialInput?.value ||
    ""
  );

  SwalPremium.fire({
    title: "Historial por placa",
    html: `
      <div class="modal-plate-search">
        <div class="plate-search-control">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="modalPlacaHistorialInput" placeholder="PLACA" value="${escapeHTML(placaSugerida)}" autocomplete="off">
        </div>
        <button id="modalBuscarPlaca" class="history-open-button" type="button">
          <i class="fa-solid fa-arrow-right"></i> Buscar
        </button>
      </div>
      <div id="modalHistorialResultado" class="modal-history-result">
        ${renderHistorialPlacaModal("")}
      </div>
    `,
    width: 760,
    showConfirmButton: false,
    showCancelButton: false,
    didOpen: () => {
      const input = document.getElementById("modalPlacaHistorialInput");
      const button = document.getElementById("modalBuscarPlaca");
      const resultado = document.getElementById("modalHistorialResultado");

      const buscar = () => {
        input.value = normalizarPlaca(input.value);
        consultarHistorialPlacaModal(input.value, resultado);
      };

      button.addEventListener("click", buscar);
      input.addEventListener("input", () => {
        input.value = normalizarPlaca(input.value);
      });
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") buscar();
      });

      if (placaSugerida) buscar();
      setTimeout(() => input.focus(), 80);
    }
  });
}

let historialPlacaTimeout = null;

if (placaHistorialInput) {
  placaHistorialInput.addEventListener("input", () => {
    clearTimeout(historialPlacaTimeout);
    placaHistorialInput.value = normalizarPlaca(placaHistorialInput.value);
    historialPlacaTimeout = setTimeout(() => {
      cargarHistorialPlaca(placaHistorialInput.value);
    }, 260);
  });
}









/* ---------- ActivaciÃ³n del buscador ---------- */
buscadorActivos.addEventListener("input", renderActivos);
if (buscadorServicios) buscadorServicios.addEventListener("input", renderServicios);
if (selectorServicios) selectorServicios.addEventListener("change", renderServicios);

/* ===============================
    CARGAR SERVICIOS
   =============================== */
function cargarServicios(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) setSectionLoading("servicios", true, "Cargando servicios...");

  return fetch(`${API_URL}?action=servicios`)
    .then(res => res.json())
    .then(data => {
      serviciosData = Array.isArray(data) ? data : [];
      renderFiltroServicios();
      renderServicios();
    })
    .catch(err => console.error("Error servicios:", err))
    .finally(() => {
      if (!silent) setSectionLoading("servicios", false);
    });
}



/* ===============================
    RENDER SERVICIOS
   =============================== */

function servicioCoincideConBusqueda(servicio, busqueda) {
  if (!busqueda) return true;
  return normalizarTexto(`${servicio.nombre || ""} ${servicio.precio || ""}`).includes(busqueda);
}

function getServiciosFiltrados() {
  const busqueda = normalizarTexto(buscadorServicios?.value || "");
  const servicioSeleccionado = selectorServicios?.value || "";

  return serviciosData.filter(servicio => {
    const coincideSelect = !servicioSeleccionado || String(servicio.id) === servicioSeleccionado;
    return coincideSelect && servicioCoincideConBusqueda(servicio, busqueda);
  });
}

function renderFiltroServicios() {
  if (!selectorServicios) return;

  const seleccionado = selectorServicios.value;
  selectorServicios.innerHTML = `<option value="">Todos los servicios</option>`;

  serviciosData.forEach(servicio => {
    selectorServicios.innerHTML += `
      <option value="${escapeHTML(servicio.id)}">${escapeHTML(servicio.nombre || "Servicio")}</option>
    `;
  });

  if (seleccionado && serviciosData.some(servicio => String(servicio.id) === seleccionado)) {
    selectorServicios.value = seleccionado;
  }
}

function renderServicios() {
  const grid = document.getElementById("gridServicios");
  const idsRenderizados = new Set();
  const serviciosFiltrados = getServiciosFiltrados();

  if (!serviciosData.length) {
    grid.innerHTML = "<p>No hay servicios</p>";
    return;
  }

  if (!serviciosFiltrados.length) {
    grid.innerHTML = "<p>No hay servicios para este filtro</p>";
    return;
  }

  serviciosFiltrados.forEach(s => {
    idsRenderizados.add(String(s.id));

    let card = grid.querySelector(`[data-id="${s.id}"]`);

    // Nuevo servicio
    if (!card) {
      card = document.createElement("div");
      card.className = "card-servicio";
      card.dataset.id = s.id;
      grid.appendChild(card);
    }

    // Update / render
   card.innerHTML = `
  <h4>${s.nombre}</h4>
  <p>$${Number(s.precio).toLocaleString("es-CO")}</p>

  <div class="acciones">
    <button class="start">Iniciar</button>
    <button class="edit">Editar</button>
    <button class="delete">Eliminar</button>
  </div>
`;

    card.querySelector(".edit").onclick = () => editarServicio(s);
    card.querySelector(".delete").onclick = () => eliminarServicio(s.id);
    card.querySelector(".start").onclick = () => abrirModalAgendarServicio(s);

  });

  // Eliminar servicios que ya no existen
  [...grid.children].forEach(card => {
    if (!idsRenderizados.has(card.dataset.id)) {
      card.remove();
    }
  });
}


/* ===============================
     MODAL PARA AGENDAR SERVICIO
   =============================== */
function abrirModalAgendarServicio(servicio) {

  SwalPremium.fire({
    title: "Iniciar lavado",
    html: `
      <div style="text-align:center">
        <p style="font-weight:600">${servicio.nombre}</p>
        <p style="opacity:.7;margin-bottom:10px">
          Precio: $${Number(servicio.precio).toLocaleString("es-CO")}
        </p>

        <input
          id="placaLavado"
          class="swal2-input"
          placeholder="Placa del vehÃ­culo"
          style="text-transform:uppercase"
        />

        <select id="trabajadorLavado" class="swal2-input">
          <option value="">Asignar automÃ¡ticamente</option>
          <option disabled>Cargando trabajadores...</option>
        </select>
      </div>
    `,
    confirmButtonText: "Iniciar lavado",
    cancelButtonText: "Cancelar",
    didOpen: () => {
      obtenerTrabajadoresParaAsignacion()
        .then(data => {
          const select = document.getElementById("trabajadorLavado");
          if (!select) return;

          // limpiar opciones
          select.innerHTML = `<option value="">Asignar automÃ¡ticamente</option>`;

          data
            .filter(esOperarioAsignable)
            .forEach(t => {
              const opt = document.createElement("option");
              opt.value = t.nombre;
              opt.textContent = t.nombre;
              select.appendChild(opt);
            });

          // si no hay libres
          if (select.options.length === 1) {
            const opt = document.createElement("option");
            opt.disabled = true;
            opt.textContent = "No hay trabajadores libres";
            select.appendChild(opt);
          }
        })
        .catch(() => {
          const select = document.getElementById("trabajadorLavado");
          if (select) {
            select.innerHTML = `
              <option value="">Asignar automÃ¡ticamente</option>
              <option disabled>Error al cargar trabajadores</option>
            `;
          }
        });
    },
    preConfirm: () => {
      const placa = document
        .getElementById("placaLavado")
        .value.trim()
        .toUpperCase();

      const trabajador =
        document.getElementById("trabajadorLavado").value;

      if (!placa) {
        Swal.showValidationMessage("La placa es obligatoria");
        return false;
      }

      return { placa, trabajador };
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    const { placa, trabajador } = result.value;
    showAppLoader("Iniciando lavado...");

    let url =
      `${API_URL}?action=agendar` +
      `&placa=${encodeURIComponent(placa)}` +
      `&servicio=${encodeURIComponent(servicio.nombre)}`;

    // Solo enviar trabajador si fue seleccionado
    if (trabajador) {
      url += `&trabajador=${encodeURIComponent(trabajador)}`;
    }

    fetch(url)
      .then(res => res.json())
      .then(r => {
        if (r.error) {
          SwalPremium.fire("Error", r.error, "error");
          return;
        }

        SwalPremium.fire({
          icon: "success",
          title: "Lavado iniciado",
          html: `
            <b>Placa:</b> ${placa}<br>
            <b>Servicio:</b> ${servicio.nombre}<br>
            <b>Trabajador:</b> ${r.trabajador}<br>
            <b>Precio:</b> $${Number(r.precio).toLocaleString("es-CO")}
          `
        });

        cargarActivos({ silent: true });
        cargarTrabajadores({ silent: true });
        cargarIngresos({ silent: true });
      })
      .catch(() => {
        SwalPremium.fire("Error", "Error de conexiÃ³n", "error");
      })
      .finally(() => {
        hideAppLoader();
      });
  });
}






/* ===============================
    EDITAR  SERVICIO
   =============================== */

function editarServicio(servicio) {
  SwalPremium.fire({
    title: "Editar servicio",
    html: `
      <input id="srvNombreEdit" class="swal2-input" value="${servicio.nombre}">
      <input id="srvPrecioEdit" type="number" class="swal2-input" value="${servicio.precio}">
    `,
    confirmButtonText: "Guardar",
    showCancelButton: true,
    preConfirm: () => {
      const nombre = document.getElementById("srvNombreEdit").value.trim();
      const precio = document.getElementById("srvPrecioEdit").value;

      if (!nombre || !precio) {
        Swal.showValidationMessage("Datos incompletos");
        return false;
      }

      return { nombre, precio };
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    const { nombre, precio } = result.value;

    fetch(`${API_URL}?action=editarServicio&id=${servicio.id}&nombre=${encodeURIComponent(nombre)}&precio=${precio}`)
      .then(res => res.json())
      .then(r => {
        if (r.ok) {
          SwalPremium.fire("Actualizado", "", "success");
          cargarServicios();
        }
      });
  });
}



/* ===============================
    ELIMINAR  SERVICIO
   =============================== */
function eliminarServicio(id) {
  SwalPremium.fire({
    title: "Â¿Eliminar servicio?",
    text: "Esta acciÃ³n no se puede deshacer",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Eliminar"
  }).then(result => {
    if (!result.isConfirmed) return;

    fetch(`${API_URL}?action=eliminarServicio&id=${id}`)
      .then(res => res.json())
      .then(r => {
        if (r.ok) {
          SwalPremium.fire("Eliminado", "", "success");
          cargarServicios();
        }
      });
  });
}




/* ===============================
    CARGAR TRABAJADORES
   =============================== */
function cargarTrabajadores(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    setSectionLoading("trabajadores", true, "Cargando trabajadores...");
    setSectionLoading("liquidaciones", true, "Actualizando liquidaciones...");
  }

  return fetch(`${API_URL}?action=trabajadores`)
    .then(res => res.json())
    .then(data => {
      trabajadoresData = Array.isArray(data) ? data : [];

      renderFiltroTablaTrabajadores();
      renderTrabajadores();        // tabla
      renderFiltroTrabajadores();  // select
   
    })
    .catch(err => console.error("Error trabajadores:", err));
}




/* ===============================
    RENDER TRABAJADORES
   =============================== */

function trabajadorCoincideConBusqueda(trabajador, busqueda) {
  if (!busqueda) return true;
  return normalizarTexto(
    `${trabajador.nombre || ""} ${trabajador.estado || ""} ${trabajador.correo || ""} ${trabajador.rol || ""}`
  ).includes(busqueda);
}

function getTrabajadoresFiltrados() {
  const busqueda = normalizarTexto(buscadorTrabajadores?.value || "");
  const trabajadorSeleccionado = selectorTrabajadores?.value || "";

  return trabajadoresData.filter(trabajador => {
    const coincideSelect = !trabajadorSeleccionado || trabajador.nombre === trabajadorSeleccionado;
    return coincideSelect && trabajadorCoincideConBusqueda(trabajador, busqueda);
  });
}

function renderFiltroTablaTrabajadores() {
  if (!selectorTrabajadores) return;

  const seleccionado = selectorTrabajadores.value;
  selectorTrabajadores.innerHTML = `<option value="">Todos los trabajadores</option>`;

  trabajadoresData.forEach(trabajador => {
    selectorTrabajadores.innerHTML += `
      <option value="${escapeHTML(trabajador.nombre || "")}">${escapeHTML(trabajador.nombre || "Trabajador")}</option>
    `;
  });

  if (seleccionado && trabajadoresData.some(trabajador => trabajador.nombre === seleccionado)) {
    selectorTrabajadores.value = seleccionado;
  }
}

function renderTrabajadores() {
  const tbody = document.getElementById("tablaTrabajadores");
  const trabajadoresFiltrados = getTrabajadoresFiltrados();
  tbody.innerHTML = "";

  if (!trabajadoresData.length) {
    tbody.innerHTML = `<tr><td colspan="4">Sin trabajadores</td></tr>`;
    return;
  }

  if (!trabajadoresFiltrados.length) {
    tbody.innerHTML = `<tr><td colspan="4">Sin trabajadores para este filtro</td></tr>`;
    return;
  }

  trabajadoresFiltrados.forEach(t => {
    const tr = document.createElement("tr");
    const actorEsJefe = currentSession?.rol === "jefe";
    const rol = String(t.rol || "").toLowerCase();
    const isJefe = rol === "jefe";
    const isAdmin = rol === "admin";
    const estado = String(t.estado || "").toLowerCase();
    const accesoInactivo = t.activo === "inactivo";
    tr.className = isJefe ? "worker-row boss-row" : "worker-row";

    tr.innerHTML = `
      <td>
        <div class="worker-name-line">
          <strong>${escapeHTML(t.nombre || "-")}</strong>
          ${
            isJefe
              ? `<span class="role-chip boss"><i class="fa-solid fa-crown"></i> Jefe</span>`
              : isAdmin
                ? `<span class="role-chip admin"><i class="fa-solid fa-shield-halved"></i> Admin</span>`
                : `<span class="role-chip neutral">Operativo</span>`
          }
        </div>
      </td>
      <td>
        <div class="worker-state-line">
          <span class="worker-status ${estado === "ocupado" ? "busy" : "free"}">${escapeHTML(t.estado || "-")}</span>
          ${
            t.rol
              ? `<span class="access-chip ${accesoInactivo ? "off" : "on"}">${accesoInactivo ? "Acceso inactivo" : "Acceso activo"}</span>`
              : `<span class="access-chip muted">Sin acceso</span>`
          }
        </div>
      </td>
      <td>
        <span class="worker-email">${escapeHTML(t.correo || "-")}</span>
      </td>
      <td>
  <div class="acciones-trabajador">
    <button class="edit">Editar</button>
    <button class="delete" ${actorEsJefe ? "" : "disabled title=\"Solo el jefe puede eliminar usuarios\""}>Eliminar</button>
  </div>
</td>

    `;

    tr.querySelector(".edit").onclick = () => editarTrabajador(t);
    if (actorEsJefe) tr.querySelector(".delete").onclick = () => eliminarTrabajador(t);

   

    tbody.appendChild(tr);
  });
}

if (buscadorTrabajadores) buscadorTrabajadores.addEventListener("input", renderTrabajadores);
if (selectorTrabajadores) selectorTrabajadores.addEventListener("change", renderTrabajadores);



/* ===============================
    EDITAR TRABAJADOR
   =============================== */
function editarTrabajador(t) {
  const actorEsJefe = currentSession?.rol === "jefe";
  const actorEsAdmin = currentSession?.rol === "admin";
  const esMismoUsuario = String(currentSession?.correo || "").toLowerCase() === String(t.correo || "").toLowerCase();
  const camposEditables = actorEsJefe;
  const passwordEditable = actorEsJefe || (actorEsAdmin && esMismoUsuario);

  SwalPremium.fire({
    title: "Editar trabajador",
    html: `
      <input 
        id="trabNombreEdit"
        class="swal2-input"
        placeholder="Nombre"
        value="${t.nombre}"
        ${camposEditables ? "" : "disabled"}
      >

      <input 
        id="trabCorreoEdit"
        type="email"
        class="swal2-input"
        placeholder="Correo"
        value="${t.correo || ""}"
        ${camposEditables ? "" : "disabled"}
      >

      <select id="trabEstadoEdit" class="swal2-select" ${camposEditables ? "" : "disabled"}>
        <option value="libre" ${t.estado === "libre" ? "selected" : ""}>Libre</option>
        <option value="ocupado" ${t.estado === "ocupado" ? "selected" : ""}>Ocupado</option>
      </select>

      <select id="trabRolEdit" class="swal2-select" ${camposEditables ? "" : "disabled"}>
        <option value="" ${!t.rol ? "selected" : ""}>Sin acceso al sistema</option>
        <option value="admin" ${t.rol === "admin" ? "selected" : ""}>Administrador</option>
        <option value="jefe" ${t.rol === "jefe" ? "selected" : ""}>Jefe</option>
      </select>

      <select id="trabActivoEdit" class="swal2-select" ${camposEditables ? "" : "disabled"}>
        <option value="activo" ${t.activo !== "inactivo" ? "selected" : ""}>Acceso activo</option>
        <option value="inactivo" ${t.activo === "inactivo" ? "selected" : ""}>Acceso inactivo</option>
      </select>

      <input
        id="trabPasswordEdit"
        type="password"
        class="swal2-input"
        placeholder="Nueva contrasena (opcional)"
        ${passwordEditable ? "" : "disabled"}
      >
      ${
        actorEsJefe
          ? ""
          : esMismoUsuario
            ? `<p style="margin:10px 0 0;opacity:.72;font-size:.84rem;">Como administrador, solo puedes cambiar tu contrasena.</p>`
            : `<p style="margin:10px 0 0;opacity:.72;font-size:.84rem;">Solo el jefe puede modificar otros usuarios.</p>`
      }
    `,
    confirmButtonText: actorEsJefe ? "Guardar" : (esMismoUsuario ? "Cambiar contrasena" : "Cerrar"),
    showCancelButton: true,
    preConfirm: () => {
      const nombre = camposEditables ? document.getElementById("trabNombreEdit").value.trim() : (t.nombre || "");
      const correo = camposEditables ? document.getElementById("trabCorreoEdit").value.trim() : (t.correo || "");
      const estado = camposEditables ? document.getElementById("trabEstadoEdit").value : (t.estado || "");
      const rol = camposEditables ? document.getElementById("trabRolEdit").value : (t.rol || "");
      const activo = camposEditables ? document.getElementById("trabActivoEdit").value : (t.activo || "activo");
      const password = passwordEditable ? document.getElementById("trabPasswordEdit").value : "";

      if (!actorEsJefe) {
        if (!esMismoUsuario) {
          Swal.showValidationMessage("Solo el jefe puede modificar otros usuarios");
          return false;
        }

        if (!password) {
          Swal.showValidationMessage("Ingresa tu nueva contrasena");
          return false;
        }

        return { nombre, correo, estado, rol, activo, password };
      }

      if (!nombre) {
        Swal.showValidationMessage("Nombre requerido");
        return false;
      }

      if (correo && !correo.includes("@")) {
        Swal.showValidationMessage("Correo invÃ¡lido");
        return false;
      }

      if (rol && !correo) {
        Swal.showValidationMessage("El correo es obligatorio para dar acceso");
        return false;
      }

      if (rol && !t.tienePassword && !password) {
        Swal.showValidationMessage("Ingresa una contrasena para activar el acceso");
        return false;
      }

      return { nombre, correo, estado, rol, activo, password };
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    const { nombre, correo, estado, rol, activo, password } = result.value;

    fetch(
      `${API_URL}?action=editarTrabajador` +
      `&id=${t.id}` +
      `&nombre=${encodeURIComponent(nombre)}` +
      `&correo=${encodeURIComponent(correo)}` +
      `&estado=${estado}` +
      `&rol=${encodeURIComponent(rol)}` +
      `&activo=${encodeURIComponent(activo)}` +
      `&password=${encodeURIComponent(password)}`
    )
      .then(res => res.json())
      .then(r => {
        if (r.ok) {
          SwalPremium.fire("Actualizado", "", "success");
          cargarTrabajadores();
          cargarIngresos();
          cargarActivos();
        } else {
          SwalPremium.fire("No permitido", r.error || "No se pudo actualizar", "warning");
        }
      });
  });
}


/* ===============================
    ELIMINAR TRABAJADOR
   =============================== */
function eliminarTrabajador(trabajador) {
  if (trabajador.estado === "ocupado") {
    return SwalPremium.fire({
      icon: "warning",
      title: "No permitido",
      text: "El trabajador estÃ¡ asignado a un lavado activo"
    });
  }

  SwalPremium.fire({
    title: "Â¿Eliminar trabajador?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Eliminar"
  }).then(result => {
    if (!result.isConfirmed) return;

    fetch(`${API_URL}?action=eliminarTrabajador&id=${trabajador.id}`)
      .then(res => res.json())
      .then(r => {
        if (r.ok) {
          SwalPremium.fire("Eliminado", "", "success");
          cargarTrabajadores();
        }
      });
  });
}


function getPagoMixtoTotalValue(totalSource) {
  const total = typeof totalSource === "function" ? totalSource() : totalSource;
  return Number(total || 0);
}

function getPaymentPayloadFromValues(metodo, total, prefijo = "") {
  if (metodo === "pendiente") {
    return { estadoPago: "pendiente", query: `&metodo_pago=&estado_pago=pendiente` };
  }

  if (metodo !== "mixto") {
    return {
      estadoPago: "pagado",
      query:
        `&metodo_pago=${encodeURIComponent(metodo)}` +
        `&estado_pago=pagado`
    };
  }

  const pago1Metodo = document.getElementById(`${prefijo}Pago1Metodo`)?.value || "";
  const pago2Metodo = document.getElementById(`${prefijo}Pago2Metodo`)?.value || "";
  const pago1Monto = Number(document.getElementById(`${prefijo}Pago1Monto`)?.value || 0);
  const pago2Monto = Number(document.getElementById(`${prefijo}Pago2Monto`)?.value || 0);

  if (!pago1Metodo || !pago2Metodo) {
    Swal.showValidationMessage("Selecciona los dos metodos del pago mixto");
    return null;
  }

  if (pago1Metodo === pago2Metodo) {
    Swal.showValidationMessage("Usa dos metodos diferentes para pago mixto");
    return null;
  }

  if (pago1Monto <= 0 || pago2Monto <= 0) {
    Swal.showValidationMessage("Ambos montos deben ser mayores a cero");
    return null;
  }

  if (Math.abs((pago1Monto + pago2Monto) - total) > 1) {
    Swal.showValidationMessage(`La suma debe ser ${formatCOP(total)}`);
    return null;
  }

  return {
    estadoPago: "pagado",
    query:
      `&metodo_pago=mixto` +
      `&estado_pago=pagado` +
      `&pago1_metodo=${encodeURIComponent(pago1Metodo)}` +
      `&pago1_monto=${encodeURIComponent(pago1Monto)}` +
      `&pago2_metodo=${encodeURIComponent(pago2Metodo)}` +
      `&pago2_monto=${encodeURIComponent(pago2Monto)}`
  };
}

function renderPagoMixtoForm(total, prefijo = "") {
  return `
    <div id="${prefijo}PagoMixtoBox" class="mixed-payment-box hidden">
      <div>
        <label>Metodo de pago 1</label>
        <select id="${prefijo}Pago1Metodo" class="swal2-input">
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="bre_b">Bre-B</option>
        </select>
      </div>
      <div>
        <label>Monto</label>
        <input id="${prefijo}Pago1Monto" class="swal2-input" type="number" min="0" step="100" value="${total}">
      </div>
      <div>
        <label>Metodo de pago 2</label>
        <select id="${prefijo}Pago2Metodo" class="swal2-input">
          <option value="transferencia">Transferencia</option>
          <option value="efectivo">Efectivo</option>
          <option value="bre_b">Bre-B</option>
        </select>
      </div>
      <div>
        <label>Monto</label>
        <input id="${prefijo}Pago2Monto" class="swal2-input" type="number" min="0" step="100" value="0">
      </div>
      <small class="mixed-payment-total">Total a pagar: <b data-mixed-total-label>${formatCOP(total)}</b></small>
    </div>
  `;
}

function bindPagoMixtoUI(total, prefijo = "") {
  const metodoSelect = document.getElementById(`${prefijo}MetodoPago`);
  const box = document.getElementById(`${prefijo}PagoMixtoBox`);
  const pago1Monto = document.getElementById(`${prefijo}Pago1Monto`);
  const pago2Monto = document.getElementById(`${prefijo}Pago2Monto`);
  const totalLabel = box?.querySelector("[data-mixed-total-label]");

  if (!metodoSelect || !box) return;

  function syncTotalLabel() {
    const totalActual = getPagoMixtoTotalValue(total);
    if (totalLabel) totalLabel.textContent = formatCOP(totalActual);
    return totalActual;
  }

  box.syncMixedPaymentTotal = syncTotalLabel;

  metodoSelect.addEventListener("change", () => {
    box.classList.toggle("hidden", metodoSelect.value !== "mixto");
    syncTotalLabel();
  });

  pago1Monto?.addEventListener("input", () => {
    const restante = Math.max(0, syncTotalLabel() - Number(pago1Monto.value || 0));
    if (pago2Monto) pago2Monto.value = restante;
  });

  syncTotalLabel();
}










function confirmarLavado(id) {
  const item = lista.querySelector(`[data-id="${id}"]`);
  if (!item) return;
  const lavado = activosData.find(l => String(l.id) === String(id));
  const gastos = totalGastosLavado(id);
  const ingreso = parsePrecio(lavado?.precio);
  const inicio = getLavadoStartTimestamp(lavado);
  const tiempoActivo = inicio ? formatTiempoCorto(Date.now() - inicio) : "-";

SwalPremium.fire({
    title: "Â¿Confirmar lavado terminado?",
    html: lavado ? `
      <div class="swal-summary">
        <span>Ingreso: <b>${formatCOP(ingreso)}</b></span>
        <span>Gastos: <b>${formatCOP(gastos)}</b></span>
        <span>Neto: <b>${formatCOP(ingreso - gastos)}</b></span>
        <span>Tiempo: <b>${tiempoActivo}</b></span>
      </div>
      <select id="confirmMetodoPago" class="swal2-input">
        <option value="">Selecciona metodo de pago</option>
        <option value="efectivo">Efectivo</option>
        <option value="transferencia">Transferencia</option>
        <option value="bre_b">Bre-B</option>
        <option value="mixto">Pago mixto</option>
        <option value="pendiente">Pendiente por pagar</option>
      </select>
      ${renderPagoMixtoForm(ingreso, "confirm")}
    ` : "",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Confirmar",
    didOpen: () => bindPagoMixtoUI(ingreso, "confirm"),
    preConfirm: () => {
      const metodo = document.getElementById("confirmMetodoPago")?.value || "";
      if (!metodo) {
        Swal.showValidationMessage("Selecciona el metodo de pago");
        return false;
      }
      const payload = getPaymentPayloadFromValues(metodo, ingreso, "confirm");
      return payload || false;
    }
  }).then(r => {
    if (!r.isConfirmed) return;

    // âš¡ Optimistic UI
    item.style.opacity = ".4";
    showAppLoader("Confirmando lavado...");
    const estadoPago = r.value.estadoPago;

    fetch(
      `${API_URL}?action=confirmar` +
      `&id=${encodeURIComponent(id)}` +
      r.value.query
    )
      .then(res => res.json())
      .then(r => {
        if (r.ok) {
          item.remove();
          gastosPorLavado.delete(String(id));
          gastosCargados.delete(String(id));
          // Refrescos necesarios
          cargarActivos({ silent: true });
          cargarIngresos({ silent: true });
          cargarTrabajadores({ silent: true });
          if (estadoPago === "pendiente") cargarPendientesPago({ silent: true });

        } else {
          item.style.opacity = "1";
          SwalPremium.fire("Error", r.error || "No se pudo confirmar", "error");
        }
      })
      .catch(() => {
        item.style.opacity = "1";
        SwalPremium.fire("Error de red", "", "error");
      })
      .finally(() => {
        hideAppLoader();
      });
  });
}

function eliminarLavadoActivo(id) {
  const lavado = activosData.find(l => String(l.id) === String(id));
  const item = lista.querySelector(`[data-id="${id}"]`);

  SwalPremium.fire({
    title: "Eliminar lavado activo",
    html: lavado ? `
      <div class="swal-summary">
        <span>Placa: <b>${escapeHTML(lavado.placa || "-")}</b></span>
        <span>Servicio: <b>${escapeHTML(lavado.servicio || "-")}</b></span>
        <span>Operario: <b>${escapeHTML(lavado.trabajador || "-")}</b></span>
      </div>
      <div class="cancel-payment-fields">
        <div>
          <label>Motivo de cancelacion</label>
          <textarea id="cancelMotivo" class="swal2-textarea" placeholder="Ej: el cliente no alcanzo por tiempo"></textarea>
        </div>
        <div>
          <label>Pago que realiza el cliente (opcional)</label>
          <input id="cancelPago" class="swal2-input" type="number" min="0" step="100" placeholder="0">
        </div>
        <div id="cancelMetodoBox" class="hidden">
          <label>Metodo de pago</label>
          <select id="cancelMetodoPago" class="swal2-input">
            <option value="">Selecciona metodo de pago</option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="bre_b">Bre-B</option>
            <option value="mixto">Pago mixto</option>
          </select>
          ${renderPagoMixtoForm(0, "cancel")}
        </div>
      </div>
    ` : "Se eliminara el lavado activo y se liberara el operario.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Eliminar",
    cancelButtonText: "Cancelar",
    didOpen: () => {
      const pagoInput = document.getElementById("cancelPago");
      const metodoBox = document.getElementById("cancelMetodoBox");
      const mixedBox = document.getElementById("cancelPagoMixtoBox");
      const pago1Monto = document.getElementById("cancelPago1Monto");
      const pago2Monto = document.getElementById("cancelPago2Monto");

      bindPagoMixtoUI(() => Number(pagoInput?.value || 0), "cancel");

      const syncPagoCancelacion = () => {
        const monto = Number(pagoInput?.value || 0);
        metodoBox?.classList.toggle("hidden", monto <= 0);
        mixedBox?.syncMixedPaymentTotal?.();
        if (pago1Monto && monto > 0) pago1Monto.value = monto;
        if (pago2Monto) pago2Monto.value = 0;
      };

      pagoInput?.addEventListener("input", syncPagoCancelacion);
      syncPagoCancelacion();
    },
    preConfirm: () => {
      const montoCancelacion = Number(document.getElementById("cancelPago")?.value || 0);
      const motivoCancelacion = document.getElementById("cancelMotivo")?.value.trim() || "";

      if (montoCancelacion < 0) {
        Swal.showValidationMessage("El pago no puede ser negativo");
        return false;
      }

      if (montoCancelacion <= 0) {
        return { query: motivoCancelacion ? `&motivo_cancelacion=${encodeURIComponent(motivoCancelacion)}` : "" };
      }

      if (!motivoCancelacion) {
        Swal.showValidationMessage("Escribe el motivo de la cancelacion");
        return false;
      }

      const metodo = document.getElementById("cancelMetodoPago")?.value || "";
      if (!metodo) {
        Swal.showValidationMessage("Selecciona el metodo de pago");
        return false;
      }

      const payload = getPaymentPayloadFromValues(metodo, montoCancelacion, "cancel");
      if (!payload) return false;

      return {
        query:
          `&pago_cancelacion=${encodeURIComponent(montoCancelacion)}` +
          `&motivo_cancelacion=${encodeURIComponent(motivoCancelacion)}` +
          payload.query
      };
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    if (item) item.style.opacity = ".45";
    showAppLoader("Eliminando lavado activo...");

    fetch(`${API_URL}?action=eliminarLavadoActivo&id=${encodeURIComponent(id)}${result.value?.query || ""}`)
      .then(res => res.json())
      .then(resp => {
        if (resp.error) {
          if (item) item.style.opacity = "1";
          SwalPremium.fire("Error", resp.error, "error");
          return;
        }

        if (item) item.remove();
        gastosPorLavado.delete(String(id));
        gastosCargados.delete(String(id));
        gastosCargando.delete(String(id));

        return Promise.all([
          cargarActivos({ silent: true }),
          cargarTrabajadores({ silent: true }),
          cargarIngresos({ silent: true }),
          cargarLiquidaciones({ silent: true })
        ]).then(() => {
          SwalPremium.fire({
            icon: "success",
            title: resp.registro_cancelado ? "Cancelacion registrada" : "Lavado eliminado",
            timer: 1200,
            showConfirmButton: false
          });
        });
      })
      .catch(() => {
        if (item) item.style.opacity = "1";
        SwalPremium.fire("Error de red", "No se pudo eliminar el lavado activo", "error");
      })
      .finally(() => hideAppLoader());
  });
}


/* ===============================
   CREAR SERVICIO
   =============================== */
/* ===============================
   CREAR SERVICIO
   =============================== */
document.getElementById("btnCrearServicio").onclick = () => {
  const nombre = srvNombre.value.trim();
  const precio = srvPrecio.value;

  if (!nombre || !precio) return alert("Completa los datos");
  showAppLoader("Creando servicio...");

  fetch(`${API_URL}?action=crearServicio&nombre=${encodeURIComponent(nombre)}&precio=${precio}`)
    .then(res => res.json())
    .then(r => {
      if (!r.ok) {
        alert("Error creando servicio");
        return;
      }

      // Limpiar inputs
      srvNombre.value = "";
      srvPrecio.value = "";

      // ðŸ” REFRESCAR SERVICIOS
      cargarServicios({ silent: true });

      // (opcional UX)
      SwalPremium.fire({
        icon: "success",
        title: "Servicio creado",
        timer: 1200,
        showConfirmButton: false
      });
    })
    .finally(() => {
      hideAppLoader();
    });
};


/* ===============================
   CREAR TRABAJADOR
   =============================== */
/* ===============================
   CREAR TRABAJADOR
   =============================== */
document.getElementById("btnCrearTrabajador").onclick = () => {
  const nombre = trabNombre.value.trim();
  const correo = trabCorreo.value.trim(); // nuevo
  const rol = trabRol?.value || "";
  const password = trabPassword?.value || "";

  if (!nombre) {
    SwalPremium.fire("Error", "Nombre requerido", "error");
    return;
  }

  if (rol && (!correo || !password)) {
    SwalPremium.fire("Error", "Para crear un administrador debes ingresar correo y contrasena.", "error");
    return;
  }

  if (correo && !correo.includes("@")) {
    SwalPremium.fire("Error", "Correo invalido", "error");
    return;
  }

  showAppLoader("Creando trabajador...");

  fetch(
    `${API_URL}?action=crearTrabajador` +
    `&nombre=${encodeURIComponent(nombre)}` +
    `&correo=${encodeURIComponent(correo)}` +
    `&rol=${encodeURIComponent(rol)}` +
    `&password=${encodeURIComponent(password)}`
  )
    .then(res => res.json())
    .then(r => {
      if (!r.ok) {
        SwalPremium.fire("Error", r.error || "Error creando trabajador", "error");
        return;
      }

      // Limpiar inputs
      trabNombre.value = "";
      trabCorreo.value = "";
      if (trabRol) trabRol.value = "";
      if (trabPassword) trabPassword.value = "";

      // ðŸ” REFRESCAR TRABAJADORES
      cargarTrabajadores({ silent: true });

      SwalPremium.fire({
        icon: "success",
        title: "Trabajador creado",
        timer: 1200,
        showConfirmButton: false
      });
    })
    .catch(() => {
      SwalPremium.fire("Error", "Error de conexiÃ³n", "error");
    })
    .finally(() => {
      hideAppLoader();
    });
};



/* ===============================
   NAVEGACIÃ“N SPA
   =============================== */
document.querySelectorAll(".sidebar button").forEach(btn => {
  if (!btn.dataset.section) return;

  btn.onclick = () => {
    document.querySelectorAll(".sidebar button").forEach(b =>
      b.classList.remove("active")
    );
    btn.classList.add("active");

    document.querySelectorAll(".section").forEach(s =>
      s.classList.remove("active")
    );
    document.getElementById(btn.dataset.section).classList.add("active");

    if (btn.dataset.section === "ingresos") {
      cargarIngresosCompletos({ showProgress: true }).catch(console.error);
    }
    if (btn.dataset.section === "liquidaciones") {
      asegurarLiquidacionesListas({ showProgress: true }).catch(console.error);
    }
    if (btn.dataset.section === "ganancias") {
      cargarIngresosCompletos({ showProgress: true, progressSection: "ganancias" })
        .then(renderGanancias)
        .catch(console.error);
    }
  };
});

document.querySelector('.sidebar button[data-section="activos"]')?.classList.add("active");

/* ===============================
   INGRESOS + KPIs
   =============================== */
const tabla = document.getElementById("tablaIngresos");
const kpiServicios = document.getElementById("kpiServicios");
const kpiHoy = document.getElementById("kpiHoy");
const kpiMes = document.getElementById("kpiMes");
const kpiFiltrado = document.getElementById("kpiFiltrado");
const buscador = document.getElementById("buscador");
const btnRegistroManual = document.getElementById("btnRegistroManual");
const btnHistorialPlaca = document.getElementById("btnHistorialPlaca");
const btnPendientesPago = document.getElementById("btnPendientesPago");
const btnLimpiarHistorial = document.getElementById("btnLimpiarHistorial");
const filtroMetodoPago = document.getElementById("filtroMetodoPago");
const filtroIngresosAutor = document.getElementById("filtroIngresosAutor");
const filtroIngresosTrabajador = document.getElementById("filtroIngresosTrabajador");
const filtroIngresosServicio = document.getElementById("filtroIngresosServicio");
const filtroIngresosFecha = document.getElementById("filtroIngresosFecha");
const paginacionIngresos = document.getElementById("paginacionIngresos");

let ingresosDetalle = [];
let pendientesPagoData = [];
let ingresosResumen = null;
let ingresosCompletosCargados = false;
let cargaIngresosCompletaEnCurso = null;

/* ---------- UTILIDADES ---------- */
// Convierte cualquier cosa a nÃºmero seguro
function parsePrecio(valor) {
  const n = Number(valor);
  return isNaN(n) ? 0 : n;
}

// Comprueba si dos fechas son el mismo dÃ­a
function esMismoDia(fecha1, fecha2) {
  const f1 = new Date(fecha1);
  const f2 = new Date(fecha2);
  return f1.getFullYear() === f2.getFullYear() &&
         f1.getMonth() === f2.getMonth() &&
         f1.getDate() === f2.getDate();
}

function setSectionLoading(sectionId, loading, texto = "Cargando informacion...") {
  const section = document.getElementById(sectionId);
  if (!section) return;

  let overlay = section.querySelector(":scope > .section-loader");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "section-loader hidden";
    overlay.innerHTML = `
      <div class="section-loader-card">
        <div class="section-spinner"></div>
        <span></span>
      </div>
    `;
    section.appendChild(overlay);
  }

  overlay.querySelector("span").textContent = texto;
  overlay.classList.toggle("hidden", !loading);
}

/* ---------- CARGAR INGRESOS DESDE API ---------- */
function cargarIngresos() {
  fetch(`${API_URL}?action=ingresos`)
    .then(res => res.json())
    .then(data => {
      // Guardar detalle para filtros y tabla
      ingresosDetalle = Array.isArray(data.detalle) ? data.detalle : [];
      console.log("ðŸ›¸ Datos ingresos cargados:", ingresosDetalle);

      // ðŸ”¹ Calcular KPIs
      const hoy = new Date();
      const mes = hoy.getMonth();
      const anio = hoy.getFullYear();

      let serviciosHoy = 0;
      let ingresosHoy = 0;
      let ingresosMes = 0;

      ingresosDetalle.forEach(i => {
        const precio = parsePrecio(i.precio);
        const fecha = new Date(i.fecha);

        if (!isNaN(fecha)) { // Solo fechas vÃ¡lidas
          // Servicios e ingresos de hoy
          if (esMismoDia(fecha, hoy)) {
            serviciosHoy += 1;
            ingresosHoy += precio;
          }

          // Ingresos del mes
          if (fecha.getFullYear() === anio && fecha.getMonth() === mes) {
            ingresosMes += precio;
          }
        }
      });

      // ðŸ”¹ Mostrar KPIs en formato COP
      kpiServicios.textContent = serviciosHoy;
      kpiHoy.textContent = ingresosHoy.toLocaleString("es-CO", { style: "currency", currency: "COP" });
      kpiMes.textContent = ingresosMes.toLocaleString("es-CO", { style: "currency", currency: "COP" });

      // Render tabla y tarjetas
      renderTablaIngresos();
      renderCardsTrabajador();
      renderLiquidaciones();
    })
    .catch(err => console.error("ðŸ›¸ Error cargando ingresos:", err));
}

/* ---------- RENDER TABLA INGRESOS ---------- */
function getIngresosFiltrados() {
  const q = buscador?.value.toLowerCase().trim() || "";
  const metodo = filtroMetodoPago?.value || "";
  const autor = filtroIngresosAutor?.value || "";
  const trabajador = filtroIngresosTrabajador?.value || "";
  const servicio = filtroIngresosServicio?.value || "";
  const fechaFiltro = filtroIngresosFecha?.value || "hoy";

  return ingresosDetalle.filter(i => {
    const fecha = toDateSafe(i.fecha);
    const fechaVisible = currentSession?.rol === "admin" ? toDateSafe(i.registrado_en || i.fecha) : fecha;
    const metodoIngreso = i.estado_pago === "pendiente" ? "pendiente" : (i.metodo_pago || "sin_registrar");
    const pagos = Array.isArray(i.pagos) ? i.pagos : [];
    const coincideMetodo =
      !metodo ||
      metodoIngreso === metodo ||
      pagos.some(pago => pago.metodo === metodo);

    const coincideBusqueda =
      !q ||
      (i.placa || "").toLowerCase().includes(q) ||
      (i.trabajador || "").toLowerCase().includes(q) ||
      (i.servicio || "").toLowerCase().includes(q) ||
      (i.autor_nombre || "").toLowerCase().includes(q);

    const coincideAutor =
      !autor ||
      (autor === "__sin_identificar__" && !i.autor_correo) ||
      String(i.autor_correo || "").toLowerCase() === autor.toLowerCase();

    return coincideBusqueda &&
      coincideMetodo &&
      coincideAutor &&
      (!trabajador || i.trabajador === trabajador) &&
      (!servicio || i.servicio === servicio) &&
      coincideFiltroFecha(fechaVisible, fechaFiltro);
  }).sort((a, b) => {
    const fechaA = Number(toTimestamp(a.fecha) || 0);
    const fechaB = Number(toTimestamp(b.fecha) || 0);
    if (fechaA !== fechaB) return fechaB - fechaA;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function getMontoIngresoParaFiltro(i) {
  const metodo = filtroMetodoPago?.value || "";
  const precio = parsePrecio(i.precio);
  if (!metodo) return precio;

  const pagos = Array.isArray(i.pagos) ? i.pagos : [];
  const montoPorMetodo = pagos
    .filter(pago => pago.metodo === metodo)
    .reduce((acc, pago) => acc + parsePrecio(pago.monto), 0);

  if (montoPorMetodo > 0) return montoPorMetodo;
  const metodoIngreso = i.estado_pago === "pendiente" ? "pendiente" : (i.metodo_pago || "sin_registrar");
  return metodoIngreso === metodo ? precio : 0;
}

function coincideFiltroFecha(fecha, filtro) {
  if (!fecha) return false;
  const hoy = new Date();
  const d = new Date(fecha);
  if (filtro === "todos") return true;
  if (filtro === "hoy") return esMismoDia(d, hoy);
  if (filtro === "ayer") {
    const ayer = new Date();
    ayer.setDate(hoy.getDate() - 1);
    return esMismoDia(d, ayer);
  }
  if (filtro === "anio") return d.getFullYear() === hoy.getFullYear();

  const dias = Number(filtro);
  if (!dias) return true;
  const limite = new Date();
  limite.setDate(hoy.getDate() - dias);
  return d >= limite;
}

function renderPagoIngreso(i) {
  const pagos = Array.isArray(i.pagos) ? i.pagos.filter(p => p.metodo && Number(p.monto || 0) > 0) : [];

  const metodoIngreso = i.estado_pago === "pendiente" ? "pendiente" : (i.metodo_pago || "sin_registrar");

  if (metodoIngreso === "mixto" && pagos.length) {
    return `
      <div class="payment-split">
        ${pagos.map(pago => `
          <span>
            <b>${metodoPagoTexto(pago.metodo)}</b>
            <small>${formatCOP(pago.monto)}</small>
          </span>
        `).join("")}
      </div>
    `;
  }

  return `<span class="payment-pill ${escapeHTML(metodoIngreso)}">${metodoPagoTexto(metodoIngreso)}</span>`;
}

function renderRegistroIngresoBadge(i) {
  if (i?.tipo_registro !== "cancelado") return "";
  const nota = i.nota ? ` title="${escapeHTML(i.nota)}"` : "";
  return `<span class="record-badge"${nota}><i class="fa-solid fa-ban"></i> Cancelado</span>`;
}

function renderFiltrosIngresos() {
  const autorActual = filtroIngresosAutor?.value || "";
  const trabajadorActual = filtroIngresosTrabajador?.value || "";
  const servicioActual = filtroIngresosServicio?.value || "";

  if (filtroIngresosAutor) {
    const usuariosPorCorreo = new Map();
    trabajadoresData
      .filter(usuario => ["admin", "jefe"].includes(String(usuario.rol || "").toLowerCase()))
      .forEach(usuario => {
        const correo = String(usuario.correo || "").trim().toLowerCase();
        if (!correo) return;
        usuariosPorCorreo.set(correo, {
          nombre: usuario.nombre || correo,
          rol: String(usuario.rol || "").toLowerCase()
        });
      });
    ingresosDetalle.forEach(ingreso => {
      const correo = String(ingreso.autor_correo || "").trim().toLowerCase();
      if (!correo || usuariosPorCorreo.has(correo)) return;
      usuariosPorCorreo.set(correo, {
        nombre: ingreso.autor_nombre || correo,
        rol: String(ingreso.autor_rol || "").toLowerCase()
      });
    });

    filtroIngresosAutor.innerHTML = `<option value="">Todos los usuarios</option>`;
    [...usuariosPorCorreo.entries()]
      .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, "es"))
      .forEach(([correo, usuario]) => {
        const rol = usuario.rol === "jefe" ? "Jefe" : "Administrador";
        filtroIngresosAutor.innerHTML += `<option value="${escapeHTML(correo)}">${escapeHTML(usuario.nombre)} (${rol})</option>`;
      });
    if (ingresosDetalle.some(ingreso => !ingreso.autor_correo)) {
      filtroIngresosAutor.innerHTML += `<option value="__sin_identificar__">Registros anteriores</option>`;
    }
    if ([...filtroIngresosAutor.options].some(option => option.value === autorActual)) {
      filtroIngresosAutor.value = autorActual;
    }
  }

  if (filtroIngresosTrabajador) {
    const trabajadores = [...new Set(ingresosDetalle.map(i => i.trabajador).filter(Boolean))].sort();
    filtroIngresosTrabajador.innerHTML = `<option value="">Todos los trabajadores</option>`;
    trabajadores.forEach(nombre => {
      filtroIngresosTrabajador.innerHTML += `<option value="${escapeHTML(nombre)}">${escapeHTML(nombre)}</option>`;
    });
    if (trabajadores.includes(trabajadorActual)) filtroIngresosTrabajador.value = trabajadorActual;
  }

  if (filtroIngresosServicio) {
    const servicios = [...new Set(ingresosDetalle.map(i => i.servicio).filter(Boolean))].sort();
    filtroIngresosServicio.innerHTML = `<option value="">Todos los servicios</option>`;
    servicios.forEach(nombre => {
      filtroIngresosServicio.innerHTML += `<option value="${escapeHTML(nombre)}">${escapeHTML(nombre)}</option>`;
    });
    if (servicios.includes(servicioActual)) filtroIngresosServicio.value = servicioActual;
  }
}

function renderTablaIngresos() {
  if (!tabla) return;

  tabla.innerHTML = "";
  const filtrados = getIngresosFiltrados();
  const totalFiltrado = filtrados.reduce((acc, i) => acc + getMontoIngresoParaFiltro(i), 0);
  if (kpiFiltrado) kpiFiltrado.textContent = formatCOP(totalFiltrado);
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / ingresosPageSize));
  ingresosPaginaActual = Math.min(ingresosPaginaActual, totalPaginas);
  const inicio = (ingresosPaginaActual - 1) * ingresosPageSize;
  const pagina = filtrados.slice(inicio, inicio + ingresosPageSize);

  if (!filtrados.length) {
    tabla.innerHTML = `<tr><td colspan="9" style="opacity:.6;text-align:center;">No hay registros</td></tr>`;
    renderPaginacionIngresos(0, 0);
    return;
  }

  pagina.forEach(i => {
    const fecha = i.fecha ? new Date(i.fecha).toLocaleDateString("es-CO") : "-";
    const precio = i.precio != null ? formatCOP(parsePrecio(i.precio)) : "-";

    tabla.innerHTML += `
      <tr>
        <td>${fecha}</td>
        <td>${escapeHTML(i.placa || "-")}</td>
        <td><span class="income-service-cell">${escapeHTML(i.servicio || "-")} ${renderRegistroIngresoBadge(i)}</span></td>
        <td>${escapeHTML(i.trabajador || "-")}</td>
        <td>${precio}</td>
        <td>${renderPagoIngreso(i)}</td>
        <td>${escapeHTML(i.tiempo || "-")}</td>
        <td>${renderAutorIngreso(i)}</td>
        <td>${renderAccionEliminarIngreso(i)}</td>
      </tr>
    `;
  });

  tabla.querySelectorAll(".delete-income").forEach(btn => {
    btn.addEventListener("click", () => eliminarServicioRealizado(btn.dataset.id));
  });

  renderPaginacionIngresos(filtrados.length, totalPaginas);
}

function renderAccionEliminarIngreso(ingreso) {
  if (currentSession?.rol !== "jefe") return `<span class="income-action-locked" title="Solo el jefe puede eliminar">-</span>`;
  return `
    <button
      type="button"
      class="delete delete-income"
      data-id="${escapeHTML(ingreso.id)}"
      title="Eliminar servicio realizado"
      aria-label="Eliminar servicio realizado"
    >
      <i class="fa-solid fa-trash-can"></i>
    </button>
  `;
}

function renderAutorIngreso(ingreso) {
  const nombre = ingreso?.autor_nombre || "Registro anterior";
  const rol = String(ingreso?.autor_rol || "").toLowerCase();
  const etiquetaRol = rol === "jefe" ? "Jefe" : (rol === "admin" ? "Administrador" : "Sin identificar");
  const claseRol = rol === "jefe" ? "boss" : (rol === "admin" ? "admin" : "neutral");
  return `
    <span class="income-actor">
      <b>${escapeHTML(nombre)}</b>
      <small class="${claseRol}">${etiquetaRol}</small>
    </span>
  `;
}

function eliminarServicioRealizado(id) {
  const servicio = ingresosDetalle.find(i => String(i.id) === String(id));
  if (!id || !servicio) {
    SwalPremium.fire("No encontrado", "No se pudo identificar el servicio realizado.", "warning");
    return;
  }

  SwalPremium.fire({
    title: "Eliminar servicio realizado",
    html: `
      <div class="delete-income-summary">
        <span>Placa: <b>${escapeHTML(servicio.placa || "-")}</b></span>
        <span>Servicio: <b>${escapeHTML(servicio.servicio || "-")}</b></span>
        <span>Trabajador: <b>${escapeHTML(servicio.trabajador || "-")}</b></span>
        <span>Valor: <b>${formatCOP(servicio.precio)}</b></span>
      </div>
    `,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Eliminar",
    cancelButtonText: "Cancelar",
    confirmButtonColor: "#d94f4f"
  }).then(result => {
    if (!result.isConfirmed) return;

    showAppLoader("Eliminando servicio realizado...");
    fetch(`${API_URL}?action=eliminarServicioRealizado&id=${encodeURIComponent(id)}`)
      .then(res => res.json())
      .then(resp => {
        if (resp.error) {
          SwalPremium.fire("Error", resp.error, "error");
          return;
        }

        ingresosDetalle = ingresosDetalle.filter(i => String(i.id) !== String(id));
        return Promise.all([
          cargarIngresos({ silent: true }),
          cargarLiquidaciones({ silent: true }),
          cargarPendientesPago({ silent: true })
        ]).then(() => {
          SwalPremium.fire("Eliminado", "El servicio se retiro de ingresos y liquidaciones.", "success");
        });
      })
      .catch(() => {
        SwalPremium.fire("Error de red", "No se pudo eliminar el servicio realizado.", "error");
      })
      .finally(() => hideAppLoader());
  });
}

function confirmarLimpiezaHistorial() {
  if (currentSession?.rol !== "jefe") return;

  SwalPremium.fire({
    title: "¿Limpiar todo el historial?",
    html: `
      <div class="delete-income-summary">
        <span>Se eliminarán permanentemente todos los servicios realizados.</span>
        <span>Recomendado únicamente al iniciar un nuevo año.</span>
      </div>
    `,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Sí, eliminar todo",
    cancelButtonText: "Cancelar",
    confirmButtonColor: "#d94f4f"
  }).then(result => {
    if (!result.isConfirmed) return;

    showAppLoader("Limpiando historial...");
    fetch(`${API_URL}?action=eliminarHistorialServiciosRealizados`)
      .then(res => res.json())
      .then(resp => {
        if (resp.error) {
          SwalPremium.fire("No se pudo limpiar", resp.error, "error");
          return;
        }

        ingresosDetalle = [];
        ingresosResumen = null;
        ingresosCompletosCargados = false;
        return Promise.all([
          cargarIngresos({ silent: true }),
          cargarLiquidaciones({ silent: true }),
          cargarPendientesPago({ silent: true })
        ]).then(() => {
          const cantidad = Number(resp.eliminados || 0);
          const mensaje = cantidad ? `${cantidad} registros fueron eliminados permanentemente.` : "El historial ya estaba vacío.";
          SwalPremium.fire("Historial actualizado", mensaje, "success");
        });
      })
      .catch(() => {
        SwalPremium.fire("Error de red", "No se pudo limpiar el historial.", "error");
      })
      .finally(() => hideAppLoader());
  });
}

function toDatetimeLocalValue(fecha = new Date()) {
  const d = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function abrirModalRegistroManual() {
  const serviciosDisponibles = serviciosData.filter(s => s && s.nombre);
  const trabajadoresDisponibles = trabajadoresData.filter(t =>
    esOperarioLiquidable(t) &&
    normalizarTexto(t.activo || "activo") !== "inactivo"
  );

  if (!serviciosDisponibles.length || !trabajadoresDisponibles.length) {
    SwalPremium.fire(
      "Faltan datos",
      "Carga al menos un servicio y un trabajador operativo para registrar manualmente.",
      "warning"
    );
    return;
  }

  const servicioInicial = serviciosDisponibles[0];
  const precioInicial = parsePrecio(servicioInicial.precio);

  SwalPremium.fire({
    title: "Registrar servicio realizado",
    html: `
      <div class="manual-service-form">
        <div class="manual-service-field">
          <label>Placa</label>
          <input id="manualPlaca" class="swal2-input" placeholder="ABC123" autocomplete="off">
        </div>
        <div class="manual-service-field">
          <label>Servicio</label>
          <select id="manualServicio" class="swal2-input">
            ${serviciosDisponibles.map(s => `
              <option value="${escapeHTML(s.id)}" data-precio="${escapeHTML(s.precio)}">
                ${escapeHTML(s.nombre)} - ${formatCOP(s.precio)}
              </option>
            `).join("")}
          </select>
        </div>
        <div class="manual-service-field">
          <label>Trabajador que lo realizo</label>
          <select id="manualTrabajador" class="swal2-input">
            ${trabajadoresDisponibles.map(t => `
              <option value="${escapeHTML(t.nombre)}">${escapeHTML(t.nombre)}</option>
            `).join("")}
          </select>
        </div>
        <div class="manual-service-field">
          <label>Valor cobrado</label>
          <input id="manualPrecio" class="swal2-input" type="number" min="0" step="100" value="${precioInicial}">
        </div>
        <div class="manual-service-field">
          <label>Fecha y hora realizada</label>
          <input id="manualFecha" class="swal2-input" type="datetime-local" value="${toDatetimeLocalValue()}">
        </div>
        <div class="manual-service-field">
          <label>Metodo de pago</label>
          <select id="manualMetodoPago" class="swal2-input">
            <option value="">Selecciona metodo de pago</option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="bre_b">Bre-B</option>
            <option value="mixto">Pago mixto</option>
            <option value="pendiente">Pendiente por pagar</option>
          </select>
        </div>
        <div class="manual-service-field manual-service-wide">
          ${renderPagoMixtoForm(precioInicial, "manual")}
        </div>
        <div class="manual-service-field manual-service-wide">
          <label>Nota interna (opcional)</label>
          <textarea id="manualNota" class="swal2-textarea" placeholder="Ej: servicio registrado al cierre"></textarea>
        </div>
      </div>
    `,
    icon: "question",
    customClass: {
      popup: "swal-glass-popup manual-service-popup"
    },
    showCancelButton: true,
    confirmButtonText: "Registrar",
    cancelButtonText: "Cancelar",
    didOpen: () => {
      const servicioSelect = document.getElementById("manualServicio");
      const precioInput = document.getElementById("manualPrecio");
      const mixedBox = document.getElementById("manualPagoMixtoBox");
      const pago1Monto = document.getElementById("manualPago1Monto");
      const pago2Monto = document.getElementById("manualPago2Monto");

      bindPagoMixtoUI(() => Number(precioInput?.value || 0), "manual");

      const syncPrecioServicio = () => {
        const option = servicioSelect?.selectedOptions?.[0];
        const precio = Number(option?.dataset?.precio || 0);
        if (precioInput && precio > 0) precioInput.value = precio;
        mixedBox?.syncMixedPaymentTotal?.();
        if (pago1Monto && precio > 0) pago1Monto.value = precio;
        if (pago2Monto) pago2Monto.value = 0;
      };

      const syncPagoManual = () => {
        const precio = Number(precioInput?.value || 0);
        mixedBox?.syncMixedPaymentTotal?.();
        if (pago1Monto && precio > 0) pago1Monto.value = precio;
        if (pago2Monto) pago2Monto.value = 0;
      };

      servicioSelect?.addEventListener("change", syncPrecioServicio);
      precioInput?.addEventListener("input", syncPagoManual);
    },
    preConfirm: () => {
      const placa = normalizarPlaca(document.getElementById("manualPlaca")?.value || "");
      const servicioId = document.getElementById("manualServicio")?.value || "";
      const servicio = serviciosDisponibles.find(s => String(s.id) === String(servicioId));
      const trabajador = document.getElementById("manualTrabajador")?.value || "";
      const precio = Number(document.getElementById("manualPrecio")?.value || 0);
      const fechaValor = document.getElementById("manualFecha")?.value || "";
      const fechaMs = fechaValor ? new Date(fechaValor).getTime() : Date.now();
      const metodo = document.getElementById("manualMetodoPago")?.value || "";
      const nota = document.getElementById("manualNota")?.value.trim() || "";

      if (!placa) {
        Swal.showValidationMessage("Escribe la placa");
        return false;
      }

      if (!servicio?.nombre) {
        Swal.showValidationMessage("Selecciona el servicio");
        return false;
      }

      if (!trabajador) {
        Swal.showValidationMessage("Selecciona el trabajador");
        return false;
      }

      if (precio <= 0) {
        Swal.showValidationMessage("El valor cobrado debe ser mayor a cero");
        return false;
      }

      if (!fechaMs || Number.isNaN(fechaMs)) {
        Swal.showValidationMessage("Selecciona una fecha valida");
        return false;
      }

      if (!metodo) {
        Swal.showValidationMessage("Selecciona el metodo de pago");
        return false;
      }

      const payload = getPaymentPayloadFromValues(metodo, precio, "manual");
      if (!payload) return false;

      return {
        query:
          `&placa=${encodeURIComponent(placa)}` +
          `&servicio=${encodeURIComponent(servicio.nombre)}` +
          `&trabajador=${encodeURIComponent(trabajador)}` +
          `&precio=${encodeURIComponent(precio)}` +
          `&fecha_fin=${encodeURIComponent(fechaMs)}` +
          `&nota=${encodeURIComponent(nota)}` +
          payload.query,
        estadoPago: payload.estadoPago
      };
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    showAppLoader("Registrando servicio manual...");
    fetch(`${API_URL}?action=registrarServicioRealizadoManual${result.value.query}`)
      .then(res => res.json())
      .then(resp => {
        if (resp.error) {
          SwalPremium.fire("No se pudo registrar", resp.error, "error");
          return;
        }

        return Promise.all([
          cargarIngresos({ silent: true }),
          cargarLiquidaciones({ silent: true }),
          cargarPendientesPago({ silent: true })
        ]).then(() => {
          SwalPremium.fire("Registrado", "El servicio ya cuenta para ingresos y liquidacion.", "success");
        });
      })
      .catch(() => {
        SwalPremium.fire("Error de red", "No se pudo registrar el servicio manual.", "error");
      })
      .finally(() => hideAppLoader());
  });
}

function prepararRegistroManual() {
  Promise.all([
    serviciosData.length ? Promise.resolve(serviciosData) : cargarServicios({ silent: true }),
    trabajadoresData.length ? Promise.resolve(trabajadoresData) : cargarTrabajadores({ silent: true })
  ])
    .then(() => abrirModalRegistroManual())
    .catch(() => SwalPremium.fire("Error", "No se pudieron cargar los datos para el registro manual.", "error"));
}

function renderPaginacionIngresos(total, totalPaginas) {
  if (!paginacionIngresos) return;
  if (!total || totalPaginas <= 1) {
    paginacionIngresos.innerHTML = total ? `<span>${total} registros</span>` : "";
    return;
  }

  paginacionIngresos.innerHTML = `
    <span>${total} registros - pagina ${ingresosPaginaActual} de ${totalPaginas}</span>
    <div>
      <button type="button" ${ingresosPaginaActual <= 1 ? "disabled" : ""} data-page-action="prev">Anterior</button>
      <button type="button" ${ingresosPaginaActual >= totalPaginas ? "disabled" : ""} data-page-action="next">Siguiente</button>
    </div>
  `;

  paginacionIngresos.querySelector('[data-page-action="prev"]')?.addEventListener("click", () => {
    ingresosPaginaActual = Math.max(1, ingresosPaginaActual - 1);
    renderTablaIngresos();
  });

  paginacionIngresos.querySelector('[data-page-action="next"]')?.addEventListener("click", () => {
    ingresosPaginaActual = Math.min(totalPaginas, ingresosPaginaActual + 1);
    renderTablaIngresos();
  });
}

function cargarPendientesPago(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) showAppLoader("Cargando pendientes por pagar...");

  return fetch(`${API_URL}?action=pendientesPago`)
    .then(res => res.json())
    .then(data => {
      pendientesPagoData = Array.isArray(data) ? data : [];
      return pendientesPagoData;
    })
    .catch(err => {
      console.error("Error pendientes pago:", err);
      pendientesPagoData = [];
      return [];
    })
    .finally(() => {
      if (!silent) hideAppLoader();
    });
}

function renderPendientesPagoHTML() {
  if (!pendientesPagoData.length) {
    return `<div class="modal-history-empty">No hay servicios pendientes por pagar.</div>`;
  }

  return `
    <div class="modal-history-list">
      ${pendientesPagoData.map(p => `
        <article>
          <div>
            <strong>${escapeHTML(p.placa || "-")}</strong>
            <small>${escapeHTML(p.servicio || "-")} - ${escapeHTML(p.trabajador || "-")}</small>
            <small>${p.fecha ? new Date(p.fecha).toLocaleString("es-CO") : "-"}</small>
          </div>
          <div>
            <b>${formatCOP(p.precio)}</b>
            <button type="button" class="pay-done" data-id="${escapeHTML(p.id)}">Pago efectuado</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function abrirModalPendientesPago() {
  cargarPendientesPago().then(() => {
    SwalPremium.fire({
      title: "Pendientes por pagar",
      html: `<div id="pendientesPagoModal">${renderPendientesPagoHTML()}</div>`,
      confirmButtonText: "Cerrar",
      didOpen: () => {
        document.querySelectorAll(".pay-done").forEach(btn => {
          btn.addEventListener("click", () => abrirModalPagoEfectuado(btn.dataset.id));
        });
      }
    });
  });
}

function abrirModalPagoEfectuado(id) {
  const pendiente = pendientesPagoData.find(p => String(p.id) === String(id));

  SwalPremium.fire({
    title: pendiente ? `Pago de ${pendiente.placa}` : "Pago efectuado",
    html: `
      <select id="pendienteMetodoPago" class="swal2-input">
        <option value="">Selecciona metodo de pago</option>
        <option value="efectivo">Efectivo</option>
        <option value="transferencia">Transferencia</option>
        <option value="bre_b">Bre-B</option>
        <option value="mixto">Pago mixto</option>
      </select>
      ${renderPagoMixtoForm(parsePrecio(pendiente?.precio), "pendiente")}
    `,
    confirmButtonText: "Registrar pago",
    showCancelButton: true,
    didOpen: () => bindPagoMixtoUI(parsePrecio(pendiente?.precio), "pendiente"),
    preConfirm: () => {
      const metodo = document.getElementById("pendienteMetodoPago")?.value || "";
      if (!metodo) {
        Swal.showValidationMessage("Selecciona el metodo de pago");
        return false;
      }
      const payload = getPaymentPayloadFromValues(metodo, parsePrecio(pendiente?.precio), "pendiente");
      return payload || false;
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    showAppLoader("Registrando pago...");
    fetch(
      `${API_URL}?action=marcarPagoEfectuado` +
      `&id=${encodeURIComponent(id)}` +
      result.value.query
    )
      .then(res => res.json())
      .then(resp => {
        if (resp.error) {
          SwalPremium.fire("Error", resp.error, "error");
          return;
        }

        pendientesPagoData = pendientesPagoData.filter(pendiente => String(pendiente.id) !== String(id));
        const ingreso = ingresosDetalle.find(item => String(item.id) === String(id));
        if (ingreso) {
          ingreso.estado_pago = "pagado";
          ingreso.metodo_pago = resp.metodo_pago;
          ingreso.pagos = Array.isArray(resp.pagos) ? resp.pagos : [];
          ingreso.fecha_pago = resp.fecha_pago;
          renderResumenIngresos();
          renderTablaIngresos();
          renderCardsTrabajador();
          renderLiquidaciones();
          renderGanancias();
        }
        cargarPendientesPago({ silent: true }).catch(console.error);
        cargarIngresos({ silent: true }).catch(console.error);
        SwalPremium.fire("Pago registrado", "", "success");
      })
      .catch(() => SwalPremium.fire("Error", "No se pudo registrar el pago.", "error"))
      .finally(() => hideAppLoader());
  });
}

/* ---------- EVENTO FILTRO BUSCADOR ---------- */
function resetRenderTablaIngresos() {
  ingresosPaginaActual = 1;
  renderTablaIngresos();
}

if (buscador) buscador.oninput = resetRenderTablaIngresos;
if (filtroMetodoPago) filtroMetodoPago.onchange = resetRenderTablaIngresos;
if (btnRegistroManual) btnRegistroManual.onclick = prepararRegistroManual;
if (filtroIngresosAutor) filtroIngresosAutor.onchange = resetRenderTablaIngresos;
if (filtroIngresosTrabajador) filtroIngresosTrabajador.onchange = resetRenderTablaIngresos;
if (filtroIngresosServicio) filtroIngresosServicio.onchange = resetRenderTablaIngresos;
if (filtroIngresosFecha) filtroIngresosFecha.onchange = resetRenderTablaIngresos;
if (btnHistorialPlaca) {
  btnHistorialPlaca.addEventListener("click", () => abrirModalHistorialPlaca());
}
if (btnPendientesPago) {
  btnPendientesPago.addEventListener("click", () => abrirModalPendientesPago());
}
if (btnLimpiarHistorial) {
  btnLimpiarHistorial.addEventListener("click", confirmarLimpiezaHistorial);
}

/* ---------- LLAMADA INICIAL ---------- */
/*
document.addEventListener("DOMContentLoaded", () => {
  cargarIngresos();
  // AsegÃºrate de que estas funciones existan en tu cÃ³digo
  cargarActivos?.();
  cargarRecogidas?.();
  cargarServicios?.();
  cargarTrabajadores?.();
});
*/



/* ===============================
   CARGAR RECOGIDAS
   =============================== */
function cargarRecogidas(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) setSectionLoading("recogidas", true, "Cargando recogidas...");

  return fetch(`${API_URL}?action=recogidas`)
    .then(res => res.json())
    .then(data => {
      recogidasData = Array.isArray(data) ? data : [];
      renderRecogidas();
    })
    .catch(err => {
      console.error("Error recogidas:", err);
      listaRecogidas.innerHTML = "<p>Error cargando recogidas</p>";
    })
    .finally(() => {
      if (!silent) setSectionLoading("recogidas", false);
    });
}


function renderRecogidas() {
  listaRecogidas.innerHTML = "";

  if (!recogidasData.length) {
    listaRecogidas.innerHTML = "<p>No hay recogidas pendientes</p>";
    return;
  }

  recogidasData.forEach(r => {
    const card = document.createElement("div");
    card.className = "card-recogida";

    card.innerHTML = `
      <b>ðŸ‘¤ ${r.nombre}</b>
      <small>ðŸ“ž ${r.telefono}</small>

      <div style="margin-top:6px">
        <b>ðŸï¸ Placa:</b> ${r.placa}<br>
        <b>ðŸ“… Fecha:</b> ${r.fecha}<br>
        <b>â° Hora:</b> ${r.hora}
      </div>

      <span style="color:#facc15;margin:8px 0;display:block">
        Estado: ${r.estado}
      </span>

      <button class="btn-start">Iniciar lavado</button>
    `;

    /* =====================================
       EVENTO BOTÃ“N â€“ SWEETALERT PREMIUM
       ===================================== */
    card.querySelector(".btn-start").onclick = () => {

      // ðŸ”’ Seguridad: servicios cargados
      if (!serviciosData.length) {
        SwalPremium.fire("Error", "No hay servicios disponibles", "error");
        return;
      }

      SwalPremium.fire({
        title: "Seleccionar servicio",
        text: "Este servicio serÃ¡ asignado a la recogida",
        input: "select",
        inputOptions: serviciosData.reduce((acc, s) => {
          acc[s.nombre] = `${s.nombre} - $${s.precio}`;
          return acc;
        }, {}),
        inputPlaceholder: "Selecciona un servicio",
        showCancelButton: true,
        confirmButtonText: "Iniciar lavado",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#c99a3a"
      }).then(result => {
        if (!result.isConfirmed) return;
        showAppLoader("Iniciando lavado...");

        fetch(
          `${API_URL}?action=iniciarRecogida&id=${r.id}&servicio=${encodeURIComponent(result.value)}`
        )
          .then(res => res.json())
          .then(resp => {
            if (resp.error) {
              SwalPremium.fire("Error", resp.error, "error");
            } else {
              SwalPremium.fire({
                icon: "success",
                title: "Lavado iniciado",
                html: `
                  <b>Servicio:</b> ${resp.servicio}<br>
                  <b>Trabajador:</b> ${resp.trabajador}<br>
                  <b>Precio:</b> $${resp.precio}
                `
              });

              // ðŸ”„ REFRESCOS CLAVE
              cargarRecogidas({ silent: true });
              cargarActivos({ silent: true });
              cargarTrabajadores({ silent: true });
            }
          })
          .catch(() => {
            SwalPremium.fire("Error", "Error de conexiÃ³n", "error");
          })
          .finally(() => {
            hideAppLoader();
          });
      });
    };

    listaRecogidas.appendChild(card);
  });
}


/* =========================================================
   CALCULAR TOTAL DE DINERO POR TRABAJADOR
   (en base a servicios realizados)
========================================================= */

const filtroTrabajador = document.getElementById("filtroTrabajador");
const cardsTrabajador = document.getElementById("cardsTrabajador");
const filtroFecha = document.getElementById("filtroFecha");


if (filtroTrabajador) {
  filtroTrabajador.onchange = () => {
    renderCardsTrabajador();
    renderLiquidaciones();
  };
}

if (filtroFecha) {
  filtroFecha.onchange = renderCardsTrabajador;
}

if (buscadorLiquidaciones) {
  buscadorLiquidaciones.addEventListener("input", () => {
    renderCardsTrabajador();
    renderLiquidaciones();
  });
}



/* ===============================
   RENDER SELECT DE TRABAJADORES
=============================== */
function renderFiltroTrabajadores() {
  if (!filtroTrabajador) return;

  // ðŸ§  Guardar selecciÃ³n actual
  const seleccionado = filtroTrabajador.value;

  filtroTrabajador.innerHTML =
    `<option value="">Todos los trabajadores</option>`;

  const trabajadoresLiquidables = trabajadoresData.filter(esOperarioLiquidable);

  trabajadoresLiquidables.forEach(t => {
    filtroTrabajador.innerHTML += `
      <option value="${escapeHTML(t.nombre || "")}">${escapeHTML(t.nombre || "Trabajador")}</option>
    `;
  });

  // ðŸ” Restaurar selecciÃ³n si aÃºn existe
  if (
    seleccionado &&
    trabajadoresLiquidables.some(t => t.nombre === seleccionado)
  ) {
    filtroTrabajador.value = seleccionado;
  }
}



function obtenerRangoFechaFiltro(filtro) {
  const valor = String(filtro || "15");
  const hoy = new Date();
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const fin = new Date(inicioHoy);
  fin.setDate(fin.getDate() + 1);

  if (valor === "hoy") {
    return { inicio: inicioHoy, fin };
  }

  if (valor === "ayer") {
    const inicio = new Date(inicioHoy);
    inicio.setDate(inicio.getDate() - 1);
    return { inicio, fin: inicioHoy };
  }

  const dias = Math.max(1, Number(valor) || 15);
  const inicio = new Date(inicioHoy);
  inicio.setDate(inicio.getDate() - (dias - 1));
  return { inicio, fin };
}

function fechaDentroDeFiltro(fecha, filtro) {
  if (!fecha) return false;
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(d)) return false;
  const rango = obtenerRangoFechaFiltro(filtro);
  return d >= rango.inicio && d < rango.fin;
}

function filtrarPorFecha(detalle, filtro) {
  if (!filtro) return detalle;
  return detalle.filter(i => fechaDentroDeFiltro(i.fecha, filtro));
}

//FUNCION PARA ANALIZAR CON FILTRO POR FECHA SI LA LIQUIDACION FUE DENTRO DEL RANGO DEL SELECT
function liquidacionAplica(liquidacion, diasFiltro) {
  if (!liquidacion) return false;
  if (!diasFiltro) return true;
  return fechaDentroDeFiltro(liquidacion.fecha, diasFiltro);
}


/* ===============================
   CÃLCULO DE INGRESOS
=============================== */
function calcularIngresosPorTrabajador(
  detalle,
  trabajadorFiltro = "",
  diasFiltro = null
) {
  if (!Array.isArray(detalle)) return {};

  let data = [...detalle];

  // 1ï¸âƒ£ Filtro fecha
  if (diasFiltro) {
    data = filtrarPorFecha(data, diasFiltro);
  }

  // 2ï¸âƒ£ Filtro trabajador
  if (trabajadorFiltro) {
    data = data.filter(i => i.trabajador === trabajadorFiltro);
  }

  // 3ï¸âƒ£ AgrupaciÃ³n
  return data.reduce((acc, i) => {
    if (!acc[i.trabajador]) {
      acc[i.trabajador] = {
        trabajador: i.trabajador,
        total: 0,
        servicios: 0
      };
    }

    acc[i.trabajador].total += Number(i.precio) || 0;
    acc[i.trabajador].servicios++;

    return acc;
  }, {});
}

function getUltimaLiquidacionTrabajador(trabajador) {
  if (!trabajador) return null;

  const porId = liquidacionesData[String(trabajador.id)] || liquidacionesData[trabajador.id];
  if (porId?.fecha) return porId;

  const nombreNormalizado = normalizarTexto(trabajador.nombre || "");
  if (!nombreNormalizado) return null;

  return liquidacionesDetalle
    .filter(item => normalizarTexto(item.trabajador || "") === nombreNormalizado)
    .reduce((ultima, item) => {
      const fecha = toTimestamp(item.fecha);
      if (!fecha) return ultima;
      if (!ultima || fecha > toTimestamp(ultima.fecha)) return item;
      return ultima;
    }, null);
}

function calcularPendienteLiquidacionTrabajador(trabajador) {
  const liquidacion = getUltimaLiquidacionTrabajador(trabajador);
  const ultimaFecha = toTimestamp(liquidacion?.fecha);

  const ingresosPendientes = ingresosDetalle.filter(ingreso => {
    if (ingreso.trabajador !== trabajador.nombre) return false;
    const fechaServicio = toTimestamp(ingreso.fecha);
    if (!fechaServicio) return false;
    return !ultimaFecha || fechaServicio > ultimaFecha;
  });

  const total = ingresosPendientes.reduce((acc, ingreso) => acc + Number(ingreso.precio || 0), 0);
  return {
    trabajador,
    liquidacion,
    ingresos: ingresosPendientes,
    total,
    servicios: ingresosPendientes.length
  };
}


/* ===============================
   RENDER CARDS GLASS / NEON
=============================== */
function renderCardsTrabajador() {
  if (!cardsTrabajador) return;

  const trabajadorSeleccionado = filtroTrabajador.value;
  const busquedaLiquidaciones = normalizarTexto(buscadorLiquidaciones?.value || "");

  if (!liquidacionesCargadas || !ingresosCompletosCargados) {
    cardsTrabajador.innerHTML = `<p style="opacity:.6">Actualizando liquidaciones...</p>`;
    return;
  }

  // 1ï¸âƒ£ Filtrar trabajadores segÃºn selecciÃ³n
  let trabajadoresAFiltrar = trabajadoresData.filter(trabajador =>
    esOperarioLiquidable(trabajador) && !liquidacionesExcluidas.has(String(trabajador.id))
  );
  if (trabajadorSeleccionado) {
    trabajadoresAFiltrar = trabajadoresAFiltrar.filter(
      t => t.nombre === trabajadorSeleccionado
    );
  }
  if (busquedaLiquidaciones) {
    trabajadoresAFiltrar = trabajadoresAFiltrar.filter(trabajador =>
      trabajadorCoincideConBusqueda(trabajador, busquedaLiquidaciones)
    );
  }

  cardsTrabajador.innerHTML = "";

  if (!trabajadoresAFiltrar.length) {
    cardsTrabajador.innerHTML =
      `<p style="opacity:.6">Sin datos para el rango seleccionado</p>`;
    return;
  }

  let cardsRenderizadas = 0;

  // Renderizar trabajadores
  trabajadoresAFiltrar.forEach(trabajador => {
    const resumenPendiente = calcularPendienteLiquidacionTrabajador(trabajador);
    const { liquidacion, total, servicios } = resumenPendiente;
    if (!servicios || total <= 0) return;

    const card = document.createElement("div");
    card.className = "card-glass-neon clickable";

    // Info de liquidacion
    let liquidacionHTML = "";
    if (liquidacion) {
      liquidacionHTML = `
        <hr style="opacity:.2;margin:8px 0">
        <small style="color:#c99a3a">
          Ultima liquidacion: $${liquidacion.valor.toLocaleString()}
          <br>
          <span style="opacity:.6;font-size:.75rem">
            ${formatoFechaBonita(liquidacion.fecha)}
            ${liquidacion.periodo ? `(Periodo ${liquidacion.periodo} dias)` : ""}
          </span>
        </small>
      `;
    }

    card.innerHTML = `
      <h3>${trabajador.nombre}</h3>

      <p class="neon">
        $${total.toLocaleString()}
      </p>

      <small>
        ${servicios} servicios pendientes por liquidar
      </small>

      <div class="liquidacion-info">
        ${liquidacionHTML}
      </div>
    `;

    // 5ï¸âƒ£ Click â†’ liquidar SOLO lo nuevo
    card.onclick = () => {
      abrirModalLiquidacion({
        trabajador: trabajador.nombre,
        correo: trabajador.correo,
        total,
        servicios,
        id: trabajador.id
      });

    };

    cardsTrabajador.appendChild(card);
    cardsRenderizadas++;
  });

  if (!cardsRenderizadas) {
    cardsTrabajador.innerHTML =
      `<p style="opacity:.6">Sin trabajadores para mostrar.</p>`;
  }
}





function buildEmailNominaData({ trabajador, total, servicios, liquidacion }) {
  return {
    // EmailJS usa esto para enviar
    email: trabajador.correo,

    trabajador_nombre: trabajador.nombre,
    total: total.toLocaleString("es-CO"),
    servicios,
    anio: new Date().getFullYear(),

    ultima_liquidacion: liquidacion
      ? {
          valor: liquidacion.valor.toLocaleString("es-CO"),
          fecha: formatoFechaBonita(liquidacion.fecha),
          periodo: liquidacion.periodo
            ? `(Periodo ${liquidacion.periodo} dÃ­as)`
            : ""
        }
      : null
  };
}





/* ===============================
   EVENTO FILTRO
=============================== */
if (filtroTrabajador) {
  filtroTrabajador.onchange = renderCardsTrabajador;
}


/* ===============================
  ABRIR EL MODAL DE LIQUIDACION
=============================== */
function abrirModalLiquidacion(resumenTrabajador) {
  if (Number(resumenTrabajador.total || 0) <= 0) {
    SwalPremium.fire(
      "Sin saldo por liquidar",
      "Este trabajador no tiene servicios realizados pendientes por liquidar.",
      "info"
    );
    return;
  }

  let liquidacion = { ...liquidacionesData[resumenTrabajador.id] };

  const frecuenciaTexto = (periodo) => {
    if (periodo === 7) return "semanal";
    if (periodo === 15) return "quincenal";
    if (periodo === 30) return "mensual";
    return "personalizada";
  };

  SwalPremium.fire({
    title: `Liquidar a ${resumenTrabajador.trabajador}`,
    html: `
      <div style="text-align:center;color:#f4f7f5;">
        <p style="font-weight:600;">Total generado en el periodo:</p>
        <p style="font-size:1.6rem;font-weight:700;color:#c99a3a;">
          $${resumenTrabajador.total.toLocaleString()}
        </p>

        ${
          liquidacion.fecha
            ? `<p style="opacity:.8;font-size:.9rem;">
                Ultima liquidacion:
                <b>${formatoFechaBonita(liquidacion.fecha)}</b>
              </p>`
            : `<p style="opacity:.8;font-size:.9rem;">
                Este trabajador aÃºn no ha sido liquidado
              </p>`
        }

        <input
          id="porcentajeLiquidacion"
          type="number"
          class="swal2-input"
          placeholder="Porcentaje (%)"
          min="1"
          max="100"
          value="${liquidacion.porcentaje || ""}"
          style="width:80%;max-width:250px;"
        />
      </div>
    `,
    confirmButtonText: "Liquidar",
    cancelButtonText: "Cancelar",
    showCancelButton: true,
    confirmButtonColor: "#c99a3a",
    cancelButtonColor: "#f87171",
    focusConfirm: false,

    preConfirm: () => {
      const porcentaje = Number(
        document.getElementById("porcentajeLiquidacion").value
      );
      if (!porcentaje || porcentaje <= 0 || porcentaje > 100) {
        Swal.showValidationMessage("Porcentaje invÃ¡lido");
        return false;
      }
      return { porcentaje };
    }

  }).then(result => {
    if (!result.isConfirmed) return;

    try {
      const { porcentaje } = result.value;
      const hoy = new Date();

      const tipoLiquidacion = liquidacion.periodo
        ? frecuenciaTexto(liquidacion.periodo)
        : "libre";

      const valorLiquidado = Math.round(
        (resumenTrabajador.total * porcentaje) / 100
      );

      showAppLoader("Liquidando trabajador...");
      guardarLiquidacion(resumenTrabajador.trabajador, valorLiquidado)
        .then(resp => {
          if (resp?.error) throw new Error(resp.error);
          const liquidacionRegistrada = resp.liquidacion;
          if (liquidacionRegistrada?.trabajadorId) {
            liquidacionesCargadas = true;
            liquidacionesData[liquidacionRegistrada.trabajadorId] = {
              valor: Number(liquidacionRegistrada.valor) || 0,
              fecha: new Date(liquidacionRegistrada.fecha),
              trabajador: liquidacionRegistrada.trabajador || ""
            };
            renderCardsTrabajador();
            renderLiquidaciones();
          }
          cargarLiquidaciones({ silent: true }).catch(console.error);

          if (resumenTrabajador.correo) {
            const emailData = {
              email: resumenTrabajador.correo,
              trabajador_nombre: resumenTrabajador.trabajador,
              total: valorLiquidado.toLocaleString("es-CO"),
              servicios: resumenTrabajador.servicios,
              ultima_liquidacion_titulo: "Liquidacion realizada",
              ultima_liquidacion_valor: "$" + valorLiquidado.toLocaleString("es-CO"),
              ultima_liquidacion_fecha: formatoFechaBonita(hoy),
              ultima_liquidacion_periodo: tipoLiquidacion,
              anio: hoy.getFullYear()
            };

            emailjs.send("service_v2h7x1n", "template_lqgfiaq", emailData);
          }

          SwalPremium.fire(
            "Liquidado",
            `Liquidacion ${tipoLiquidacion} registrada correctamente.`,
            "success"
          );
        })
        .catch(err => {
          console.error(err);
          SwalPremium.fire("Error", "No se pudo registrar la liquidacion.", "error");
        })
        .finally(() => {
          hideAppLoader();
        });

    } catch (err) {
      console.error(err);
      SwalPremium.fire("Error", "No se pudo registrar la liquidacion.", "error");
    }
  });
}














/* ===============================
  GUARDAR LA LIQUIDACIÃ“N
=============================== */
function guardarLiquidacion(trabajador, valor) {
  return fetch(
    `${API_URL}?action=liquidarTrabajador` +
    `&trabajador=${encodeURIComponent(trabajador)}` +
    `&valor=${valor}`
  ).then(res => res.json());
}

function cargarLiquidaciones(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) setSectionLoading("liquidaciones", true, "Cargando liquidaciones reales...");

  return fetch(`${API_URL}?action=liquidaciones`)
    .then(res => res.json())
    .then(data => {
      liquidacionesDetalle = Array.isArray(data.detalle) ? data.detalle : [];
      liquidacionesData = {};
      liquidacionesCargadas = true;

      Object.entries(data.resumen || {}).forEach(([id, liquidacion]) => {
        const fecha = toDateSafe(liquidacion.fecha);
        if (!fecha) return;

        liquidacionesData[id] = {
          valor: Number(liquidacion.valor) || 0,
          fecha,
          trabajador: liquidacion.trabajador || ""
        };
      });

      renderCardsTrabajador();
      renderLiquidaciones();
      return liquidacionesData;
    })
    .catch(err => {
      console.error("Error liquidaciones:", err);
      liquidacionesDetalle = [];
      liquidacionesData = {};
      liquidacionesCargadas = false;
      renderCardsTrabajador();
      renderLiquidaciones();
      return {};
    })
    .finally(() => {
      if (!silent) setSectionLoading("liquidaciones", false);
    });
}



/* ===============================
 TABLA DE LIQUIDACIONES Y ULTIMA FECHA EN LA QUE SE LIQUIDARON
=============================== */
const filtroLiquidacionesTrabajador = document.getElementById("filtroLiquidacionesTrabajador");
const filtroLiquidacionesFecha = document.getElementById("filtroLiquidacionesFecha");
const tablaLiquidaciones = document.getElementById("tablaLiquidaciones");

/* ===============================
 FUNCIONES DE PARSEO Y FORMATO DE FECHA
=============================== */
// Convierte cualquier fecha de Sheets a Date segura
function parseFechaSegura(fecha) {
  if (!fecha) return null;

  // Si ya es Date
  if (fecha instanceof Date && !isNaN(fecha)) return fecha;

  // Si es string con formato DD/MM/YYYY
  if (typeof fecha === "string" && fecha.includes("/")) {
    const [dia, mes, anio] = fecha.split("/").map(Number);
    return new Date(anio, mes - 1, dia);
  }

  // Intentar parsear cualquier otro string vÃ¡lido (ej: YYYY-MM-DD)
  const d = new Date(fecha);
  return isNaN(d) ? null : d;
}

// Convierte Date a texto bonito: Lun 12 ene 2026
function formatoFechaBonita(fecha) {
  const fechaNormalizada = toDateSafe(fecha);
  if (!fechaNormalizada) return "-";
  return fechaNormalizada.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

/* ===============================
 RENDERIZADO DE LAS LIQUIDACIONES
=============================== */
function renderLiquidaciones() {
  if (!tablaLiquidaciones || !trabajadoresData.length) return;

  const trabajadorFiltro = filtroLiquidacionesTrabajador.value;
  const trabajadorResumenFiltro = filtroTrabajador?.value || "";
  const busquedaLiquidaciones = normalizarTexto(buscadorLiquidaciones?.value || "");

  if (!liquidacionesCargadas || !ingresosCompletosCargados) {
    tablaLiquidaciones.innerHTML = `<tr><td colspan="6">Actualizando liquidaciones...</td></tr>`;
    return;
  }

  let trabajadoresFiltrados = trabajadoresData.filter(trabajador =>
    esOperarioLiquidable(trabajador) && !liquidacionesExcluidas.has(String(trabajador.id))
  );
  if (trabajadorResumenFiltro) {
    trabajadoresFiltrados = trabajadoresFiltrados.filter(t => t.nombre === trabajadorResumenFiltro);
  }
  if (trabajadorFiltro) {
    trabajadoresFiltrados = trabajadoresFiltrados.filter(t => t.nombre === trabajadorFiltro);
  }
  if (busquedaLiquidaciones) {
    trabajadoresFiltrados = trabajadoresFiltrados.filter(trabajador =>
      trabajadorCoincideConBusqueda(trabajador, busquedaLiquidaciones)
    );
  }

  const filas = trabajadoresFiltrados.map(t => {
    const resumenPendiente = calcularPendienteLiquidacionTrabajador(t);
    const { liquidacion, total, servicios } = resumenPendiente;
    if (!servicios || total <= 0) return "";

    // Valor liquidado en COP
    const valorFormateado = liquidacion && liquidacion.valor != null ? formatCOP(liquidacion.valor) : "-";

    // Fecha bonita
    const fechaFormateada = liquidacion && liquidacion.fecha ? formatoFechaBonita(liquidacion.fecha) : "-";

    return `
      <tr>
        <td>${escapeHTML(t.nombre)}</td>
        <td>${escapeHTML(t.estado)}</td>
        <td>${formatCOP(total)}</td>
        <td>${valorFormateado}</td>
        <td>${fechaFormateada}</td>
        <td><button type="button" class="delete delete-liquidacion" data-trabajador-id="${escapeHTML(t.id)}">Eliminar</button></td>
      </tr>
    `;
  });

  const contenido = filas.filter(Boolean).join("");
  if (!contenido) {
    tablaLiquidaciones.innerHTML = `<tr><td colspan="6">No hay liquidaciones para este filtro</td></tr>`;
    return;
  }

  tablaLiquidaciones.innerHTML = contenido;
  tablaLiquidaciones.querySelectorAll(".delete-liquidacion").forEach(boton => {
    boton.addEventListener("click", () => {
      const trabajador = trabajadoresData.find(item => String(item.id) === boton.dataset.trabajadorId);
      if (trabajador) eliminarLiquidacion(trabajador);
    });
  });
}

function eliminarLiquidacion(trabajador) {
  SwalPremium.fire({
    title: "¿Eliminar de liquidaciones?",
    text: `${trabajador.nombre} dejará de aparecer en este módulo. Sus demás datos se conservarán.`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Eliminar",
    cancelButtonText: "Cancelar"
  }).then(result => {
    if (!result.isConfirmed) return;

    showAppLoader("Eliminando liquidación...");
    fetch(`${API_URL}?action=eliminarLiquidacion&trabajador_id=${encodeURIComponent(trabajador.id)}`)
      .then(res => res.json())
      .then(resp => {
        if (resp.error) throw new Error(resp.error);
        liquidacionesExcluidas.add(String(trabajador.id));
        delete liquidacionesData[trabajador.id];
        renderLiquidaciones();
        renderCardsTrabajador();
        cargarLiquidaciones({ silent: true }).catch(console.error);
        SwalPremium.fire("Eliminado", "El trabajador fue retirado de liquidaciones.", "success");
      })
      .catch(error => {
        console.error(error);
        SwalPremium.fire("Error", error.message || "No se pudo eliminar la liquidación.", "error");
      })
      .finally(() => hideAppLoader());
  });
}

/* ===============================
 RENDERIZADO DEL SELECT DE TRABAJADORES
=============================== */
function renderFiltroLiquidaciones() {
  if (!filtroLiquidacionesTrabajador) return;

  const seleccionado = filtroLiquidacionesTrabajador.value;

  filtroLiquidacionesTrabajador.innerHTML = `<option value="">Todos los trabajadores</option>`;
  const trabajadoresLiquidables = trabajadoresData.filter(esOperarioLiquidable);

  trabajadoresLiquidables.forEach(t => {
    filtroLiquidacionesTrabajador.innerHTML += `<option value="${escapeHTML(t.nombre || "")}">${escapeHTML(t.nombre || "Trabajador")}</option>`;
  });

  if (seleccionado && trabajadoresLiquidables.some(t => t.nombre === seleccionado)) {
    filtroLiquidacionesTrabajador.value = seleccionado;
  }
}

/* ===============================
 EVENTOS DE FILTROS
=============================== */
if (filtroLiquidacionesTrabajador) filtroLiquidacionesTrabajador.onchange = renderLiquidaciones;
if (filtroLiquidacionesFecha) filtroLiquidacionesFecha.onchange = renderLiquidaciones;

/* ===============================
 CARGA DE DATOS
=============================== */
function cargarTrabajadores(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    setSectionLoading("trabajadores", true, "Cargando trabajadores...");
    setSectionLoading("liquidaciones", true, "Actualizando liquidaciones...");
  }

  return fetch(`${API_URL}?action=trabajadores`)
    .then(res => res.json())
    .then(data => {
      trabajadoresData = Array.isArray(data) ? data : [];

      renderFiltroTablaTrabajadores();
      renderTrabajadores();
      renderFiltroTrabajadores();
      renderFiltroLiquidaciones();
      renderLiquidaciones();
    })
    .catch(console.error)
    .finally(() => {
      if (!silent) {
        setSectionLoading("trabajadores", false);
        setSectionLoading("liquidaciones", false);
      }
    });
}

function cargarIngresos(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    setSectionLoading("ingresos", true, "Cargando servicios realizados...");
    setSectionLoading("ganancias", true, "Calculando inteligencia...");
    setSectionLoading("liquidaciones", true, "Actualizando liquidaciones...");
  }

  return fetch(`${API_URL}?action=ingresos`)
    .then(res => res.json())
    .then(data => {
      ingresosDetalle = data.detalle || [];
      if (placaHistorialInput?.value) {
        renderHistorialPlaca(placaHistorialInput.value, getHistorialLocalPlaca(placaHistorialInput.value));
      }
      renderFiltrosIngresos();
      renderResumenIngresos();
      renderTablaIngresos();
      renderActivos();
      renderCardsTrabajador();
      renderLiquidaciones();
      renderGanancias();
    })
    .catch(err => {
      console.error("Error cargando ingresos:", err);
      if (tabla) {
        tabla.innerHTML = `<tr><td colspan="9" style="opacity:.6;text-align:center;">Error cargando registros</td></tr>`;
      }
    })
    .finally(() => {
      if (!silent) {
        setSectionLoading("ingresos", false);
        setSectionLoading("ganancias", false);
        setSectionLoading("liquidaciones", false);
      }
    });
}

function renderResumenIngresos() {
  if (!kpiServicios || !kpiHoy || !kpiMes) return;

  if (ingresosResumen && !ingresosCompletosCargados) {
    kpiServicios.textContent = Number(ingresosResumen.hoy?.cantidad || 0);
    kpiHoy.textContent = formatCOP(ingresosResumen.hoy?.total || 0);
    kpiMes.textContent = formatCOP(ingresosResumen.mes?.total || 0);
    return;
  }

  const hoy = new Date();
  const mes = hoy.getMonth();
  const anio = hoy.getFullYear();

  let serviciosHoy = 0;
  let ingresosHoy = 0;
  let ingresosMes = 0;

  ingresosDetalle.forEach(i => {
    const precio = parsePrecio(i.precio);
    const fecha = new Date(i.fecha);
    if (isNaN(fecha)) return;

    if (esMismoDia(fecha, hoy)) {
      serviciosHoy++;
      ingresosHoy += precio;
    }

    if (fecha.getFullYear() === anio && fecha.getMonth() === mes) {
      ingresosMes += precio;
    }
  });

  kpiServicios.textContent = serviciosHoy;
  kpiHoy.textContent = formatCOP(ingresosHoy);
  kpiMes.textContent = formatCOP(ingresosMes);
}



///CONFIGURACION DE ESTILOS GLOBALES PARA EL SWEETALERT
// ðŸ”¹ ConfiguraciÃ³n global para todos los Swal
const SwalPremium = Swal.mixin({
  customClass: {
    popup: 'swal-glass-popup'
  },
  buttonsStyling: false, // usar nuestro CSS en los botones
  backdrop: 'rgba(0,0,0,0.4)',
  showCloseButton: true,
  showCancelButton: true,
  confirmButtonColor: '#c99a3a',
  cancelButtonColor: '#f87171',
  focusConfirm: false
});

 



// ===============================
// SECCION DE GANANCIAS
// ===============================

const filtroGananciasFecha = document.getElementById("filtroGananciasFecha");
const tableroBurbujas = document.getElementById("tableroBurbujas");

const kpiTotalLavados = document.getElementById("kpiTotalLavados");
const kpiIngresosRango = document.getElementById("kpiIngresosRango");
const kpiPeriodoAnterior = document.getElementById("kpiPeriodoAnterior");



 function toTimestamp(fecha) {
  if (!fecha) return null;

  // ya es timestamp
  if (typeof fecha === "number") return fecha;

  // string o Date
  const t = new Date(fecha).getTime();
  return isNaN(t) ? null : t;
}


// ===============================
// FILTRO POR RANGO (TIMESTAMP)
// ===============================
function filtrarPorRango(detalle, dias) {
  if (!dias) return detalle;

  const ahora = Date.now();
  const limite = ahora - dias * 24 * 60 * 60 * 1000;

  return detalle.filter(i => {
    const ts = toTimestamp(i.fecha);
    return ts && ts >= limite;
  });
}


// ===============================
// RENDER GANANCIAS
// ===============================
function renderGanancias() {
  if (!Array.isArray(ingresosDetalle)) return;
  if (!kpiTotalLavados || !kpiIngresosRango || !kpiPeriodoAnterior || !tableroBurbujas) return;

  const dias = Number(filtroGananciasFecha?.value || 15);

  const actuales = filtrarPorRango(ingresosDetalle, dias);

  const anteriores = ingresosDetalle.filter(i => {
    const fecha = toTimestamp(i.fecha);
    if (!fecha) return false;

    const ahora = Date.now();
    const inicioActual = ahora - dias * 24 * 60 * 60 * 1000;
    const inicioAnterior = ahora - dias * 2 * 24 * 60 * 60 * 1000;

    return fecha >= inicioAnterior && fecha < inicioActual;
  });

  // ===============================
  // KPIs
  // ===============================
  kpiTotalLavados.textContent = actuales.length;

  const totalIngresos = actuales.reduce(
    (acc, i) => acc + Number(i.precio || 0),
    0
  );

  kpiIngresosRango.textContent = totalIngresos.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP"
  });

  kpiPeriodoAnterior.textContent = anteriores.length;

  // ===============================
  // AGRUPAR POR TRABAJADOR
  // ===============================
  const resumen = actuales.reduce((acc, i) => {
    const nombre = i.trabajador || "Sin asignar";

    if (!acc[nombre]) {
      acc[nombre] = {
        trabajador: nombre,
        total: 0,
        servicios: 0,
        detalle: []
      };
    }

    acc[nombre].total += Number(i.precio || 0);
    acc[nombre].servicios++;
    acc[nombre].detalle.push(i);

    return acc;
  }, {});

  renderBurbujas(resumen);
  generarChartIngresosMes(ingresosDetalle);
  generarChartTopServicios(actuales);
}

// ===============================
// RENDER BURBUJAS
// ===============================
function renderBurbujas(resumen) {
  tableroBurbujas.innerHTML = "";

  const trabajadores = Object.values(resumen);

  if (!trabajadores.length) {
    tableroBurbujas.innerHTML =
      `<p style="opacity:.6">No hay datos para este perÃ­odo</p>`;
    return;
  }

  trabajadores.forEach(t => {
    const bubble = document.createElement("div");
    bubble.className = "bubble";

    bubble.innerHTML = `
      <h4>${t.trabajador}</h4>
      <p class="neon">$${t.total.toLocaleString()}</p>
      <small>${t.servicios} servicios</small>
    `;

    bubble.addEventListener("click", () =>
      abrirModalGananciasTrabajador(t)
    );

    tableroBurbujas.appendChild(bubble);
  });
}

// ===============================
// MODAL DETALLE TRABAJADOR
// ===============================
function abrirModalGananciasTrabajador(t) {
  SwalPremium.fire({
    title: `${t.trabajador}`,
    html: `
      <p><b>Servicios:</b> ${t.servicios}</p>
      <p><b>Total:</b> $${t.total.toLocaleString()}</p>
      <hr>
      ${t.detalle.map(d => `
        <div style="text-align:left;margin-bottom:8px">
          ${d.servicio || "Servicio"}
          - $${Number(d.precio || 0).toLocaleString()}
          <br>
          <small>${new Date(d.fecha).toLocaleDateString()}</small>
        </div>
      `).join("")}
    `,
    confirmButtonText: "Cerrar"
  });
}

// ===============================
// EVENTO FILTRO
// ===============================
if (filtroGananciasFecha) {
  filtroGananciasFecha.addEventListener("change", renderGanancias);
}

// ===============================
// GRAFICO INGRESOS POR MES
// ===============================
function generarChartIngresosMes(detalle) {

  const agrupado = {};

  detalle.forEach(i => {
    const fecha = toTimestamp(i.fecha);
    if (!fecha) return;
    const d = new Date(fecha);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    if (!agrupado[key]) agrupado[key] = 0;
    agrupado[key] += Number(i.precio || 0);
  });

  const keysConDatos = Object.keys(agrupado).sort();
  const keys = [];
  if (keysConDatos.length) {
    const [anioInicio, mesInicio] = keysConDatos[0].split("-").map(Number);
    const [anioFin, mesFin] = keysConDatos[keysConDatos.length - 1].split("-").map(Number);
    const cursor = new Date(anioInicio, mesInicio - 1, 1);
    const fin = new Date(anioFin, mesFin - 1, 1);

    while (cursor <= fin) {
      keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  const labels = keys.map(key => {
    const [anio, mes] = key.split("-").map(Number);
    return new Date(anio, mes - 1, 1).toLocaleDateString("es-CO", {
      month: "long",
      year: "numeric"
    });
  });
  const data = keys.map(l => agrupado[l] || 0);

  const ctx = document.getElementById("chartIngresosMes");

  if (chartIngresosMes) chartIngresosMes.destroy();

  chartIngresosMes = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data,
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        borderColor: "#c99a3a",
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200);
          g.addColorStop(0, "rgba(201,154,58,.34)");
          g.addColorStop(1, "rgba(201,154,58,0)");
          return g;
        }
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: {
          ticks: {
            callback: v => `$${v.toLocaleString()}`
          }
        }
      }
    }
  });
}

// ===============================
// GRAFICO TOP 10 SERVICIOS
// ===============================
function generarChartTopServicios(detalle) {

  const conteo = {};

  detalle.forEach(i => {
    const nombre = i.servicio || "Servicio";
    conteo[nombre] = (conteo[nombre] || 0) + 1;
  });

  const top = Object.entries(conteo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const labels = top.map(i => i[0]);
  const data = top.map(i => i[1]);

  const ctx = document.getElementById("chartTopServicios");

  if (chartTopServicios) chartTopServicios.destroy();

  chartTopServicios = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data,
        borderRadius: 10,
        backgroundColor: "rgba(201,154,58,.74)"
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}


 


/* ===============================
   INIT
   =============================== */
let dashboardInicializado = false;

function inicializarDashboard() {
  if (dashboardInicializado) {
    Promise.all([
      cargarActivos({ silent: true }),
      cargarIngresos({ silent: true }),
      cargarServicios({ silent: true }),
      cargarTrabajadores({ silent: true }),
      cargarLiquidaciones({ silent: true }),
      cargarRecogidas({ silent: true }),
      cargarPendientesPago({ silent: true })
    ]).catch(console.error);
    return;
  }
  dashboardInicializado = true;

  renderHistorialPlaca("");
  renderCardsTrabajador();
  Promise.all([
    cargarActivos(),
    cargarIngresos(),
    cargarServicios(),
    cargarTrabajadores(),
    cargarLiquidaciones({ silent: true }),
    cargarRecogidas(),
    cargarPendientesPago({ silent: true })
  ]).catch(console.error);

  setInterval(() => cargarActivos({ silent: true }), 10000);
  setInterval(() => cargarRecogidas({ silent: true }), 10000);
  setInterval(updateElapsedTimers, 1000);
}

/* ===============================
   CARGA CONSOLIDADA Y SINCRONIZADA
   =============================== */
const solicitudesEnCurso = new Map();
let ultimaCargaTrabajadores = 0;
let refrescoActivosEnCurso = false;
let refrescoRecogidasEnCurso = false;

function apiJson(action, parametros = {}) {
  const query = new URLSearchParams({ action, ...parametros });
  const key = query.toString();

  if (solicitudesEnCurso.has(key)) return solicitudesEnCurso.get(key);

  const solicitud = fetch(`${API_URL}?${query.toString()}`)
    .then(response => {
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.httpStatus = response.status;
        throw error;
      }
      return response.json();
    })
    .finally(() => solicitudesEnCurso.delete(key));

  solicitudesEnCurso.set(key, solicitud);
  return solicitud;
}

function sincronizarGastosActivos(lavados) {
  const idsActivos = new Set(lavados.map(lavado => String(lavado.id)));

  for (const lavado of lavados) {
    const id = String(lavado.id);
    if (!Array.isArray(lavado.gastos)) continue;
    gastosPorLavado.set(id, lavado.gastos);
    gastosCargados.add(id);
    gastosCargando.delete(id);
  }

  for (const id of [...gastosPorLavado.keys()]) {
    if (!idsActivos.has(id)) {
      gastosPorLavado.delete(id);
      gastosCargados.delete(id);
      gastosCargando.delete(id);
    }
  }
}

function aplicarActivos(lavados) {
  activosData = Array.isArray(lavados) ? lavados : [];
  sincronizarGastosActivos(activosData);
  renderActivos();
  renderResumenActivos();
  return activosData;
}

function aplicarServicios(servicios) {
  serviciosData = Array.isArray(servicios) ? servicios : [];
  renderFiltroServicios();
  renderServicios();
  return serviciosData;
}

function aplicarTrabajadores(trabajadores) {
  trabajadoresData = Array.isArray(trabajadores) ? trabajadores : [];
  ultimaCargaTrabajadores = Date.now();
  renderFiltroTablaTrabajadores();
  renderTrabajadores();
  renderFiltroTrabajadores();
  renderFiltroLiquidaciones();
  renderFiltrosIngresos();
  renderLiquidaciones();
  return trabajadoresData;
}

function aplicarIngresos(ingresos, options = {}) {
  const detalle = Array.isArray(ingresos?.detalle) ? ingresos.detalle : [];
  if (!options.completo && ingresosCompletosCargados && detalle.length < ingresosDetalle.length) {
    if (ingresos?.resumen?.listo) ingresosResumen = ingresos.resumen;
    renderResumenIngresos();
    return ingresosDetalle;
  }

  ingresosDetalle = detalle;
  ingresosCompletosCargados = Boolean(options.completo);
  if (ingresos?.resumen?.listo) {
    ingresosResumen = ingresos.resumen;
  } else if (!ingresosResumen || options.completo) {
    ingresosResumen = null;
  }
  if (placaHistorialInput?.value) {
    renderHistorialPlaca(placaHistorialInput.value, getHistorialLocalPlaca(placaHistorialInput.value));
  }
  renderFiltrosIngresos();
  renderResumenIngresos();
  renderTablaIngresos();
  renderCardsTrabajador();
  renderLiquidaciones();
  renderGanancias();
  return ingresosDetalle;
}

function aplicarLiquidaciones(data) {
  liquidacionesDetalle = Array.isArray(data?.detalle) ? data.detalle : [];
  liquidacionesExcluidas = new Set((data?.excluidos || []).map(id => String(id)));
  liquidacionesData = {};
  liquidacionesCargadas = true;

  Object.entries(data?.resumen || {}).forEach(([id, liquidacion]) => {
    const fecha = toDateSafe(liquidacion.fecha);
    if (!fecha) return;
    liquidacionesData[id] = {
      valor: Number(liquidacion.valor) || 0,
      fecha,
      trabajador: liquidacion.trabajador || ""
    };
  });

  renderCardsTrabajador();
  renderLiquidaciones();
  return liquidacionesData;
}

function aplicarRecogidas(recogidas) {
  recogidasData = Array.isArray(recogidas) ? recogidas : [];
  renderRecogidas();
  return recogidasData;
}

function cargarActivos(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) showAppLoader("Cargando servicios activos...");

  return apiJson("activos")
    .then(aplicarActivos)
    .catch(error => {
      console.error("Error activos:", error);
      if (!activosData.length) lista.innerHTML = "<p>Error cargando lavados</p>";
      return activosData;
    })
    .finally(() => {
      if (!silent) hideAppLoader();
    });
}

function cargarServicios(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) setSectionLoading("servicios", true, "Cargando servicios...");

  return apiJson("servicios")
    .then(aplicarServicios)
    .catch(error => {
      console.error("Error servicios:", error);
      return serviciosData;
    })
    .finally(() => {
      if (!silent) setSectionLoading("servicios", false);
    });
}

function cargarTrabajadores(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    setSectionLoading("trabajadores", true, "Cargando trabajadores...");
    setSectionLoading("liquidaciones", true, "Actualizando liquidaciones...");
  }

  return apiJson("trabajadores")
    .then(aplicarTrabajadores)
    .catch(error => {
      console.error("Error trabajadores:", error);
      return trabajadoresData;
    })
    .finally(() => {
      if (!silent) {
        setSectionLoading("trabajadores", false);
        setSectionLoading("liquidaciones", false);
      }
    });
}

function obtenerTrabajadoresParaAsignacion() {
  if (trabajadoresData.length && Date.now() - ultimaCargaTrabajadores < 30000) {
    return Promise.resolve(trabajadoresData);
  }
  return cargarTrabajadores({ silent: true });
}

function cargarIngresos(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    setSectionLoading("ingresos", true, "Cargando servicios realizados...");
    setSectionLoading("ganancias", true, "Calculando inteligencia...");
    setSectionLoading("liquidaciones", true, "Actualizando liquidaciones...");
  }

  return apiJson("ingresos")
    .then(data => aplicarIngresos(data, { completo: true }))
    .catch(error => {
      console.error("Error cargando ingresos:", error);
      return ingresosDetalle;
    })
    .finally(() => {
      if (!silent) {
        setSectionLoading("ingresos", false);
        setSectionLoading("ganancias", false);
        setSectionLoading("liquidaciones", false);
      }
    });
}

function cargarIngresosCompletos(options = {}) {
  if (ingresosCompletosCargados) return Promise.resolve(ingresosDetalle);
  if (cargaIngresosCompletaEnCurso) return cargaIngresosCompletaEnCurso;

  const showProgress = Boolean(options.showProgress);
  const progressSection = options.progressSection || "ingresos";
  if (showProgress) {
    setSectionLoading(progressSection, true, "Cargando historial completo...");
  }

  cargaIngresosCompletaEnCurso = cargarIngresos({ silent: true })
    .catch(error => {
      console.error("No se pudo cargar el historial completo:", error);
      return ingresosDetalle;
    })
    .finally(() => {
      cargaIngresosCompletaEnCurso = null;
      if (showProgress) setSectionLoading(progressSection, false);
    });

  return cargaIngresosCompletaEnCurso;
}

function cargarIngresosCompletosEnSegundoPlano() {
  const cargar = () => {
    cargarIngresosCompletos({ showProgress: false }).catch(error => {
      console.error("No se pudo cargar el historial completo:", error);
    });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(cargar, { timeout: 1500 });
    return;
  }

  setTimeout(cargar, 0);
}

function cargarLiquidaciones(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) setSectionLoading("liquidaciones", true, "Cargando liquidaciones...");
  return apiJson("liquidaciones")
    .then(aplicarLiquidaciones)
    .catch(error => {
      console.error("Error liquidaciones:", error);
      liquidacionesCargadas = false;
      return liquidacionesData;
    })
    .finally(() => {
      if (!silent) setSectionLoading("liquidaciones", false);
    });
}

function asegurarLiquidacionesListas(options = {}) {
  const showProgress = Boolean(options.showProgress);
  if (showProgress) setSectionLoading("liquidaciones", true, "Actualizando liquidaciones...");

  const cargaLiquidaciones = liquidacionesCargadas
    ? Promise.resolve(liquidacionesData)
    : cargarLiquidaciones({ silent: true });

  return Promise.all([
    cargarIngresosCompletos({ showProgress: false }),
    cargaLiquidaciones
  ])
    .then(() => {
      renderCardsTrabajador();
      renderLiquidaciones();
      return liquidacionesData;
    })
    .finally(() => {
      if (showProgress) setSectionLoading("liquidaciones", false);
    });
}

function cargarRecogidas(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) setSectionLoading("recogidas", true, "Cargando recogidas...");
  return apiJson("recogidas")
    .then(aplicarRecogidas)
    .catch(error => {
      console.error("Error recogidas:", error);
      if (!recogidasData.length) listaRecogidas.innerHTML = "<p>Error cargando recogidas</p>";
      return recogidasData;
    })
    .finally(() => {
      if (!silent) setSectionLoading("recogidas", false);
    });
}

function cargarPendientesPago(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) showAppLoader("Cargando pendientes por pagar...");
  return apiJson("pendientesPago")
    .then(data => {
      pendientesPagoData = Array.isArray(data) ? data : [];
      return pendientesPagoData;
    })
    .catch(error => {
      console.error("Error pendientes pago:", error);
      return pendientesPagoData;
    })
    .finally(() => {
      if (!silent) hideAppLoader();
    });
}

function rechazarPorTimeout(ms, mensaje) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(mensaje)), ms);
  });
}

function cargarDashboardCompatibilidad(error) {
  console.warn("La carga consolidada no está disponible; usando compatibilidad temporal.", error);
  return Promise.all([
    cargarActivos(),
    cargarIngresos(),
    cargarServicios(),
    cargarTrabajadores(),
    cargarLiquidaciones({ silent: true }),
    cargarRecogidas(),
    cargarPendientesPago({ silent: true })
  ]);
}

function cargarBootstrap() {
  showAppLoader("Cargando información...");
  let bootstrapListo = false;
  return Promise.resolve()
    .then(() => Promise.race([
      apiJson("bootstrap"),
      rechazarPorTimeout(4000, "Bootstrap excedio el tiempo de espera")
    ]))
    .then(data => {
      if (data?.auth === false) {
        const error = new Error(data.error || "Sesión expirada");
        error.authFailed = true;
        throw error;
      }
      if (!data?.ok) throw new Error(data?.error || "Respuesta de inicio inválida");
      aplicarServicios(data.servicios);
      aplicarTrabajadores(data.trabajadores);
      aplicarActivos(data.activos);
      aplicarIngresos(data.ingresos);
      liquidacionesDetalle = [];
      liquidacionesData = {};
      liquidacionesExcluidas = new Set((data.liquidaciones?.excluidos || []).map(id => String(id)));
      liquidacionesCargadas = false;
      renderCardsTrabajador();
      renderLiquidaciones();
      aplicarRecogidas(data.recogidas);
      pendientesPagoData = Array.isArray(data.pendientesPago) ? data.pendientesPago : [];
      bootstrapListo = true;
      return data;
    })
    .finally(() => {
      hideAppLoader();
      if (bootstrapListo) {
        cargarIngresosCompletosEnSegundoPlano();
        cargarLiquidaciones({ silent: true }).catch(error => {
          console.error("No se pudieron cargar las liquidaciones:", error);
        });
      }
    });
}

function refrescarActivosSinSolapamiento() {
  if (document.hidden || refrescoActivosEnCurso) return;
  refrescoActivosEnCurso = true;
  cargarActivos({ silent: true }).finally(() => {
    refrescoActivosEnCurso = false;
  });
}

function refrescarRecogidasSinSolapamiento() {
  if (document.hidden || refrescoRecogidasEnCurso) return;
  refrescoRecogidasEnCurso = true;
  cargarRecogidas({ silent: true }).finally(() => {
    refrescoRecogidasEnCurso = false;
  });
}

function inicializarDashboard() {
  if (dashboardInicializado) {
    Promise.resolve()
      .then(cargarBootstrap)
      .catch(error => {
        if (error.authFailed) {
          cerrarSesion({ silent: true, expired: true });
          return;
        }
        cargarDashboardCompatibilidad(error).catch(fallbackError => {
          console.error("No se pudo actualizar el inicio:", fallbackError);
        });
      });
    return;
  }

  dashboardInicializado = true;
  renderHistorialPlaca("");
  renderCardsTrabajador();

  Promise.resolve()
    .then(cargarBootstrap)
    .catch(error => {
      if (error.authFailed) {
        cerrarSesion({ silent: true, expired: true });
        return;
      }
      return cargarDashboardCompatibilidad(error);
    });

  setInterval(refrescarActivosSinSolapamiento, 10000);
  setInterval(refrescarRecogidasSinSolapamiento, 30000);
  setInterval(updateElapsedTimers, 1000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refrescarActivosSinSolapamiento();
      refrescarRecogidasSinSolapamiento();
    }
  });
}

function iniciarAplicacion() {
  configurarLogin();
  Promise.resolve()
    .then(validarSesionGuardada)
    .catch(error => {
      console.error("No se pudo recuperar la sesion guardada:", error);
      hideAppLoader();
      setLoggedOutUI();
    });
}

iniciarAplicacion();
