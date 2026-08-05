const SPREADSHEET_ID = SpreadsheetApp.getActive().getId();

const TRABAJADORES_HEADERS = [
  "ID", "Nombre", "Estado", "Liquidacion", "Fecha_Liquidacion", "Correo",
  "Password_Hash", "Rol", "Activo", "Creado", "Ultimo_Login"
];

const COMPLETADOS_HEADERS = [
  "ID", "Placa", "Servicio", "Precio", "Trabajador", "Fecha_Fin", "ID_Original",
  "Tiempo", "Metodo_Pago", "Estado_Pago", "Fecha_Pago",
  "Pago_1_Metodo", "Pago_1_Monto", "Pago_2_Metodo", "Pago_2_Monto",
  "Adicionales_JSON", "Precio_Base", "Tipo_Registro", "Nota"
];

const SESIONES_HEADERS = ["Token", "Correo", "Nombre", "Rol", "Creado", "Expira", "Activo"];
const PAGOS_HEADERS = ["ID", "Trabajador", "Valor", "Fecha", "Tipo"];
const ADICIONALES_HEADERS = ["ID", "Lavado_ID", "Nombre", "Precio", "Fecha", "Activo"];
const LIQUIDACIONES_EXCLUIDAS_HEADERS = ["Trabajador_ID", "Trabajador", "Fecha", "Eliminado_Por"];
const INDICE_INGRESOS_HEADERS = ["Tipo", "Clave", "Total", "Cantidad", "Actualizado"];
const BOOTSTRAP_INGRESOS_LIMIT = 120;

function doGet(e) {
  const action = e.parameter.action;

  if (!esAccionPublica(action)) {
    const auth = validarSesionInternaOptimizada(e.parameter.sessionToken);
    if (!auth.ok) return output({ error: auth.error || "Sesion expirada", auth: false });
    e.auth = auth.user;
  }

  switch (action) {
    case "servicios": return getServicios();
    case "agendar": return agendarLavado(e);
    case "activos": return getLavadosActivosOptimizado();
    case "bootstrap": return getBootstrapData();
    case "confirmar": return confirmarLavado(e);
    case "registrarServicioRealizadoManual": return registrarServicioRealizadoManual(e);
    case "eliminarLavadoActivo": return eliminarLavadoActivo(e);
    case "reasignarTrabajador": return reasignarTrabajador(e);
    case "agregarAdicionalLavado": return agregarAdicionalLavado(e);
    case "historialPlaca": return getHistorialPlaca(e);
    case "crearServicio": return crearServicio(e);
    case "crearTrabajador": return crearTrabajador(e);
    case "ingresos": return getIngresos();
    case "trabajadores": return getTrabajadores();
    case "editarServicio": return editarServicio(e);
    case "eliminarServicio": return eliminarServicio(e);
    case "editarTrabajador": return editarTrabajador(e);
    case "eliminarTrabajador": return eliminarTrabajador(e);
    case "agendarRecogida": return agendarRecogida(e);
    case "recogidas": return getRecogidasProgramadas();
    case "iniciarRecogida": return iniciarRecogida(e);
    case "liquidarTrabajador": return liquidarTrabajador(e);
    case "liquidaciones": return getLiquidaciones();
    case "eliminarLiquidacion": return eliminarLiquidacion(e);
    case "verificarCorreo": return verificarCorreo(e);
    case "login": return login(e);
    case "validarSesion": return validarSesion(e);
    case "logout": return logout(e);
    case "estadoSetup": return getEstadoSetup();
    case "setupJefeInicial": return setupJefeInicial(e);
    case "crearPassword": return crearPassword(e);
    case "getPagosTrabajador": return getPagosTrabajador(e);
    case "agregarGastoMaterial": return agregarGastoMaterial(e);
    case "getGastosPorLavado": return getGastosPorLavado(e);
    case "pendientesPago": return getPendientesPago();
    case "marcarPagoEfectuado": return marcarPagoEfectuado(e);
    case "eliminarServicioRealizado": return eliminarServicioRealizado(e);
    default: return output({ error: "Accion no valida" });
  }
}

function output(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatearDuracion(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  if (horas > 0) return `${horas}h ${String(minutos).padStart(2, "0")}m ${String(segundos).padStart(2, "0")}s`;
  if (minutos > 0) return `${minutos}m ${String(segundos).padStart(2, "0")}s`;
  return `${segundos}s`;
}

function normalizarPlaca(placa) {
  return String(placa || "").trim().toUpperCase().replace(/\s+/g, "");
}

function esAccionPublica(action) {
  return [
    "servicios",
    "agendar",
    "agendarRecogida",
    "login",
    "validarSesion",
    "logout",
    "estadoSetup",
    "verificarCorreo",
    "crearPassword",
    "setupJefeInicial"
  ].indexOf(action) !== -1;
}

function getOrCreateSheet(nombre, headers, spreadsheet) {
  const ss = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);

  if (headers && headers.length) {
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
    } else {
      const current = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length)).getValues()[0];
      const nextHeaders = current.slice(0, headers.length);
      let changed = false;
      headers.forEach((header, i) => {
        if (!nextHeaders[i]) {
          nextHeaders[i] = header;
          changed = true;
        }
      });
      if (changed) sh.getRange(1, 1, 1, headers.length).setValues([nextHeaders]);
    }
  }

  return sh;
}

function normalizarCorreo(correo) {
  return String(correo || "").trim().toLowerCase();
}

function normalizarRol(rol) {
  const value = String(rol || "").trim().toLowerCase();
  return value === "jefe" ? "jefe" : (value === "admin" ? "admin" : "");
}

function normalizarNombreTrabajador(nombre) {
  return String(nombre || "").trim().toLowerCase();
}

function trabajadorTieneLavadoActivo(nombre, activosData) {
  return trabajadorTieneOtroLavadoActivo(nombre, activosData, null);
}

function trabajadorTieneOtroLavadoActivo(nombre, activosData, idIgnorado) {
  const nombreNormalizado = normalizarNombreTrabajador(nombre);
  if (!nombreNormalizado || !activosData) return false;

  for (let i = 1; i < activosData.length; i++) {
    if (idIgnorado !== null && idIgnorado !== undefined && String(activosData[i][0]) === String(idIgnorado)) continue;
    if (normalizarNombreTrabajador(activosData[i][4]) === nombreNormalizado) return true;
  }

  return false;
}

function esOperarioDisponible(row, activosData) {
  const nombre = String(row[1] || "").trim();
  const estado = String(row[2] || "").trim().toLowerCase();
  const rol = normalizarRol(row[7]);
  const activo = String(row[8] || "activo").trim().toLowerCase();

  return Boolean(
    nombre &&
    estado === "libre" &&
    !rol &&
    activo !== "inactivo" &&
    !trabajadorTieneLavadoActivo(nombre, activosData)
  );
}

function buscarOperarioDisponible(workers, activosData, nombre) {
  const nombreBuscado = normalizarNombreTrabajador(nombre);

  for (let i = 1; i < workers.length; i++) {
    if (nombreBuscado && normalizarNombreTrabajador(workers[i][1]) !== nombreBuscado) continue;
    if (esOperarioDisponible(workers[i], activosData)) {
      return { row: i + 1, nombre: String(workers[i][1] || "").trim() };
    }
  }

  return null;
}

function tomarCandadoOperacion() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    return lock;
  } catch (error) {
    return null;
  }
}

function existeJefe() {
  const data = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normalizarRol(data[i][7]) === "jefe") return true;
  }
  return false;
}

function getEstadoSetup() {
  return output({ tieneJefe: existeJefe() });
}

