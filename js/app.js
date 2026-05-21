/* =====================================================
   ELEMENTOS BASE
   ===================================================== */
const placaInput = document.getElementById("placa");
const servicioSelect = document.getElementById("servicio");
const btnAgendar = document.getElementById("agendar");

/* === TOGGLE RECOGIDA === */
const toggleRecogida = document.getElementById("modoRecogida");
const formNormal = document.getElementById("form-normal");
const formRecogida = document.getElementById("form-recogida");

/* =====================================================
   AÑO DINÁMICO FOOTER
   ===================================================== */
document.getElementById("year").textContent = new Date().getFullYear();

/* =====================================================
   CARGAR SERVICIOS
   ===================================================== */
fetch(`${API_URL}?action=servicios`)
  .then(res => res.json())
  .then(servicios => {
    servicioSelect.innerHTML = '<option value="">Selecciona un servicio</option>';

    servicios.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.nombre;
      opt.textContent = `${s.nombre} - $${s.precio}`;
      servicioSelect.appendChild(opt);
    });
  })
  .catch(() => {
    servicioSelect.innerHTML = '<option>Error cargando servicios</option>';
  });

/* =====================================================
   TOGGLE NORMAL / RECOGIDA
   ===================================================== */
toggleRecogida.addEventListener("change", () => {
  if (toggleRecogida.checked) {
    formNormal.classList.add("hidden");
    formRecogida.classList.remove("hidden");
  } else {
    formRecogida.classList.add("hidden");
    formNormal.classList.remove("hidden");
  }
});

/* =====================================================
   AGENDAR (DECIDE SEGÚN MODO)
   ===================================================== */
btnAgendar.addEventListener("click", () => {

  /* ===== LAVADO NORMAL ===== */
  if (!toggleRecogida.checked) {
    const placa = placaInput.value.trim().toUpperCase();
    const servicio = servicioSelect.value;

    if (!placa || !servicio) {
      Swal.fire({
        icon: "warning",
        title: "Campos incompletos",
        text: "Debes ingresar la placa y seleccionar un servicio"
      });
      return;
    }

    btnAgendar.disabled = true;

    fetch(`${API_URL}?action=agendar&placa=${placa}&servicio=${encodeURIComponent(servicio)}`)
      .then(res => res.json())
      .then(r => {
        if (r.error) {
          Swal.fire("Error", r.error, "error");
        } else {
          Swal.fire({
            icon: "success",
            title: "Lavado agendado",
            html: `
              <b>Placa:</b> ${placa}<br>
              <b>Servicio:</b> ${r.servicio}<br>
              <b>Trabajador:</b> ${r.trabajador}<br>
              <b>Precio:</b> $${r.precio}
            `
          });

          placaInput.value = "";
          servicioSelect.value = "";
        }
      })
      .finally(() => btnAgendar.disabled = false);
  }

  /* ===== RECOGIDA PROGRAMADA ===== */
  else {
    const nombre = document.getElementById("nombre").value.trim();
    const telefono = document.getElementById("telefono").value.trim();
    const placa = document.getElementById("placaRecogida").value.trim().toUpperCase();
    const fecha = document.getElementById("fecha").value;
    const hora = document.getElementById("hora").value;

    if (!nombre || !telefono || !placa || !fecha || !hora) {
      Swal.fire({
        icon: "warning",
        title: "Campos incompletos",
        text: "Debes completar todos los datos de la recogida"
      });
      return;
    }

    btnAgendar.disabled = true;

    fetch(
      `${API_URL}?action=agendarRecogida&nombre=${encodeURIComponent(nombre)}&telefono=${telefono}&placa=${placa}&fecha=${fecha}&hora=${hora}`
    )
      .then(res => res.json())
      .then(r => {
        if (r?.error) {
          Swal.fire("Error", r.error, "error");
        } else {
          Swal.fire("Listo", "Recogida programada correctamente", "success");

          document.getElementById("nombre").value = "";
          document.getElementById("telefono").value = "";
          document.getElementById("placaRecogida").value = "";
          document.getElementById("fecha").value = "";
          document.getElementById("hora").value = "";
        }
      })
      .finally(() => btnAgendar.disabled = false);
  }
});

/* =====================================================
   🌌 FONDO ANIMADO ESTRELLAS + NEBULOSAS
   (NO SE TOCA – FUNCIONA IGUAL)
   ===================================================== */
const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d");

let w, h, stars = [];

function resize() {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

function createStars(count = 120) {
  stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.5 + 0.5,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      a: Math.random()
    });
  }
}
createStars();

function animate() {
  ctx.clearRect(0, 0, w, h);

  const gradient = ctx.createRadialGradient(
    w * 0.3, h * 0.8, 0,
    w * 0.3, h * 0.8, w
  );
  gradient.addColorStop(0, "rgba(201,154,58,0.14)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  stars.forEach(s => {
    s.x += s.vx;
    s.y += s.vy;

    if (s.x < 0) s.x = w;
    if (s.x > w) s.x = 0;
    if (s.y < 0) s.y = h;
    if (s.y > h) s.y = 0;

    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.4 + s.a})`;
    ctx.fill();
  });

  requestAnimationFrame(animate);
}

animate();