function normalizarMetodoPago(metodo) {
  const value = String(metodo || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (value === "efectivo") return "efectivo";
  if (value === "transferencia") return "transferencia";
  if (value === "bre_b" || value === "breb" || value === "bre-b") return "bre_b";
  if (value === "mixto") return "mixto";
  return "";
}

function getPagosDesdeParametros(e, total, estadoPago) {
  if (estadoPago === "pendiente") {
    return { metodo: "", pagos: [], error: "" };
  }

  const metodo = normalizarMetodoPago(e.parameter.metodo_pago);
  if (!metodo) return { metodo: "", pagos: [], error: "Metodo de pago requerido" };

  if (metodo !== "mixto") {
    return {
      metodo,
      pagos: [{ metodo, monto: Number(total) || 0 }],
      error: ""
    };
  }

  const p1Metodo = normalizarMetodoPago(e.parameter.pago1_metodo);
  const p2Metodo = normalizarMetodoPago(e.parameter.pago2_metodo);
  const p1Monto = Number(e.parameter.pago1_monto || 0);
  const p2Monto = Number(e.parameter.pago2_monto || 0);
  const pagos = [];

  if (p1Metodo && p1Metodo !== "mixto" && p1Monto > 0) pagos.push({ metodo: p1Metodo, monto: p1Monto });
  if (p2Metodo && p2Metodo !== "mixto" && p2Monto > 0) pagos.push({ metodo: p2Metodo, monto: p2Monto });

  if (pagos.length < 2) return { metodo, pagos, error: "El pago mixto necesita dos metodos con monto mayor a cero" };

  const suma = pagos.reduce((acc, pago) => acc + pago.monto, 0);
  if (Math.abs(suma - Number(total || 0)) > 1) {
    return { metodo, pagos, error: "La suma del pago mixto debe ser igual al total del lavado" };
  }

  return { metodo, pagos, error: "" };
}

function getAdicionalesLavadoInterno(lavadoId) {
  const sh = getOrCreateSheet("Lavado_Adicionales", ADICIONALES_HEADERS);
  const data = sh.getDataRange().getValues();
  const adicionales = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== String(lavadoId)) continue;
    if (String(data[i][5] || "activo").toLowerCase() === "inactivo") continue;
    adicionales.push({
      id: data[i][0],
      nombre: data[i][2],
      precio: Number(data[i][3]) || 0,
      fecha: data[i][4] instanceof Date ? data[i][4].getTime() : (data[i][4] ? new Date(data[i][4]).getTime() : null)
    });
  }

  return adicionales;
}

function getNextMidnight() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function crearTokenSesion() {
  return Utilities.getUuid() + "-" + Date.now();
}

function eliminarFilasPorIndices(hoja, filas) {
  while (filas.length) {
    const ultimaFila = filas.pop();
    let primeraFila = ultimaFila;
    while (filas.length && filas[filas.length - 1] === primeraFila - 1) {
      primeraFila = filas.pop();
    }
    hoja.deleteRows(primeraFila, ultimaFila - primeraFila + 1);
  }
}

function eliminarSesionesPorCorreo(correo, spreadsheet) {
  const correoNormalizado = normalizarCorreo(correo);
  if (!correoNormalizado) return;

  const sh = getOrCreateSheet("Sesiones", SESIONES_HEADERS, spreadsheet);
  const data = sh.getDataRange().getValues();
  const filas = [];
  for (let i = 1; i < data.length; i++) {
    if (normalizarCorreo(data[i][1]) === correoNormalizado) filas.push(i + 1);
  }
  eliminarFilasPorIndices(sh, filas);
}

function eliminarSesionPorToken(token) {
  if (!token) return;

  const sh = getOrCreateSheet("Sesiones", SESIONES_HEADERS);
  const data = sh.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(token)) {
      sh.deleteRow(i + 1);
      return;
    }
  }
}

function limpiarSesionesVencidas() {
  const sh = getOrCreateSheet("Sesiones", SESIONES_HEADERS);
  const data = sh.getDataRange().getValues();
  const now = new Date().getTime();

  for (let i = data.length - 1; i >= 1; i--) {
    const expira = data[i][5] instanceof Date ? data[i][5] : new Date(data[i][5]);
    if (!expira || isNaN(expira.getTime()) || expira.getTime() <= now) {
      sh.deleteRow(i + 1);
    }
  }
}

function validarSesionInterna(token) {
  if (!token) return { ok: false, error: "Debes iniciar sesion" };

  limpiarSesionesVencidas();

  const sh = getOrCreateSheet("Sesiones", SESIONES_HEADERS);
  const data = sh.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(token)) continue;

      const expira = data[i][5] instanceof Date ? data[i][5] : new Date(data[i][5]);
      const activo = data[i][6] === true || String(data[i][6]).toLowerCase() === "true" || String(data[i][6]).toLowerCase() === "activo";

      if (!activo || !expira || expira.getTime() <= now.getTime()) {
        sh.deleteRow(i + 1);
        return { ok: false, error: "Sesion expirada" };
      }

      return {
        ok: true,
        user: {
          correo: data[i][1],
          nombre: data[i][2],
          rol: data[i][3],
          expira: expira.getTime()
        }
      };
  }

  return { ok: false, error: "Sesion no valida" };
}

function crearServicio(e) {
  const nombre = e.parameter.nombre;
  const precio = e.parameter.precio;
  if (!nombre || !precio) return output({ error: "Datos incompletos" });

  SpreadsheetApp.openById(SPREADSHEET_ID)
    .getSheetByName("Servicios")
    .appendRow([Date.now(), nombre, Number(precio)]);

  return output({ ok: true });
}

function crearTrabajador(e) {
  const nombre = e.parameter.nombre;
  const correo = normalizarCorreo(e.parameter.correo);
  const password = e.parameter.password || "";
  const rol = normalizarRol(e.parameter.rol);
  const actorRol = normalizarRol(e.auth && e.auth.rol);
  if (!nombre) return output({ error: "Nombre requerido" });
  if ((rol === "admin" || rol === "jefe") && (!correo || !password)) {
    return output({ error: "Correo y password requeridos para administradores" });
  }
  if ((rol === "admin" || rol === "jefe") && actorRol !== "jefe") {
    return output({ error: "Solo el jefe puede crear accesos administrativos" });
  }

  const sh = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (correo && normalizarCorreo(data[i][5]) === correo) {
      return output({ error: "Ya existe un trabajador con ese correo" });
    }
  }

  sh.appendRow([
    Date.now(),
    nombre,
    "libre",
    "",
    "",
    correo,
    password ? hashPassword(password) : "",
    rol,
    rol ? "activo" : "",
    new Date(),
    ""
  ]);

  return output({ ok: true });
}

function getServicios() {
  const data = SpreadsheetApp.openById(SPREADSHEET_ID)
    .getSheetByName("Servicios")
    .getDataRange()
    .getValues();

  const servicios = [];
  for (let i = 1; i < data.length; i++) {
    servicios.push({ id: data[i][0], nombre: data[i][1], precio: data[i][2] });
  }
  return output(servicios);
}

function getTrabajadorLibre() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Trabajadores");
  const activosData = ss.getSheetByName("Lavados_Activos").getDataRange().getValues();
  const data = sheet.getDataRange().getValues();
  return buscarOperarioDisponible(data, activosData, null);
}

function agendarLavado(e) {
  const placa = e.parameter.placa;
  const servicio = e.parameter.servicio;
  const trabajadorManual = e.parameter.trabajador;
  if (!placa || !servicio) return output({ error: "Datos incompletos" });

  const lock = tomarCandadoOperacion();
  if (!lock) return output({ error: "Sistema ocupado, intenta de nuevo" });

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const trabajadoresSheet = ss.getSheetByName("Trabajadores");
    const activosSheet = ss.getSheetByName("Lavados_Activos");
    const trabajadores = trabajadoresSheet.getDataRange().getValues();
    const activosData = activosSheet.getDataRange().getValues();
    let trabajador = null;
    let trabajadorRow = null;

    if (trabajadorManual) {
      const disponible = buscarOperarioDisponible(trabajadores, activosData, trabajadorManual);
      if (!disponible) return output({ error: "Solo se pueden asignar operarios libres" });
      trabajador = disponible.nombre;
      trabajadorRow = disponible.row;
    }

    if (!trabajador) {
      const disponible = buscarOperarioDisponible(trabajadores, activosData, null);
      if (!disponible) return output({ error: "No hay operarios disponibles" });
      trabajador = disponible.nombre;
      trabajadorRow = disponible.row;
    }

    const servicios = ss.getSheetByName("Servicios").getDataRange().getValues();
    let precio = 0;
    for (let i = 1; i < servicios.length; i++) {
      if (servicios[i][1] === servicio) {
        precio = servicios[i][2];
        break;
      }
    }

    activosSheet.appendRow([
      Date.now(),
      normalizarPlaca(placa),
      servicio,
      precio,
      trabajador,
      new Date()
    ]);

    trabajadoresSheet.getRange(trabajadorRow, 3).setValue("ocupado");
    return output({ ok: true, trabajador, servicio, precio });
  } finally {
    lock.releaseLock();
  }
}

function getLavadosActivos() {
  const data = SpreadsheetApp.openById(SPREADSHEET_ID)
    .getSheetByName("Lavados_Activos")
    .getDataRange()
    .getValues();

  const lavados = [];
  for (let i = 1; i < data.length; i++) {
    const adicionales = getAdicionalesLavadoInterno(data[i][0]);
    lavados.push({
      id: data[i][0],
      placa: data[i][1],
      servicio: data[i][2],
      precio: data[i][3],
      trabajador: data[i][4],
      hora: data[i][5],
      adicionales,
      total_adicionales: adicionales.reduce((acc, item) => acc + Number(item.precio || 0), 0)
    });
  }
  return output(lavados);
}

function confirmarLavado(e) {
  const id = e.parameter.id;
  if (!id) return output({ error: "ID requerido" });

  const estadoPago = String(e.parameter.estado_pago || "").toLowerCase() === "pendiente" ? "pendiente" : "pagado";

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const activos = ss.getSheetByName("Lavados_Activos");
  const completados = getOrCreateSheet("Lavados_Completados", COMPLETADOS_HEADERS, ss);
  const trabajadores = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS, ss);
  const data = activos.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const fechaFin = new Date();
      const fechaInicio = data[i][5] instanceof Date ? data[i][5] : new Date(data[i][5]);
      const tiempo = formatearDuracion(fechaFin.getTime() - fechaInicio.getTime());
      const precioFinal = Number(data[i][3]) || 0;
      const pagosInfo = getPagosDesdeParametros(e, precioFinal, estadoPago);
      if (pagosInfo.error) return output({ error: pagosInfo.error });
      const adicionales = getAdicionalesLavadoInterno(data[i][0]);
      const pago1 = pagosInfo.pagos[0] || {};
      const pago2 = pagosInfo.pagos[1] || {};

      completados.appendRow([
        data[i][0],
        data[i][1],
        data[i][2],
        data[i][3],
        data[i][4],
        fechaFin,
        data[i][0],
        tiempo,
        estadoPago === "pendiente" ? "" : pagosInfo.metodo,
        estadoPago,
        estadoPago === "pendiente" ? "" : fechaFin,
        pago1.metodo || "",
        pago1.monto || "",
        pago2.metodo || "",
        pago2.monto || "",
        JSON.stringify(adicionales),
        Math.max(0, precioFinal - adicionales.reduce((acc, item) => acc + Number(item.precio || 0), 0)),
        "",
        ""
      ]);
      actualizarIndiceIngreso(ss, {
        precio: precioFinal,
        fecha: fechaFin,
        trabajador: data[i][4],
        servicio: data[i][2]
      }, 1);

      const workers = trabajadores.getDataRange().getValues();
      for (let w = 1; w < workers.length; w++) {
        if (normalizarNombreTrabajador(workers[w][1]) === normalizarNombreTrabajador(data[i][4])) {
          if (!trabajadorTieneOtroLavadoActivo(data[i][4], data, id)) {
            trabajadores.getRange(w + 1, 3).setValue("libre");
          }
          break;
        }
      }

      activos.deleteRow(i + 1);
      return output({ ok: true, tiempo, estado_pago: estadoPago, metodo_pago: pagosInfo.metodo, pagos: pagosInfo.pagos });
    }
  }

  return output({ error: "Lavado no encontrado" });
}

function registrarServicioRealizadoManual(e) {
  const rol = normalizarRol(e.auth && e.auth.rol);
  if (rol !== "admin" && rol !== "jefe") {
    return output({ error: "No tienes permisos para registrar servicios manuales" });
  }

  const placa = normalizarPlaca(e.parameter.placa);
  const servicio = String(e.parameter.servicio || "").trim();
  const trabajador = String(e.parameter.trabajador || "").trim();
  const precio = Number(e.parameter.precio || 0);
  const fechaParam = Number(e.parameter.fecha_fin || Date.now());
  const fechaFin = new Date(fechaParam);
  const nota = String(e.parameter.nota || "").trim();
  const estadoPago = String(e.parameter.estado_pago || "").toLowerCase() === "pendiente" ? "pendiente" : "pagado";

  if (!placa || !servicio || !trabajador || precio <= 0 || isNaN(fechaFin.getTime())) {
    return output({ error: "Datos incompletos para registrar el servicio manual" });
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const trabajadores = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS, ss);
  const workers = trabajadores.getDataRange().getValues();
  let trabajadorValido = false;

  for (let i = 1; i < workers.length; i++) {
    const mismoNombre = normalizarNombreTrabajador(workers[i][1]) === normalizarNombreTrabajador(trabajador);
    const esOperario = !normalizarRol(workers[i][7]);
    const activo = String(workers[i][8] || "activo").toLowerCase() !== "inactivo";
    if (mismoNombre && esOperario && activo) {
      trabajadorValido = true;
      break;
    }
  }

  if (!trabajadorValido) return output({ error: "Trabajador no valido para liquidacion" });

  const pagosInfo = getPagosDesdeParametros(e, precio, estadoPago);
  if (pagosInfo.error) return output({ error: pagosInfo.error });

  const id = Date.now();
  const pago1 = pagosInfo.pagos[0] || {};
  const pago2 = pagosInfo.pagos[1] || {};

  getOrCreateSheet("Lavados_Completados", COMPLETADOS_HEADERS, ss).appendRow([
    id,
    placa,
    servicio,
    precio,
    trabajador,
    fechaFin,
    `manual-${id}`,
    "Registro manual",
    estadoPago === "pendiente" ? "" : pagosInfo.metodo,
    estadoPago,
    estadoPago === "pendiente" ? "" : fechaFin,
    pago1.metodo || "",
    pago1.monto || "",
    pago2.metodo || "",
    pago2.monto || "",
    "[]",
    precio,
    "manual",
    nota
  ]);
  actualizarIndiceIngreso(ss, { precio, fecha: fechaFin, trabajador, servicio }, 1);

  return output({ ok: true, id, estado_pago: estadoPago, metodo_pago: pagosInfo.metodo, pagos: pagosInfo.pagos });
}

function eliminarFilasPorLavado(hoja, columnaLavado, lavadoId) {
  if (!hoja || hoja.getLastRow() < 2) return;
  const data = hoja.getDataRange().getValues();
  const filas = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][columnaLavado - 1]) === String(lavadoId)) filas.push(i + 1);
  }

  eliminarFilasPorIndices(hoja, filas);
}

function eliminarLavadoActivo(e) {
  const id = e.parameter.id;
  if (!id) return output({ error: "ID requerido" });

  const lock = tomarCandadoOperacion();
  if (!lock) return output({ error: "Sistema ocupado, intenta de nuevo" });

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const activos = ss.getSheetByName("Lavados_Activos");
    const completados = getOrCreateSheet("Lavados_Completados", COMPLETADOS_HEADERS, ss);
    const trabajadores = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS, ss);
    const data = activos.getDataRange().getValues();
    const pagoCancelacion = Number(e.parameter.pago_cancelacion || 0);
    const motivoCancelacion = String(e.parameter.motivo_cancelacion || "").trim();

    if (pagoCancelacion < 0) return output({ error: "El pago de cancelacion no puede ser negativo" });
    if (pagoCancelacion > 0 && !motivoCancelacion) {
      return output({ error: "El motivo de cancelacion es obligatorio cuando hay pago" });
    }

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) {
        const trabajador = data[i][4];
        const fechaFin = new Date();
        const fechaInicio = data[i][5] instanceof Date ? data[i][5] : new Date(data[i][5]);
        const tiempo = formatearDuracion(fechaFin.getTime() - fechaInicio.getTime());

        if (pagoCancelacion > 0) {
          const pagosInfo = getPagosDesdeParametros(e, pagoCancelacion, "pagado");
          if (pagosInfo.error) return output({ error: pagosInfo.error });
          const pago1 = pagosInfo.pagos[0] || {};
          const pago2 = pagosInfo.pagos[1] || {};

          completados.appendRow([
            data[i][0],
            data[i][1],
            data[i][2],
            pagoCancelacion,
            trabajador,
            fechaFin,
            data[i][0],
            tiempo,
            pagosInfo.metodo,
            "pagado",
            fechaFin,
            pago1.metodo || "",
            pago1.monto || "",
            pago2.metodo || "",
            pago2.monto || "",
            "[]",
            pagoCancelacion,
            "cancelado",
            motivoCancelacion
          ]);
          actualizarIndiceIngreso(ss, {
            precio: pagoCancelacion,
            fecha: fechaFin,
            trabajador,
            servicio: data[i][2]
          }, 1);
        }

        const workers = trabajadores.getDataRange().getValues();

        for (let w = 1; w < workers.length; w++) {
          if (normalizarNombreTrabajador(workers[w][1]) === normalizarNombreTrabajador(trabajador)) {
            if (!trabajadorTieneOtroLavadoActivo(trabajador, data, id)) {
              trabajadores.getRange(w + 1, 3).setValue("libre");
            }
            break;
          }
        }

        eliminarFilasPorLavado(ss.getSheetByName("Lavado_Adicionales"), 2, id);
        eliminarFilasPorLavado(ss.getSheetByName("gasto_materiales"), 2, id);
        activos.deleteRow(i + 1);
        return output({ ok: true, registro_cancelado: pagoCancelacion > 0 });
      }
    }

    return output({ error: "Lavado no encontrado" });
  } finally {
    lock.releaseLock();
  }
}

function getIngresos() {
  const sheet = getOrCreateSheet("Lavados_Completados", COMPLETADOS_HEADERS);
  const lastRow = sheet.getLastRow();
  const data = lastRow
    ? sheet.getRange(1, 1, lastRow, COMPLETADOS_HEADERS.length).getValues()
    : [];

  const detalle = [];
  for (let i = 1; i < data.length; i++) {
    const precio = Number(data[i][3]) || 0;
    const fecha = data[i][5] instanceof Date ? data[i][5].getTime() : new Date(data[i][5]).getTime();
    const estadoPago = data[i][9] || "pagado";
    if (!precio || isNaN(fecha)) continue;
    const pagos = [];
    if (estadoPago !== "pendiente") {
      if (data[i][11] && Number(data[i][12] || 0) > 0) {
        pagos.push({ metodo: data[i][11], monto: Number(data[i][12]) || 0 });
      }
      if (data[i][13] && Number(data[i][14] || 0) > 0) {
        pagos.push({ metodo: data[i][13], monto: Number(data[i][14]) || 0 });
      }
      if (!pagos.length && data[i][8]) {
        pagos.push({ metodo: data[i][8], monto: precio });
      }
    }

    let adicionales = [];
    try {
      adicionales = data[i][15] ? JSON.parse(data[i][15]) : [];
    } catch (error) {
      adicionales = [];
    }

    detalle.push({
      id: data[i][0],
      placa: data[i][1],
      servicio: data[i][2],
      precio,
      trabajador: data[i][4],
      fecha,
      tiempo: data[i][7] || "",
      metodo_pago: estadoPago === "pendiente" ? "pendiente" : (data[i][8] || "sin_registrar"),
      pagos,
      adicionales,
      precio_base: Number(data[i][16]) || Math.max(0, precio - adicionales.reduce((acc, item) => acc + Number(item.precio || 0), 0)),
      tipo_registro: data[i][17] || "",
      nota: data[i][18] || "",
      estado_pago: estadoPago,
      fecha_pago: data[i][10] instanceof Date ? data[i][10].getTime() : (data[i][10] ? new Date(data[i][10]).getTime() : fecha)
    });
  }

  return output({
    totalServicios: detalle.length,
    totalIngresos: detalle.reduce((a, b) => a + b.precio, 0),
    detalle
  });
}

function getHistorialPlaca(e) {
  const placa = normalizarPlaca(e.parameter.placa);
  if (!placa) return output({ error: "Placa requerida" });

  const data = getOrCreateSheet("Lavados_Completados", COMPLETADOS_HEADERS).getDataRange().getValues();

  const detalle = [];
  for (let i = 1; i < data.length; i++) {
    if (normalizarPlaca(data[i][1]) !== placa) continue;
    if ((data[i][9] || "pagado") === "pendiente") continue;

    const fecha = data[i][5] instanceof Date ? data[i][5].getTime() : new Date(data[i][5]).getTime();
    const pagos = [];
    if (data[i][11] && Number(data[i][12] || 0) > 0) pagos.push({ metodo: data[i][11], monto: Number(data[i][12]) || 0 });
    if (data[i][13] && Number(data[i][14] || 0) > 0) pagos.push({ metodo: data[i][13], monto: Number(data[i][14]) || 0 });
    detalle.push({
      id: data[i][0],
      placa: data[i][1],
      servicio: data[i][2],
      precio: Number(data[i][3]) || 0,
      trabajador: data[i][4],
      fecha: isNaN(fecha) ? null : fecha,
      tiempo: data[i][7] || "",
      metodo_pago: data[i][8] || "sin_registrar",
      pagos
    });
  }

  detalle.sort((a, b) => Number(b.fecha || 0) - Number(a.fecha || 0));
  return output({
    placa,
    totalVisitas: detalle.length,
    detalle
  });
}

function getPendientesPago() {
  const data = getOrCreateSheet("Lavados_Completados", COMPLETADOS_HEADERS).getDataRange().getValues();
  const pendientes = [];

  for (let i = 1; i < data.length; i++) {
    const estadoPago = data[i][9] || "pagado";
    if (estadoPago !== "pendiente") continue;

    const fecha = data[i][5] instanceof Date ? data[i][5].getTime() : new Date(data[i][5]).getTime();
    pendientes.push({
      id: data[i][0],
      placa: data[i][1],
      servicio: data[i][2],
      precio: Number(data[i][3]) || 0,
      trabajador: data[i][4],
      fecha: isNaN(fecha) ? null : fecha,
      tiempo: data[i][7] || "",
      estado_pago: estadoPago
    });
  }

  pendientes.sort((a, b) => Number(b.fecha || 0) - Number(a.fecha || 0));
  return output(pendientes);
}

function reasignarTrabajador(e) {
  const lavadoId = e.parameter.id;
  const nuevoTrabajador = e.parameter.trabajador;
  if (!lavadoId || !nuevoTrabajador) return output({ error: "Datos incompletos" });

  const lock = tomarCandadoOperacion();
  if (!lock) return output({ error: "Sistema ocupado, intenta de nuevo" });

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const activos = ss.getSheetByName("Lavados_Activos");
    const trabajadores = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS, ss);
    const activosData = activos.getDataRange().getValues();
    const workers = trabajadores.getDataRange().getValues();
    let activoRow = null;
    let trabajadorActual = "";
    let nuevoRow = null;

    for (let i = 1; i < activosData.length; i++) {
      if (String(activosData[i][0]) === String(lavadoId)) {
        activoRow = i + 1;
        trabajadorActual = activosData[i][4];
        break;
      }
    }

    if (!activoRow) return output({ error: "Lavado no encontrado" });

    const disponible = buscarOperarioDisponible(workers, activosData, nuevoTrabajador);
    if (disponible) nuevoRow = disponible.row;

    if (!nuevoRow) return output({ error: "Solo se pueden reasignar operarios libres" });

    for (let i = 1; i < workers.length; i++) {
      if (workers[i][1] === trabajadorActual) {
        if (!trabajadorTieneOtroLavadoActivo(trabajadorActual, activosData, lavadoId)) {
          trabajadores.getRange(i + 1, 3).setValue("libre");
        }
        break;
      }
    }

    trabajadores.getRange(nuevoRow, 3).setValue("ocupado");
    activos.getRange(activoRow, 5).setValue(nuevoTrabajador);
    return output({ ok: true, trabajador: nuevoTrabajador });
  } finally {
    lock.releaseLock();
  }
}

function agregarAdicionalLavado(e) {
  const lavadoId = e.parameter.id;
  const nombre = String(e.parameter.nombre || "").trim();
  const precio = Number(e.parameter.precio || 0);
  if (!lavadoId || !nombre || precio <= 0) return output({ error: "Datos incompletos" });

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const activos = ss.getSheetByName("Lavados_Activos");
  const data = activos.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(lavadoId)) {
      const precioActual = Number(data[i][3]) || 0;
      activos.getRange(i + 1, 4).setValue(precioActual + precio);
      getOrCreateSheet("Lavado_Adicionales", ADICIONALES_HEADERS, ss)
        .appendRow([Date.now(), lavadoId, nombre, precio, new Date(), "activo"]);
      return output({ ok: true, precio: precioActual + precio, adicional: { nombre, precio } });
    }
  }

  return output({ error: "Lavado no encontrado" });
}

function marcarPagoEfectuado(e) {
  const id = e.parameter.id;
  if (!id) return output({ error: "ID requerido" });

  const lock = tomarCandadoOperacion();
  if (!lock) return output({ error: "Sistema ocupado, intenta de nuevo" });

  try {
    const sh = getOrCreateSheet("Lavados_Completados", COMPLETADOS_HEADERS);
    const data = sh.getDataRange().getValues();
    const fechaPago = new Date();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== String(id)) continue;
      const precio = Number(data[i][3]) || 0;
      const pagosInfo = getPagosDesdeParametros(e, precio, "pagado");
      if (pagosInfo.error) return output({ error: pagosInfo.error });
      const pago1 = pagosInfo.pagos[0] || {};
      const pago2 = pagosInfo.pagos[1] || {};
      sh.getRange(i + 1, 9, 1, 7).setValues([[
        pagosInfo.metodo,
        "pagado",
        fechaPago,
        pago1.metodo || "",
        pago1.monto || "",
        pago2.metodo || "",
        pago2.monto || ""
      ]]);
      return output({ ok: true, metodo_pago: pagosInfo.metodo, pagos: pagosInfo.pagos, fecha_pago: fechaPago.getTime() });
    }

    return output({ error: "Servicio pendiente no encontrado" });
  } finally {
    lock.releaseLock();
  }
}

function eliminarServicioRealizado(e) {
  const id = e.parameter.id;
  if (!id) return output({ error: "ID requerido" });

  const rol = normalizarRol(e.auth && e.auth.rol);
  if (rol !== "admin" && rol !== "jefe") {
    return output({ error: "No tienes permisos para eliminar servicios realizados" });
  }

  const lock = tomarCandadoOperacion();
  if (!lock) return output({ error: "Sistema ocupado, intenta de nuevo" });

  try {
    const sh = getOrCreateSheet("Lavados_Completados", COMPLETADOS_HEADERS);
    const data = sh.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) {
        const eliminado = {
          id: data[i][0],
          placa: data[i][1],
          servicio: data[i][2],
          precio: Number(data[i][3]) || 0,
          trabajador: data[i][4],
          fecha: data[i][5] instanceof Date ? data[i][5].getTime() : new Date(data[i][5]).getTime()
        };

        actualizarIndiceIngreso(SpreadsheetApp.openById(SPREADSHEET_ID), eliminado, -1);
        sh.deleteRow(i + 1);
        return output({ ok: true, eliminado });
      }
    }

    return output({ error: "Servicio realizado no encontrado" });
  } finally {
    lock.releaseLock();
  }
}

function getTrabajadores() {
  const data = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS).getDataRange().getValues();

  const trabajadores = [];
  for (let i = 1; i < data.length; i++) {
    trabajadores.push({
      id: data[i][0],
      nombre: data[i][1],
      estado: data[i][2],
      liquidacion: 0,
      fecha_liquidacion: "",
      correo: data[i][5] || "",
      tienePassword: !!data[i][6],
      rol: data[i][7] || "",
      activo: data[i][8] || "",
      creado: data[i][9] || "",
      ultimo_login: data[i][10] || ""
    });
  }
  return output(trabajadores);
}

function editarTrabajador(e) {
  const id = e.parameter.id;
  const nuevoNombre = e.parameter.nombre;
  const nuevoCorreo = normalizarCorreo(e.parameter.correo);
  const estado = e.parameter.estado;
  const rol = normalizarRol(e.parameter.rol);
  const activo = e.parameter.activo;
  const password = e.parameter.password || "";
  const actorRol = normalizarRol(e.auth && e.auth.rol);
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const trabajadoresSheet = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS, ss);
  const activosSheet = ss.getSheetByName("Lavados_Activos");
  const completadosSheet = ss.getSheetByName("Lavados_Completados");
  const data = trabajadoresSheet.getDataRange().getValues();
  let nombreAntiguo = null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      nombreAntiguo = data[i][1];
      const rolActual = normalizarRol(data[i][7]);
      const activoActual = String(data[i][8] || "activo").toLowerCase();
      const actorCorreo = normalizarCorreo(e.auth && e.auth.correo);
      const correoActual = normalizarCorreo(data[i][5]);

      if (actorRol !== "jefe") {
        if (actorRol === "admin" && actorCorreo && actorCorreo === correoActual && password) {
          trabajadoresSheet.getRange(i + 1, 7).setValue(hashPassword(password));
          return output({ ok: true, passwordUpdated: true });
        }

        return output({ error: "Solo el jefe puede modificar usuarios. Los administradores solo pueden cambiar su propia contrasena" });
      }

      const cambiaAcceso =
        rolActual !== rol ||
        (rolActual && activo && String(activo).toLowerCase() !== activoActual) ||
        (rolActual && password);

      if ((rolActual === "admin" || rolActual === "jefe" || rol === "admin" || rol === "jefe") && cambiaAcceso && actorRol !== "jefe") {
        return output({ error: "Solo el jefe puede modificar accesos administrativos" });
      }

      const siguienteTrabajador = data[i].slice(0, TRABAJADORES_HEADERS.length);
      if (nuevoNombre) siguienteTrabajador[1] = nuevoNombre;
      if (estado) siguienteTrabajador[2] = estado;
      if (nuevoCorreo !== undefined) siguienteTrabajador[5] = nuevoCorreo;
      siguienteTrabajador[7] = rol;
      siguienteTrabajador[8] = rol ? (activo || "activo") : "";
      if (password) siguienteTrabajador[6] = hashPassword(password);
      trabajadoresSheet.getRange(i + 1, 1, 1, TRABAJADORES_HEADERS.length).setValues([siguienteTrabajador]);
      break;
    }
  }

  if (!nombreAntiguo) return output({ error: "Trabajador no encontrado" });

  if (nuevoNombre && nombreAntiguo !== nuevoNombre) {
    function actualizarHoja(hoja) {
      const lastRow = hoja.getLastRow();
      if (lastRow < 2) return;
      const nombres = hoja.getRange(2, 5, lastRow - 1, 1).getValues();
      const ranges = [];
      for (let i = 0; i < nombres.length; i++) {
        if (nombres[i][0] === nombreAntiguo) ranges.push(`E${i + 2}`);
      }
      if (ranges.length) hoja.getRangeList(ranges).setValue(nuevoNombre);
    }
    actualizarHoja(activosSheet);
    actualizarHoja(completadosSheet);
  }

  return output({ ok: true });
}

function eliminarTrabajador(e) {
  if (normalizarRol(e.auth && e.auth.rol) !== "jefe") {
    return output({ error: "Solo el jefe puede eliminar usuarios" });
  }

  const id = e.parameter.id;
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Trabajadores");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return output({ ok: true });
    }
  }
  return output({ error: "Trabajador no encontrado" });
}

function editarServicio(e) {
  const id = e.parameter.id;
  const nombre = e.parameter.nombre;
  const precio = e.parameter.precio;
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Servicios");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[
        nombre || data[i][1],
        precio ? Number(precio) : data[i][2]
      ]]);
      return output({ ok: true });
    }
  }
  return output({ error: "Servicio no encontrado" });
}

function eliminarServicio(e) {
  const id = e.parameter.id;
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Servicios");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return output({ ok: true });
    }
  }
  return output({ error: "Servicio no encontrado" });
}

function agendarRecogida(e) {
  const nombre = e.parameter.nombre;
  const telefono = e.parameter.telefono;
  const placa = e.parameter.placa;
  const fecha = e.parameter.fecha;
  const hora = e.parameter.hora;
  if (!nombre || !telefono || !placa || !fecha || !hora) return output({ error: "Datos incompletos" });

  SpreadsheetApp.openById(SPREADSHEET_ID)
    .getSheetByName("Recogidas_Programadas")
    .appendRow([Date.now(), nombre, telefono, normalizarPlaca(placa), fecha, hora, "pendiente"]);

  return output({ ok: true });
}

function getRecogidasProgramadas() {
  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Recogidas_Programadas");
  const rows = sh.getDataRange().getValues();
  rows.shift();
  const dias = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  const data = rows
    .filter(r => r[6] === "pendiente")
    .map(r => {
      let fechaBonita = "";
      if (r[4]) {
        const d = new Date(r[4]);
        fechaBonita = `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
      }

      let horaBonita = "";
      if (r[5]) {
        const d = r[5] instanceof Date ? r[5] : new Date(`1970-01-01T${r[5]}`);
        let h = d.getHours();
        const m = d.getMinutes();
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        horaBonita = `${h}:${String(m).padStart(2, "0")} ${ampm}`;
      }

      return { id: r[0], nombre: r[1], telefono: r[2], placa: r[3], fecha: fechaBonita, hora: horaBonita, estado: r[6] };
    });

  return output(data);
}

function iniciarRecogida(e) {
  const id = String(e.parameter.id);
  const servicio = e.parameter.servicio;
  if (!id || !servicio) return output({ error: "Datos incompletos" });

  const lock = tomarCandadoOperacion();
  if (!lock) return output({ error: "Sistema ocupado, intenta de nuevo" });

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const recogidas = ss.getSheetByName("Recogidas_Programadas");
    const activos = ss.getSheetByName("Lavados_Activos");
    const serviciosSh = ss.getSheetByName("Servicios");
    const trabajadoresSh = ss.getSheetByName("Trabajadores");
    const data = recogidas.getDataRange().getValues();
    let recogida = null;
    let rowIndex = null;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        recogida = data[i];
        rowIndex = i + 1;
        break;
      }
    }
    if (!recogida) return output({ error: "Recogida no encontrada" });
    if (recogida[6] !== "pendiente") return output({ error: "La recogida ya fue procesada" });

    const trabajadores = trabajadoresSh.getDataRange().getValues();
    const disponible = buscarOperarioDisponible(trabajadores, activos.getDataRange().getValues(), null);
    if (!disponible) return output({ error: "No hay operarios disponibles" });
    const trabajador = disponible.nombre;
    const trabajadorRow = disponible.row;

    const servicios = serviciosSh.getDataRange().getValues();
    let precio = 0;
    for (let i = 1; i < servicios.length; i++) {
      if (servicios[i][1] === servicio) {
        precio = servicios[i][2];
        break;
      }
    }

    activos.appendRow([Date.now(), recogida[3], servicio, precio, trabajador, new Date()]);
    trabajadoresSh.getRange(trabajadorRow, 3).setValue("ocupado");
    recogidas.getRange(rowIndex, 7).setValue("activo");
    return output({ ok: true, trabajador, servicio, precio });
  } finally {
    lock.releaseLock();
  }
}

function liquidarTrabajador(e) {
  const nombre = e.parameter.trabajador;
  const valor = Number(e.parameter.valor);
  if (!nombre || !valor) return output({ error: "Datos incompletos" });

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const trabajadoresSheet = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS, ss);
  const pagosSheet = getOrCreateSheet("Pagos", PAGOS_HEADERS, ss);
  const data = trabajadoresSheet.getDataRange().getValues();
  const hoy = new Date();

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === nombre) {
      const id = Date.now();
      pagosSheet.appendRow([id, nombre, valor, hoy, "liquidarTrabajador"]);
      return output({
        ok: true,
        liquidacion: {
          id,
          trabajadorId: data[i][0],
          trabajador: nombre,
          valor,
          fecha: hoy.getTime(),
          tipo: "liquidarTrabajador"
        }
      });
    }
  }
  return output({ error: "Trabajador no encontrado" });
}

function getLiquidaciones() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const trabajadoresSheet = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS, ss);
  const pagosSheet = getOrCreateSheet("Pagos", PAGOS_HEADERS, ss);
  const excluidasSheet = getOrCreateSheet("Liquidaciones_Excluidas", LIQUIDACIONES_EXCLUIDAS_HEADERS, ss);
  const trabajadores = trabajadoresSheet.getDataRange().getValues();
  const pagos = pagosSheet.getDataRange().getValues();
  const excluidos = excluidasSheet.getDataRange().getValues().slice(1)
    .map(row => String(row[0]))
    .filter(Boolean);
  const trabajadoresPorNombre = {};

  for (let i = 1; i < trabajadores.length; i++) {
    trabajadoresPorNombre[String(trabajadores[i][1] || "").trim()] = {
      id: trabajadores[i][0],
      nombre: trabajadores[i][1]
    };
  }

  const detalle = [];
  const resumen = {};

  for (let i = 1; i < pagos.length; i++) {
    const tipo = pagos[i][4] || "";
    if (tipo !== "liquidarTrabajador") continue;

    const trabajador = String(pagos[i][1] || "").trim();
    const valor = Number(pagos[i][2]) || 0;
    const fechaObj = pagos[i][3] instanceof Date ? pagos[i][3] : new Date(pagos[i][3]);
    const fecha = fechaObj && !isNaN(fechaObj.getTime()) ? fechaObj.getTime() : null;
    if (!trabajador || !valor || !fecha) continue;

    const trabajadorInfo = trabajadoresPorNombre[trabajador] || { id: trabajador, nombre: trabajador };
    const registro = {
      id: pagos[i][0],
      trabajadorId: trabajadorInfo.id,
      trabajador,
      valor,
      fecha,
      tipo
    };

    detalle.push(registro);

    const key = String(trabajadorInfo.id);
    if (!resumen[key] || Number(resumen[key].fecha || 0) < fecha) {
      resumen[key] = {
        valor,
        fecha,
        trabajador,
        tipo
      };
    }
  }

  detalle.sort((a, b) => Number(b.fecha || 0) - Number(a.fecha || 0));
  return output({ detalle, resumen, excluidos });
}

function eliminarLiquidacion(e) {
  const trabajadorId = String(e.parameter.trabajador_id || "");
  if (!trabajadorId) return output({ error: "Trabajador requerido" });

  const rol = normalizarRol(e.auth && e.auth.rol);
  if (rol !== "admin" && rol !== "jefe") {
    return output({ error: "No tienes permisos para eliminar liquidaciones" });
  }

  const lock = tomarCandadoOperacion();
  if (!lock) return output({ error: "Sistema ocupado, intenta de nuevo" });

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const trabajadoresSheet = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS, ss);
    const excluidasSheet = getOrCreateSheet("Liquidaciones_Excluidas", LIQUIDACIONES_EXCLUIDAS_HEADERS, ss);
    const trabajadores = trabajadoresSheet.getDataRange().getValues();
    const trabajador = trabajadores.slice(1).find(row => String(row[0]) === trabajadorId);
    if (!trabajador) return output({ error: "Trabajador no encontrado" });

    const excluidas = excluidasSheet.getDataRange().getValues();
    const yaExcluida = excluidas.slice(1).some(row => String(row[0]) === trabajadorId);
    if (!yaExcluida) {
      excluidasSheet.appendRow([
        trabajadorId,
        trabajador[1],
        new Date(),
        normalizarCorreo(e.auth && e.auth.correo)
      ]);
    }

    return output({ ok: true, trabajador_id: trabajadorId });
  } finally {
    lock.releaseLock();
  }
}

function hashPassword(pwd) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pwd)
  );
}

function verificarCorreo(e) {
  const correo = normalizarCorreo(e.parameter.correo);
  const data = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normalizarCorreo(data[i][5]) === correo) {
      return output({ existe: true, nombre: data[i][1], tienePassword: !!data[i][6], rol: data[i][7] || "" });
    }
  }
  return output({ existe: false });
}

function crearPassword(e) {
  const correo = normalizarCorreo(e.parameter.correo);
  const password = e.parameter.password;
  if (!correo || !password) return output({ error: "Datos incompletos" });
  const sh = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS);
  const data = sh.getDataRange().getValues();
  const hash = hashPassword(password);
  for (let i = 1; i < data.length; i++) {
    if (normalizarCorreo(data[i][5]) === correo) {
      sh.getRange(i + 1, 7).setValue(hash);
      return output({ ok: true, nombre: data[i][1] });
    }
  }
  return output({ error: "Correo no encontrado" });
}

function login(e) {
  const correo = normalizarCorreo(e.parameter.correo);
  const password = e.parameter.password;
  if (!correo || !password) return output({ error: "Datos incompletos" });
  const hash = hashPassword(password);
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const trabajadores = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS, ss);
  const data = trabajadores.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const rol = normalizarRol(data[i][7]);
    const activo = String(data[i][8] || "activo").toLowerCase();
    if (normalizarCorreo(data[i][5]) === correo && data[i][6] === hash && rol && activo !== "inactivo") {
      eliminarSesionesPorCorreo(correo, ss);

      const token = crearTokenSesion();
      const expira = getNextMidnight();
      getOrCreateSheet("Sesiones", SESIONES_HEADERS, ss).appendRow([
        token,
        correo,
        data[i][1],
        rol,
        new Date(),
        expira,
        true
      ]);
      trabajadores.getRange(i + 1, 11).setValue(new Date());
      return output({
        ok: true,
        nombre: data[i][1],
        correo,
        rol,
        token,
        expiresAt: expira.getTime()
      });
    }
  }
  return output({ error: "Credenciales incorrectas" });
}

function validarSesion(e) {
  const auth = validarSesionInternaOptimizada(e.parameter.sessionToken);
  if (!auth.ok) return output({ ok: false, error: auth.error || "Sesion expirada" });
  return output({ ok: true, user: auth.user });
}

function logout(e) {
  const token = e.parameter.sessionToken;
  if (!token) return output({ ok: true });

  eliminarSesionPorToken(token);
  return output({ ok: true });
}

function setupJefeInicial(e) {
  const nombre = e.parameter.nombre;
  const correo = normalizarCorreo(e.parameter.correo);
  const password = e.parameter.password;
  if (!nombre || !correo || !password) return output({ error: "Datos incompletos" });

  if (existeJefe()) return output({ error: "Ya existe un jefe registrado" });

  const sh = getOrCreateSheet("Trabajadores", TRABAJADORES_HEADERS);
  sh.appendRow([
    Date.now(),
    nombre,
    "libre",
    "",
    "",
    correo,
    hashPassword(password),
    "jefe",
    "activo",
    new Date(),
    ""
  ]);
  return output({ ok: true });
}

function getPagosTrabajador(e) {
  const nombre = e.parameter.nombre;
  const fecha = new Date(Number(e.parameter.fecha));
  const data = getOrCreateSheet("Pagos", PAGOS_HEADERS).getDataRange().getValues();
  let totalDia = 0;
  let totalGeneral = 0;

  data.slice(1).forEach(r => {
    if (r[1] === nombre) {
      totalGeneral += Number(r[2]);
      const f = new Date(r[3]);
      if (f.toDateString() === fecha.toDateString()) totalDia += Number(r[2]);
    }
  });

  return output({ totalDia, totalGeneral });
}

function agregarGastoMaterial(e) {
  const lavadoId = e.parameter.lavado_id;
  const material = e.parameter.material;
  const cantidad = Number(e.parameter.cantidad || 0);
  const costo = Number(e.parameter.costo || 0);
  if (!lavadoId || !material) return output({ error: "Datos incompletos" });

  SpreadsheetApp.openById(SPREADSHEET_ID)
    .getSheetByName("gasto_materiales")
    .appendRow([Date.now(), lavadoId, material, cantidad, costo, new Date()]);

  return output({ ok: true });
}

function getGastosPorLavado(e) {
  const lavadoId = e.parameter.lavado_id;
  if (!lavadoId) return output({ error: "ID requerido" });

  const data = SpreadsheetApp.openById(SPREADSHEET_ID)
    .getSheetByName("gasto_materiales")
    .getDataRange()
    .getValues();

  const gastos = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(lavadoId)) {
      gastos.push({ material: data[i][2], cantidad: data[i][3], costo: data[i][4], fecha: data[i][5] });
    }
  }
  return output(gastos);
}
function getBootstrapData() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const serviciosRows = getBootstrapRows(spreadsheet, "Servicios");
  const trabajadoresRows = getBootstrapRows(spreadsheet, "Trabajadores", TRABAJADORES_HEADERS);
  const activosRows = getBootstrapRows(spreadsheet, "Lavados_Activos");
  const liquidacionesExcluidasRows = getBootstrapRows(spreadsheet, "Liquidaciones_Excluidas", LIQUIDACIONES_EXCLUIDAS_HEADERS);
  const recogidasRows = getBootstrapRows(spreadsheet, "Recogidas_Programadas");
  const adicionalesRows = getBootstrapRows(spreadsheet, "Lavado_Adicionales", ADICIONALES_HEADERS);
  const gastosRows = getBootstrapRows(spreadsheet, "gasto_materiales");
  const completadosRecientes = getBootstrapRowsLimit(spreadsheet, "Lavados_Completados", COMPLETADOS_HEADERS, BOOTSTRAP_INGRESOS_LIMIT);
  const resumenIngresos = getResumenIndiceIngresos(spreadsheet);

  const adicionalesPorLavado = agruparAdicionalesBootstrap(adicionalesRows);
  const gastosPorLavado = agruparGastosBootstrap(gastosRows);
  const trabajadores = mapearTrabajadoresBootstrap(trabajadoresRows);
  const ingresos = construirIngresosBootstrap(completadosRecientes);
  ingresos.resumen = resumenIngresos;

  return output({
    ok: true,
    servicios: mapearServiciosBootstrap(serviciosRows),
    trabajadores,
    activos: mapearActivosBootstrap(activosRows, adicionalesPorLavado, gastosPorLavado),
    ingresos,
    liquidaciones: { detalle: [], resumen: {}, excluidos: liquidacionesExcluidasRows.slice(1).map(row => String(row[0])).filter(Boolean) },
    recogidas: mapearRecogidasBootstrap(recogidasRows),
    pendientesPago: []
  });
}

function getLavadosActivosOptimizado() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const activosRows = getBootstrapRows(spreadsheet, "Lavados_Activos");
  const adicionalesRows = getBootstrapRows(spreadsheet, "Lavado_Adicionales", ADICIONALES_HEADERS);
  const gastosRows = getBootstrapRows(spreadsheet, "gasto_materiales");

  return output(mapearActivosBootstrap(
    activosRows,
    agruparAdicionalesBootstrap(adicionalesRows),
    agruparGastosBootstrap(gastosRows)
  ));
}

function validarSesionInternaOptimizada(token) {
  if (!token) return { ok: false, error: "Debes iniciar sesion" };

  const sheet = getOrCreateSheet("Sesiones", SESIONES_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const now = Date.now();

  for (let index = 1; index < rows.length; index++) {
    if (String(rows[index][0]) !== String(token)) continue;

    const expira = bootstrapTimestamp(rows[index][5]);
    const activo = rows[index][6] === true || ["true", "activo"].indexOf(String(rows[index][6]).toLowerCase()) !== -1;
    if (!activo || !expira || expira <= now) {
      sheet.deleteRow(index + 1);
      return { ok: false, error: "Sesion expirada" };
    }

    return {
      ok: true,
      user: {
        correo: rows[index][1],
        nombre: rows[index][2],
        rol: rows[index][3],
        expira
      }
    };
  }

  return { ok: false, error: "Sesion no valida" };
}

function getBootstrapRows(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet && headers) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  if (!sheet || sheet.getLastRow() === 0) return [];
  return sheet.getDataRange().getValues();
}

function getBootstrapRowsLimit(spreadsheet, name, headers, limit) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet && headers) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  if (!sheet || sheet.getLastRow() === 0) return [];

  const lastRow = sheet.getLastRow();
  const firstDataRow = Math.max(2, lastRow - Math.max(1, Number(limit) || 1) + 1);
  const width = Math.max(sheet.getLastColumn(), headers ? headers.length : 1);
  const rows = lastRow < 2 ? [] : sheet.getRange(firstDataRow, 1, lastRow - firstDataRow + 1, width).getValues();
  const header = sheet.getRange(1, 1, 1, width).getValues()[0];
  return [header].concat(rows);
}

function getClaveIndiceIngreso(tipo, clave) {
  return `${tipo}:${String(clave || "")}`;
}

function getResumenIndiceIngresos(spreadsheet) {
  if (PropertiesService.getScriptProperties().getProperty("INDICE_INGRESOS_LISTO") !== "true") {
    return { listo: false };
  }
  const sheet = getOrCreateSheet("Indice_Ingresos", INDICE_INGRESOS_HEADERS, spreadsheet);
  if (sheet.getLastRow() < 2) return { listo: false };

  const metrics = {};
  sheet.getDataRange().getValues().slice(1).forEach(row => {
    metrics[getClaveIndiceIngreso(row[0], row[1])] = {
      total: Number(row[2]) || 0,
      cantidad: Number(row[3]) || 0
    };
  });

  const now = new Date();
  const dayKey = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const monthKey = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM");
  return {
    listo: true,
    hoy: metrics[getClaveIndiceIngreso("dia", dayKey)] || { total: 0, cantidad: 0 },
    mes: metrics[getClaveIndiceIngreso("mes", monthKey)] || { total: 0, cantidad: 0 }
  };
}

function reconstruirIndiceIngresos() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const completados = spreadsheet.getSheetByName("Lavados_Completados");
  const indice = getOrCreateSheet("Indice_Ingresos", INDICE_INGRESOS_HEADERS, spreadsheet);
  PropertiesService.getScriptProperties().setProperty("INDICE_INGRESOS_LISTO", "false");
  if (!completados || completados.getLastRow() < 2) {
    indice.clearContents();
    indice.getRange(1, 1, 1, INDICE_INGRESOS_HEADERS.length).setValues([INDICE_INGRESOS_HEADERS]);
    PropertiesService.getScriptProperties().setProperty("INDICE_INGRESOS_LISTO", "true");
    return { ok: true, registros: 0 };
  }

  const lastRow = completados.getLastRow();
  const rows = completados.getRange(2, 1, lastRow - 1, 6).getValues();
  const metrics = {};
  rows.forEach(row => {
    const precio = Number(row[3]) || 0;
    const fecha = bootstrapTimestamp(row[5]);
    if (!precio || !fecha) return;
    const date = new Date(fecha);
    const dayKey = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const monthKey = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM");
    [["dia", dayKey], ["mes", monthKey], ["trabajador", row[4]], ["servicio", row[2]]].forEach(([tipo, clave]) => {
      const key = getClaveIndiceIngreso(tipo, clave);
      if (!metrics[key]) metrics[key] = { tipo, clave, total: 0, cantidad: 0 };
      metrics[key].total += precio;
      metrics[key].cantidad++;
    });
  });

  const outputRows = Object.values(metrics).map(metric => [metric.tipo, metric.clave, metric.total, metric.cantidad, new Date()]);
  indice.clearContents();
  indice.getRange(1, 1, 1, INDICE_INGRESOS_HEADERS.length).setValues([INDICE_INGRESOS_HEADERS]);
  if (outputRows.length) indice.getRange(2, 1, outputRows.length, INDICE_INGRESOS_HEADERS.length).setValues(outputRows);
  PropertiesService.getScriptProperties().setProperty("INDICE_INGRESOS_LISTO", "true");
  return { ok: true, registros: rows.length, metricas: outputRows.length };
}

function actualizarIndiceIngreso(spreadsheet, registro, delta) {
  if (PropertiesService.getScriptProperties().getProperty("INDICE_INGRESOS_LISTO") !== "true") return;
  const precio = Number(registro.precio) || 0;
  const fecha = bootstrapTimestamp(registro.fecha);
  if (!precio || !fecha || !delta) return;

  const date = new Date(fecha);
  const keys = [
    ["dia", Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd")],
    ["mes", Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM")],
    ["trabajador", registro.trabajador],
    ["servicio", registro.servicio]
  ];
  const sheet = getOrCreateSheet("Indice_Ingresos", INDICE_INGRESOS_HEADERS, spreadsheet);
  const rows = sheet.getDataRange().getValues();
  const positions = {};
  rows.slice(1).forEach((row, index) => { positions[getClaveIndiceIngreso(row[0], row[1])] = index + 2; });
  const now = new Date();

  keys.forEach(([tipo, clave]) => {
    const key = getClaveIndiceIngreso(tipo, clave);
    const row = positions[key];
    if (row) {
      const total = Math.max(0, Number(rows[row - 1][2]) + precio * delta);
      const cantidad = Math.max(0, Number(rows[row - 1][3]) + delta);
      sheet.getRange(row, 3, 1, 3).setValues([[total, cantidad, now]]);
    } else if (delta > 0) {
      sheet.appendRow([tipo, clave, precio, 1, now]);
    }
  });
}

function bootstrapTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  const timestamp = value ? new Date(value).getTime() : null;
  return isNaN(timestamp) ? null : timestamp;
}

function mapearServiciosBootstrap(rows) {
  return rows.slice(1).map(row => ({ id: row[0], nombre: row[1], precio: row[2] }));
}

function mapearTrabajadoresBootstrap(rows) {
  return rows.slice(1).map(row => ({
    id: row[0],
    nombre: row[1],
    estado: row[2],
    liquidacion: 0,
    fecha_liquidacion: "",
    correo: row[5] || "",
    tienePassword: !!row[6],
    rol: row[7] || "",
    activo: row[8] || "",
    creado: row[9] || "",
    ultimo_login: row[10] || ""
  }));
}

function agruparAdicionalesBootstrap(rows) {
  const porLavado = {};
  rows.slice(1).forEach(row => {
    if (String(row[5] || "activo").toLowerCase() === "inactivo") return;
    const lavadoId = String(row[1]);
    if (!porLavado[lavadoId]) porLavado[lavadoId] = [];
    porLavado[lavadoId].push({
      id: row[0],
      nombre: row[2],
      precio: Number(row[3]) || 0,
      fecha: bootstrapTimestamp(row[4])
    });
  });
  return porLavado;
}

function agruparGastosBootstrap(rows) {
  const porLavado = {};
  rows.slice(1).forEach(row => {
    const lavadoId = String(row[1]);
    if (!lavadoId) return;
    if (!porLavado[lavadoId]) porLavado[lavadoId] = [];
    porLavado[lavadoId].push({
      material: row[2],
      cantidad: row[3],
      costo: Number(row[4]) || 0,
      fecha: bootstrapTimestamp(row[5])
    });
  });
  return porLavado;
}

function mapearActivosBootstrap(rows, adicionalesPorLavado, gastosPorLavado) {
  return rows.slice(1).map(row => {
    const id = String(row[0]);
    const adicionales = adicionalesPorLavado[id] || [];
    return {
      id: row[0],
      placa: row[1],
      servicio: row[2],
      precio: row[3],
      trabajador: row[4],
      hora: bootstrapTimestamp(row[5]) || row[5],
      adicionales,
      total_adicionales: adicionales.reduce((total, item) => total + Number(item.precio || 0), 0),
      gastos: gastosPorLavado[id] || []
    };
  });
}

function construirIngresosBootstrap(rows) {
  const detalle = rows.slice(1).map(row => {
    const precio = Number(row[3]) || 0;
    const fecha = bootstrapTimestamp(row[5]);
    if (!precio || !fecha) return null;
    const estadoPago = row[9] || "pagado";
    const pagos = [];
    if (estadoPago !== "pendiente") {
      if (row[11] && Number(row[12] || 0) > 0) pagos.push({ metodo: row[11], monto: Number(row[12]) || 0 });
      if (row[13] && Number(row[14] || 0) > 0) pagos.push({ metodo: row[13], monto: Number(row[14]) || 0 });
      if (!pagos.length && row[8]) pagos.push({ metodo: row[8], monto: precio });
    }
    let adicionales = [];
    try { adicionales = row[15] ? JSON.parse(row[15]) : []; } catch (error) {}
    return {
      id: row[0], placa: row[1], servicio: row[2], precio, trabajador: row[4], fecha,
      tiempo: row[7] || "", metodo_pago: estadoPago === "pendiente" ? "pendiente" : (row[8] || "sin_registrar"),
      pagos, adicionales,
      precio_base: Number(row[16]) || Math.max(0, precio - adicionales.reduce((total, item) => total + Number(item.precio || 0), 0)),
      tipo_registro: row[17] || "", nota: row[18] || "", estado_pago: estadoPago,
      fecha_pago: bootstrapTimestamp(row[10]) || fecha
    };
  }).filter(Boolean);
  return { totalServicios: detalle.length, totalIngresos: detalle.reduce((total, item) => total + item.precio, 0), detalle };
}

function construirPendientesBootstrap(rows) {
  return rows.slice(1).filter(row => (row[9] || "pagado") === "pendiente").map(row => ({
    id: row[0], placa: row[1], servicio: row[2], precio: Number(row[3]) || 0,
    trabajador: row[4], fecha: bootstrapTimestamp(row[5]), tiempo: row[7] || "", estado_pago: "pendiente"
  }));
}

function construirLiquidacionesBootstrap(trabajadoresRows, pagosRows, excluidasRows) {
  const trabajadoresPorNombre = {};
  trabajadoresRows.slice(1).forEach(row => {
    trabajadoresPorNombre[String(row[1] || "").trim()] = { id: row[0], nombre: row[1] };
  });

  const detalle = [];
  const resumen = {};
  pagosRows.slice(1).forEach(row => {
    if (row[4] !== "liquidarTrabajador") return;
    const trabajador = String(row[1] || "").trim();
    const valor = Number(row[2]) || 0;
    const fecha = bootstrapTimestamp(row[3]);
    if (!trabajador || !valor || !fecha) return;
    const trabajadorInfo = trabajadoresPorNombre[trabajador] || { id: trabajador, nombre: trabajador };
    const registro = { id: row[0], trabajadorId: trabajadorInfo.id, trabajador, valor, fecha, tipo: row[4] };
    detalle.push(registro);
    const key = String(trabajadorInfo.id);
    if (!resumen[key] || Number(resumen[key].fecha || 0) < fecha) resumen[key] = { valor, fecha, trabajador, tipo: row[4] };
  });
  detalle.sort((a, b) => b.fecha - a.fecha);
  const excluidos = (excluidasRows || []).slice(1).map(row => String(row[0])).filter(Boolean);
  return { detalle, resumen, excluidos };
}

function mapearRecogidasBootstrap(rows) {
  const dias = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return rows.slice(1).filter(row => row[6] === "pendiente").map(row => {
    const fecha = row[4] ? new Date(row[4]) : null;
    const hora = row[5] instanceof Date ? row[5] : (row[5] ? new Date(`1970-01-01T${row[5]}`) : null);
    let horaBonita = "";
    if (hora && !isNaN(hora.getTime())) {
      let horas = hora.getHours();
      const ampm = horas >= 12 ? "PM" : "AM";
      horas = horas % 12 || 12;
      horaBonita = `${horas}:${String(hora.getMinutes()).padStart(2, "0")} ${ampm}`;
    }
    return {
      id: row[0], nombre: row[1], telefono: row[2], placa: row[3], estado: row[6], hora: horaBonita,
      fecha: fecha && !isNaN(fecha.getTime()) ? `${dias[fecha.getDay()]} ${fecha.getDate()} ${meses[fecha.getMonth()]} ${fecha.getFullYear()}` : ""
    };
  });
}
