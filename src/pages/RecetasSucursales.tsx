import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Search,
  ChevronDown,
  ChevronUp,
  Clock3,
  Package,
  X,
  AlertTriangle,
  Check,
} from "lucide-react";
import {
  confirmarEntregaReceta,
  getProductos,
  getRecetasPendientesSucursal,
  type ProductoSP,
} from "../Services/sharepoint";
import logoSurco from "../assets/logo-surco.png";

type RecetaProducto = {
  detalleId?: number;
  productoId: number;
  productoNombre: string;
  productoCodigo?: string;
  unidad?: string;
  cantidad: number;
  cantidadEntregada?: number;
  dosis?: string;
  precioVenta?: number;
  totalVenta?: number;
  inventarioMomento?: number;
  disponibleMomento?: number;
  stockMomento?: number;
  reservadaMomento?: number;
  fueCambiado?: boolean;
  productoOriginalNombre?: string;
  codigoProductoOriginal?: string;
  productoCambioNombre?: string;
  productoCambioCodigo?: string;
  productoCambioUnidad?: string;
  cambioProducto?: string;
  motivoCambio?: string;
};

type Receta = {
  id: number;
  numero: string;
  estado?: string;
  clienteNombre?: string;
  fincaNombre?: string;
  ingenieroNombre?: string;
  sucursalNombre?: string;
  createdAt?: string;
  fechaEnvio?: string;
  paraCuantoEs?: string;
  lotesCultivos?: string;
  observacion?: string;
  observacionEntrega?: string;
  precioTotalVenta?: number;
  productos?: RecetaProducto[];
};

type ProductoConfirmacion = {
  detalleId?: number;
  productoId: number;
  entregadoCompleto: boolean;
  cantidadEntregada: number;
  fueCambiado?: boolean;
  productoCambioId?: number;
  productoCambioNombre?: string;
  productoCambioCodigo?: string;
  productoCambioUnidad?: string;
  productoCambioPrecioVenta?: number;
  motivoCambio?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function formatFecha(fecha?: string) {
  if (!fecha) return "-";
  const date = new Date(fecha);
  if (Number.isNaN(date.getTime())) return fecha;
  return date.toLocaleString();
}

function formatMoney(value?: number) {
  const n = Number(value || 0);
  return n.toLocaleString("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0,
  });
}

function formatCantidad(value?: number) {
  const n = Number(value || 0);
  return n.toLocaleString("es-CR", { maximumFractionDigits: 2 });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function RecetasSucursales() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [productosCatalogo, setProductosCatalogo] = useState<ProductoSP[]>([]);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<number[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [recetaSeleccionada, setRecetaSeleccionada] = useState<Receta | null>(null);
  const [factura, setFactura] = useState("");
  const [observacion, setObservacion] = useState("");
  const [imprimirReceta, setImprimirReceta] = useState(true);
  const [productosConfirmacion, setProductosConfirmacion] = useState<
    ProductoConfirmacion[]
  >([]);

  async function loadRecetas() {
    try {
      setLoading(true);
      const data = await getRecetasPendientesSucursal();
      setRecetas(Array.isArray(data) ? (data as Receta[]) : []);
    } catch (error) {
      console.error("Error cargando recetas sucursal:", error);
      setRecetas([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadProductosCatalogo() {
    try {
      const data = await getProductos();
      setProductosCatalogo(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error cargando productos para cambio:", error);
      setProductosCatalogo([]);
    }
  }

  useEffect(() => {
    loadRecetas();
    loadProductosCatalogo();
  }, []);

  const recetasFiltradas = useMemo(() => {
    const term = normalizeText(search);
    if (!term) return recetas;

    return recetas.filter((r) => {
      return (
        normalizeText(r.numero).includes(term) ||
        normalizeText(r.clienteNombre).includes(term) ||
        normalizeText(r.fincaNombre).includes(term) ||
        normalizeText(r.ingenieroNombre).includes(term) ||
        normalizeText(r.sucursalNombre).includes(term)
      );
    });
  }, [recetas, search]);

  function toggleExpand(id: number) {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function abrirModalConfirmacion(receta: Receta) {
    const productos = Array.isArray(receta.productos) ? receta.productos : [];

    setRecetaSeleccionada(receta);
    setFactura("");
    setObservacion("");
    setImprimirReceta(true);
    setProductosConfirmacion(
      productos.map((p) => ({
        detalleId: p.detalleId,
        productoId: Number(p.productoId),
        entregadoCompleto: true,
        cantidadEntregada: Number(p.cantidad || 0),
        fueCambiado: false,
        productoCambioId: 0,
        productoCambioNombre: "",
        productoCambioCodigo: "",
        productoCambioUnidad: "",
        productoCambioPrecioVenta: 0,
        motivoCambio: "",
      }))
    );
    setModalOpen(true);
  }

  function cerrarModal() {
    setModalOpen(false);
    setRecetaSeleccionada(null);
    setFactura("");
    setObservacion("");
    setImprimirReceta(true);
    setProductosConfirmacion([]);
  }

  function getEstadoProducto(productoId: number, detalleId?: number) {
    return productosConfirmacion.find(
      (p) =>
        (detalleId && p.detalleId ? Number(p.detalleId) === Number(detalleId) : false) ||
        Number(p.productoId) === Number(productoId)
    );
  }

  function updateProductoConfirmacion(
    productoId: number,
    detalleId: number | undefined,
    updater: (item: ProductoConfirmacion) => ProductoConfirmacion
  ) {
    setProductosConfirmacion((prev) =>
      prev.map((p) => {
        const same =
          (detalleId && p.detalleId ? Number(p.detalleId) === Number(detalleId) : false) ||
          Number(p.productoId) === Number(productoId);
        return same ? updater(p) : p;
      })
    );
  }

  function toggleCambioProducto(producto: RecetaProducto, checked: boolean) {
    updateProductoConfirmacion(producto.productoId, producto.detalleId, (item) => ({
      ...item,
      fueCambiado: checked,
      // Si la sucursal cambia el producto, el producto recetado original NO cuenta como cumplido.
      entregadoCompleto: checked ? false : item.entregadoCompleto,
      cantidadEntregada: checked ? 0 : item.cantidadEntregada,
      productoCambioId: checked ? item.productoCambioId || 0 : 0,
      productoCambioNombre: checked ? item.productoCambioNombre || "" : "",
      productoCambioCodigo: checked ? item.productoCambioCodigo || "" : "",
      productoCambioUnidad: checked ? item.productoCambioUnidad || "" : "",
      productoCambioPrecioVenta: checked ? item.productoCambioPrecioVenta || 0 : 0,
      motivoCambio: checked ? item.motivoCambio || "" : "",
    }));
  }

  function cambiarProductoCambio(producto: RecetaProducto, productoCambioId: number) {
    const nuevo = productosCatalogo.find((p) => Number(p.id) === Number(productoCambioId));
    updateProductoConfirmacion(producto.productoId, producto.detalleId, (item) => ({
      ...item,
      fueCambiado: Number(productoCambioId) > 0,
      productoCambioId: Number(productoCambioId || 0),
      productoCambioNombre: nuevo?.nombre || "",
      productoCambioCodigo: nuevo?.codigo || "",
      productoCambioUnidad: String(nuevo?.unidad || ""),
      productoCambioPrecioVenta: Number(nuevo?.precioVenta || 0),
    }));
  }

  function cambiarMotivoCambio(producto: RecetaProducto, motivoCambio: string) {
    updateProductoConfirmacion(producto.productoId, producto.detalleId, (item) => ({
      ...item,
      motivoCambio,
    }));
  }

  function toggleProductoCompleto(
    productoId: number,
    entregadoCompleto: boolean,
    cantidadRecetada: number,
    detalleId?: number
  ) {
    setProductosConfirmacion((prev) =>
      prev.map((p) => {
        const same =
          (detalleId && p.detalleId ? Number(p.detalleId) === Number(detalleId) : false) ||
          Number(p.productoId) === Number(productoId);

        if (!same) return p;

        return {
          ...p,
          entregadoCompleto,
          cantidadEntregada: entregadoCompleto
            ? Number(cantidadRecetada)
            : Number(p.cantidadEntregada ?? 0),
        };
      })
    );
  }

  function cambiarCantidadEntregada(productoId: number, cantidad: number, detalleId?: number) {
    setProductosConfirmacion((prev) =>
      prev.map((p) => {
        const same =
          (detalleId && p.detalleId ? Number(p.detalleId) === Number(detalleId) : false) ||
          Number(p.productoId) === Number(productoId);

        if (!same) return p;

        return {
          ...p,
          cantidadEntregada: cantidad < 0 ? 0 : cantidad,
        };
      })
    );
  }

  function imprimirRecetaPDF(receta: Receta, facturaNumero: string, observacionTexto: string, ventanaPdf?: Window | null): boolean {
    try {
      const productos = Array.isArray(receta.productos) ? receta.productos : [];

      const productosHtml = productos
        .map((p) => {
          const estado = getEstadoProducto(p.productoId, p.detalleId);
          const originalNombre =
            p.productoOriginalNombre ||
            p.productoNombre ||
            "-";
          const cambioNombre =
            estado?.fueCambiado && estado.productoCambioNombre
              ? estado.productoCambioNombre
              : p.fueCambiado && p.productoCambioNombre
                ? p.productoCambioNombre
                : "";
          const motivoCambio =
            estado?.motivoCambio ||
            p.motivoCambio ||
            "";

          const productoHtml = cambioNombre
            ? `
              <div class="producto-original">
                <span class="mini-label">Producto enviado por ingeniería</span>
                <strong>${escapeHtml(originalNombre)}</strong>
              </div>
              <div class="producto-cambio">
                <span class="mini-label">Cambio realizado en sucursal</span>
                <strong>${escapeHtml(originalNombre)} &rarr; ${escapeHtml(cambioNombre)}</strong>
                ${motivoCambio ? `<div class="motivo"><strong>Motivo:</strong> ${escapeHtml(motivoCambio)}</div>` : ""}
              </div>
            `
            : `<strong>${escapeHtml(originalNombre)}</strong>`;

          return `
            <tr>
              <td>${productoHtml}</td>
              <td>${escapeHtml(p.dosis || "-")}</td>
            </tr>
          `;
        })
        .join("");

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>Receta ${escapeHtml(receta.numero)}</title>
            <style>
              * { box-sizing: border-box; }
              body {
                margin: 0;
                font-family: Arial, Helvetica, sans-serif;
                color: #0f172a;
                background: #ffffff;
              }
              .page {
                width: 100%;
                max-width: 900px;
                margin: 20px auto;
                background: #ffffff;
                border: 1px solid #e2e8f0;
              }
              .header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                padding: 22px 28px 16px;
                border-bottom: 1px solid #e2e8f0;
              }
              .brand img {
                width: 160px;
                max-width: 100%;
                height: auto;
                display: block;
              }
              .meta {
                text-align: right;
                font-size: 12px;
                color: #0f172a;
              }
              .content {
                padding: 24px 28px 28px;
              }
              .title {
                margin: 0 0 6px;
                font-size: 28px;
                font-weight: 800;
                color: #14532d;
              }
              .subtitle {
                margin: 0 0 18px;
                font-size: 14px;
                color: #475569;
              }
              .obs-box {
                margin-bottom: 18px;
                background: #f0fdf4;
                border: 1px solid #86efac;
                border-radius: 12px;
                padding: 16px;
              }
              .obs-title {
                margin: 0 0 10px;
                font-size: 15px;
                font-weight: 800;
                color: #166534;
              }
              .obs-text {
                margin: 0 0 4px;
                font-size: 14px;
                color: #0f172a;
                line-height: 1.45;
                white-space: pre-wrap;
              }
              .delivery-box {
                margin-bottom: 18px;
                background: #fff7ed;
                border: 1px solid #fed7aa;
                border-radius: 12px;
                padding: 16px;
              }
              .delivery-title {
                margin: 0 0 8px;
                font-size: 15px;
                font-weight: 800;
                color: #9a3412;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                border: 1px solid #e2e8f0;
              }
              thead th {
                background: #f8fafc;
                color: #334155;
                text-align: left;
                padding: 12px 14px;
                font-size: 13px;
                border-bottom: 1px solid #e2e8f0;
              }
              tbody td {
                padding: 14px;
                border-top: 1px solid #e2e8f0;
                font-size: 14px;
                vertical-align: top;
              }
              tbody tr:nth-child(even) {
                background: #f8fafc;
              }
              .mini-label {
                display: block;
                font-size: 11px;
                font-weight: 700;
                color: #64748b;
                text-transform: uppercase;
                letter-spacing: 0.03em;
                margin-bottom: 3px;
              }
              .producto-cambio {
                margin-top: 10px;
                padding: 10px 12px;
                border-radius: 10px;
                border: 1px solid #bfdbfe;
                background: #eff6ff;
                color: #1e3a8a;
              }
              .motivo {
                margin-top: 6px;
                color: #0f172a;
              }
              @media print {
                body { background: #fff; }
                .page {
                  border: none;
                  margin: 0;
                  max-width: 100%;
                }
              }
            </style>
          </head>
          <body>
            <div class="page">
              <div class="header">
                <div class="brand">
                  <img src="${logoSurco}" alt="SURCO" />
                </div>
                <div class="meta">
                  <div><strong>Receta:</strong> ${escapeHtml(receta.numero)}</div>
                  <div><strong>Fecha:</strong> ${escapeHtml(new Date().toLocaleString())}</div>
                </div>
              </div>

              <div class="content">
                <h1 class="title">Receta #${escapeHtml(receta.numero)}</h1>
                <p class="subtitle">Comprobante de entrega generado desde el sistema SURCO.</p>

                <div class="obs-box">
                  <h3 class="obs-title">Datos enviados por ingeniería</h3>
                  <p class="obs-text"><strong>Cliente:</strong> ${escapeHtml(receta.clienteNombre || "-")}</p>
                  <p class="obs-text"><strong>Finca:</strong> ${escapeHtml(receta.fincaNombre || "-")}</p>
                  <p class="obs-text"><strong>Ingeniero:</strong> ${escapeHtml(receta.ingenieroNombre || "-")}</p>
                  <p class="obs-text"><strong>Sucursal:</strong> ${escapeHtml(receta.sucursalNombre || "-")}</p>
                  <p class="obs-text"><strong>Factura:</strong> ${escapeHtml(facturaNumero || "-")}</p>
                  <p class="obs-text"><strong>¿Para cuánto es?:</strong> ${escapeHtml(receta.paraCuantoEs || "-")}</p>
                  <p class="obs-text"><strong>Lotes/Cultivos:</strong> ${escapeHtml(receta.lotesCultivos || "-")}</p>
                  <p class="obs-text"><strong>Observación general:</strong> ${escapeHtml(receta.observacion || "-")}</p>
                  <p class="obs-text"><strong>Precio aprox:</strong> ${escapeHtml(formatMoney(receta.precioTotalVenta || 0))}</p>
                </div>

                <div class="delivery-box">
                  <h3 class="delivery-title">Observación de entrega</h3>
                  <p class="obs-text">${escapeHtml(observacionTexto || "-")}</p>
                </div>

                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Dosis</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${productosHtml}
                  </tbody>
                </table>
              </div>
            </div>
            <script>
              window.onload = function () {
                setTimeout(function () {
                  window.print();
                }, 250);
              };
            </script>
          </body>
        </html>
      `;

      const ventana = ventanaPdf || window.open("", "_blank", "width=1024,height=768");
      if (!ventana) {
        alert("La confirmación se guardó, pero el navegador bloqueó la ventana del PDF. Permita ventanas emergentes para esta página.");
        return false;
      }

      ventana.document.open();
      ventana.document.write(html);
      ventana.document.close();
      return true;
    } catch (error) {
      console.error("Error generando PDF de receta:", error);
      try {
        if (ventanaPdf && !ventanaPdf.closed) ventanaPdf.close();
      } catch {
        // Ignorar errores cerrando la ventana auxiliar.
      }
      alert("La confirmación se guardó, pero no se pudo abrir/imprimir el PDF. Puede revisar la receta en historial.");
      return false;
    }
  }

  async function finalizarConfirmacion() {
    let ventanaPdf: Window | null = null;
    try {
      if (!recetaSeleccionada) return;

      if (!factura.trim()) {
        alert("Debe ingresar el número de factura");
        return;
      }

      const ok = window.confirm(
        imprimirReceta
          ? "¿Desea finalizar la confirmación e imprimir/guardar la receta en PDF?"
          : "¿Desea finalizar la confirmación?"
      );

      if (!ok) return;

      ventanaPdf = imprimirReceta
        ? window.open("", "_blank", "width=1024,height=768")
        : null;

      if (imprimirReceta && ventanaPdf) {
        try {
          ventanaPdf.document.open();
          ventanaPdf.document.write(`<!DOCTYPE html><html><head><title>Generando PDF...</title><meta charset="UTF-8" /></head><body style="font-family: Arial, sans-serif; padding: 32px; color: #14532d;"><h2>Generando comprobante...</h2><p>Espere un momento, la receta se está confirmando.</p></body></html>`);
          ventanaPdf.document.close();
        } catch {
          // Si no se puede escribir la ventana temporal, igual se finaliza la confirmación.
        }
      }

      if (imprimirReceta && !ventanaPdf) {
        alert("El navegador bloqueó la ventana del PDF. La confirmación continuará, pero permita ventanas emergentes para imprimir.");
      }

      setSaving(true);

      await confirmarEntregaReceta(recetaSeleccionada.id, {
        factura,
        observacion,
        detalles: productosConfirmacion.map((p) => ({
          detalleId: p.detalleId,
          productoId: Number(p.productoId || 0),
          cantidadEntregada: Number(p.cantidadEntregada || 0),
          fueCambiado: !!p.fueCambiado,
          productoCambioId: Number(p.productoCambioId || 0),
          productoCambioNombre: String(p.productoCambioNombre || ""),
          productoCambioCodigo: String(p.productoCambioCodigo || ""),
          productoCambioUnidad: String(p.productoCambioUnidad || ""),
          productoCambioPrecioVenta: Number(p.productoCambioPrecioVenta || 0),
          motivoCambio: String(p.motivoCambio || ""),
          totalVenta: Number(p.cantidadEntregada || 0) * Number(p.productoCambioPrecioVenta || 0),
        })),
      });

      if (imprimirReceta) {
        imprimirRecetaPDF(recetaSeleccionada as Receta, factura, observacion, ventanaPdf);
      }

      cerrarModal();
      await loadRecetas();
    } catch (error) {
      console.error("Error confirmando entrega:", error);
      try {
        if (ventanaPdf && !ventanaPdf.closed) ventanaPdf.close();
      } catch {
        // Ignorar errores cerrando la ventana auxiliar.
      }
      const mensaje = error instanceof Error && error.message ? `: ${error.message}` : "";
      alert(`No se pudo finalizar la confirmación${mensaje}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
          gap: 16,
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "#ede9fe",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#7c3aed",
            }}
          >
            <ClipboardList size={22} />
          </div>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 800,
                color: "#0f172a",
              }}
            >
              Recetas Sucursales
            </h1>
            <p style={{ margin: "6px 0 0", color: "#475569" }}>
              {recetas.length} recetas pendientes de confirmar
            </p>
          </div>
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          padding: 14,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid #dbe2ea",
            borderRadius: 12,
            padding: "12px 14px",
            background: "#fff",
          }}
        >
          <Search size={18} color="#64748b" />
          <input
            type="text"
            placeholder="Buscar recetas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              border: "none",
              outline: "none",
              width: "100%",
              fontSize: 15,
            }}
          />
        </div>
      </div>

      {loading ? (
        <div
          style={{
            background: "#fff",
            borderRadius: 18,
            border: "1px solid #e2e8f0",
            padding: 24,
          }}
        >
          Cargando...
        </div>
      ) : recetasFiltradas.length === 0 ? (
        <div
          style={{
            background: "#fff",
            borderRadius: 18,
            border: "1px solid #e2e8f0",
            padding: 24,
            color: "#334155",
          }}
        >
          No hay recetas pendientes de confirmar
        </div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {recetasFiltradas.map((receta) => {
            const expanded = expandedIds.includes(receta.id);
            const productos = Array.isArray(receta.productos) ? receta.productos : [];

            return (
              <div
                key={receta.id}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 18,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: 20,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 20,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 14,
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 999,
                          background: "#fff7ed",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#d97706",
                        }}
                      >
                        <Clock3 size={16} />
                      </div>

                      <strong style={{ fontSize: 20, color: "#0f172a" }}>
                        Receta #{receta.numero}
                      </strong>

                      <span
                        style={{
                          background: "#fffbeb",
                          color: "#a16207",
                          borderRadius: 999,
                          padding: "5px 10px",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        Pendiente de Confirmar
                      </span>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                        gap: 16,
                      }}
                    >
                      <div>
                        <p style={{ margin: "0 0 8px" }}>
                          <strong>Ingeniero:</strong> {receta.ingenieroNombre || "-"}
                        </p>
                        <p style={{ margin: "0 0 8px" }}>
                          <strong>Sucursal:</strong> {receta.sucursalNombre || "-"}
                        </p>
                        <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
                          Recibida el {formatFecha(receta.fechaEnvio || receta.createdAt)}
                        </p>
                      </div>

                      <div>
                        <p style={{ margin: "0 0 8px" }}>
                          <strong>Cliente:</strong> {receta.clienteNombre || "-"}
                        </p>
                        <p style={{ margin: "0 0 8px" }}>
                          <strong>Finca:</strong> {receta.fincaNombre || "-"}
                        </p>
                        {!!String(receta.paraCuantoEs || "").trim() && (
                          <p style={{ margin: "0 0 8px" }}>
                            <strong>¿Para cuánto es?:</strong> {receta.paraCuantoEs}
                          </p>
                        )}
                        {!!String(receta.lotesCultivos || "").trim() && (
                          <p style={{ margin: "0 0 8px" }}>
                            <strong>Lotes/Cultivos:</strong> {receta.lotesCultivos}
                          </p>
                        )}
                        {!!String(receta.observacion || "").trim() && (
                          <p style={{ margin: "0 0 8px" }}>
                            <strong>Observación general:</strong> {receta.observacion}
                          </p>
                        )}
                        
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => abrirModalConfirmacion(receta)}
                      style={{
                        border: "none",
                        background: "#15803d",
                        color: "#fff",
                        borderRadius: 12,
                        padding: "10px 14px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Confirmar
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleExpand(receta.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        alignSelf: "flex-start",
                        width: 36,
                        height: 36,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div
                    style={{
                      borderTop: "1px solid #eef2f7",
                      padding: 18,
                      display: "grid",
                      gap: 10,
                      background: "#fafcff",
                    }}
                  >
                    {(receta.paraCuantoEs || receta.lotesCultivos || receta.observacion || Number(receta.precioTotalVenta || 0) >= 0) && (
                      <div
                        style={{
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          borderRadius: 14,
                          padding: 14,
                          color: "#14532d",
                          display: "grid",
                          gap: 6,
                        }}
                      >
                        <strong>Datos enviados por el ingeniero</strong>
                        <div><strong>¿Para cuánto es?:</strong> {receta.paraCuantoEs || "-"}</div>
                        <div><strong>Lote / Cultivo:</strong> {receta.lotesCultivos || "-"}</div>
                        <div><strong>Observación general:</strong> {receta.observacion || "-"}</div>
                        
                      </div>
                    )}

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#334155",
                        fontWeight: 700,
                        marginBottom: 2,
                      }}
                    >
                      <Package size={16} />
                      Productos ({productos.length})
                    </div>

                    {productos.length === 0 ? (
                      <div
                        style={{
                          padding: "12px 14px",
                          background: "#fff",
                          border: "1px solid #e5edf5",
                          borderRadius: 12,
                          color: "#64748b",
                        }}
                      >
                        Esta receta no tiene productos.
                      </div>
                    ) : (
                      productos.map((p, index) => (
                        <div
                          key={`${p.detalleId || p.productoId}-${index}`}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "12px 14px",
                            background: "#fff",
                            border: "1px solid #e5edf5",
                            borderRadius: 12,
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, color: "#0f172a" }}>
                              {p.fueCambiado && (p.cambioProducto || p.productoCambioNombre)
                                ? p.cambioProducto || `${p.productoOriginalNombre || p.productoNombre || "Original"} -> ${p.productoCambioNombre}`
                                : p.productoNombre || "Producto"}
                              {p.productoCodigo ? ` (${p.productoCodigo})` : ""}
                              {p.unidad ? ` - ${p.unidad}` : ""}
                            </div>
                            {!!String(p.dosis || "").trim() && (
                              <div style={{ marginTop: 4, fontSize: 13, color: "#475569" }}>
                                <strong>Dosis:</strong> {p.dosis}
                              </div>
                            )}
                            <div style={{ marginTop: 4, fontSize: 13, color: "#15803d", fontWeight: 700 }}>
                              Inventario al crear: {formatCantidad(Number(p.inventarioMomento ?? p.disponibleMomento ?? 0))}
                            </div>
                            <div style={{ marginTop: 4, fontSize: 13, color: "#475569" }}>
                              Precio aprox: {formatMoney(p.precioVenta || 0)}
                            </div>
                          </div>
                          <strong>{p.cantidad}</strong>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && recetaSeleccionada && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 760,
              maxHeight: "90vh",
              overflowY: "auto",
              background: "#fff",
              borderRadius: 22,
              boxShadow: "0 24px 80px rgba(15,23,42,0.18)",
            }}
          >
            <div
              style={{
                padding: "22px 24px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 22, color: "#0f172a" }}>
                Confirmar Entrega - Receta #{recetaSeleccionada.numero}
              </h2>

              <button
                type="button"
                onClick={cerrarModal}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid #d9e2ec",
                  background: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: "0 24px 24px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                  gap: 16,
                  marginBottom: 24,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                <div>
                  <p style={{ margin: "0 0 10px" }}>
                    <strong>Ingeniero:</strong> {recetaSeleccionada.ingenieroNombre || "-"}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Sucursal:</strong> {recetaSeleccionada.sucursalNombre || "-"}
                  </p>
                </div>

                <div>
                  <p style={{ margin: "0 0 10px" }}>
                    <strong>Cliente:</strong> {recetaSeleccionada.clienteNombre || "-"}
                  </p>
                  <p style={{ margin: "0 0 10px" }}>
                    <strong>Finca:</strong> {recetaSeleccionada.fincaNombre || "-"}
                  </p>
                  {!!String(recetaSeleccionada.paraCuantoEs || "").trim() && (
                    <p style={{ margin: "0 0 10px" }}>
                      <strong>¿Para cuánto es?:</strong> {recetaSeleccionada.paraCuantoEs}
                    </p>
                  )}
                  {!!String(recetaSeleccionada.lotesCultivos || "").trim() && (
                    <p style={{ margin: "0 0 10px" }}>
                      <strong>Lotes/Cultivos:</strong> {recetaSeleccionada.lotesCultivos}
                    </p>
                  )}
                  {!!String(recetaSeleccionada.observacion || "").trim() && (
                    <p style={{ margin: "0 0 10px" }}>
                      <strong>Observación general:</strong> {recetaSeleccionada.observacion}
                    </p>
                  )}
                  
                </div>
              </div>

              <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>
                Confirmar Productos Entregados
              </h3>
              <p style={{ margin: "0 0 20px", color: "#475569", lineHeight: 1.5 }}>
                Marque los productos que fueron efectivamente entregados. Si un producto no fue llevado
                completamente, desmarque y especifique la cantidad entregada.
              </p>

              <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
                {(recetaSeleccionada.productos || []).map((producto, index) => {
                  const estado = getEstadoProducto(producto.productoId, producto.detalleId);

                  return (
                    <div
                      key={`${producto.detalleId || producto.productoId}-${index}`}
                      style={{
                        border: "1px solid #bbf7d0",
                        background: "#f0fdf4",
                        borderRadius: 16,
                        padding: 16,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 12,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              fontWeight: 800,
                              color: "#0f172a",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={!!estado?.entregadoCompleto}
                              onChange={(e) =>
                                toggleProductoCompleto(
                                  producto.productoId,
                                  e.target.checked,
                                  Number(producto.cantidad || 0),
                                  producto.detalleId
                                )
                              }
                            />
                            <span>
                              {producto.productoNombre}
                              {producto.productoCodigo ? ` (${producto.productoCodigo})` : ""}
                            </span>
                          </label>

                          <div style={{ marginTop: 10, color: "#475569", fontSize: 14 }}>
                            <div>
                              <strong>Producto recetado:</strong> {producto.unidad || "-"}
                            </div>
                            {!!String(producto.dosis || "").trim() && (
                              <div style={{ marginTop: 4 }}>
                                <strong>Dosis:</strong> {producto.dosis}
                              </div>
                            )}
                            <div style={{ marginTop: 4, color: "#15803d", fontWeight: 700 }}>
                              <strong>Inventario al crear receta:</strong> {formatCantidad(Number(producto.inventarioMomento ?? producto.disponibleMomento ?? 0))}
                            </div>
                            <div style={{ marginTop: 4 }}>
                              <strong>Precio aprox producto:</strong> {formatMoney(producto.precioVenta || 0)}
                            </div>
                          </div>
                        </div>

                        <span
                          style={{
                            background: estado?.entregadoCompleto ? "#dcfce7" : "#fee2e2",
                            color: estado?.entregadoCompleto ? "#166534" : "#991b1b",
                            borderRadius: 999,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {estado?.entregadoCompleto ? "Llevado" : "Parcial"}
                        </span>
                      </div>

                      {!estado?.entregadoCompleto && (
                        <div style={{ marginTop: 14 }}>
                          <label
                            style={{
                              display: "block",
                              marginBottom: 8,
                              fontWeight: 700,
                              color: "#0f172a",
                            }}
                          >
                            Cantidad entregada
                          </label>

                          <input
                            type="number"
                            min={0}
                            max={Number(producto.cantidad || 0)}
                            value={Number(estado?.cantidadEntregada || 0)}
                            onChange={(e) =>
                              cambiarCantidadEntregada(
                                producto.productoId,
                                Number(e.target.value || 0),
                                producto.detalleId
                              )
                            }
                            style={{
                              width: "100%",
                              borderRadius: 12,
                              border: "1px solid #d9e2ec",
                              padding: "12px 14px",
                              fontSize: 15,
                            }}
                          />
                        </div>
                      )}

                      <div style={{ marginTop: 14, borderTop: "1px solid #dbe2ea", paddingTop: 14 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, cursor: "pointer", color: "#0f172a" }}>
                          <input
                            type="checkbox"
                            checked={!!estado?.fueCambiado}
                            onChange={(e) => toggleCambioProducto(producto, e.target.checked)}
                          />
                          Cambiar este producto por otro
                        </label>

                        {!!estado?.fueCambiado && (
                          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                            <select
                              value={Number(estado?.productoCambioId || 0)}
                              onChange={(e) => cambiarProductoCambio(producto, Number(e.target.value || 0))}
                              style={{ width: "100%", borderRadius: 12, border: "1px solid #d9e2ec", padding: "12px 14px", fontSize: 15 }}
                            >
                              <option value={0}>Seleccione producto nuevo...</option>
                              {productosCatalogo.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.nombre} {p.codigo ? `(${p.codigo})` : ""} {typeof p.disponible !== "undefined" ? `- Disp: ${Number(p.disponible || 0).toLocaleString("es-CR")}` : ""}
                                </option>
                              ))}
                            </select>

                            {estado.productoCambioNombre && (
                              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e3a8a", borderRadius: 12, padding: 12, fontWeight: 700 }}>
                                Cambia: {producto.productoNombre || "Producto original"} → {estado.productoCambioNombre}
                              </div>
                            )}

                            <input
                              type="text"
                              value={estado.motivoCambio || ""}
                              onChange={(e) => cambiarMotivoCambio(producto, e.target.value)}
                              placeholder="Motivo del cambio u observación del producto..."
                              style={{ width: "100%", borderRadius: 12, border: "1px solid #d9e2ec", padding: "12px 14px", fontSize: 15 }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>
                  Número de Factura *
                </label>

                <input
                  type="text"
                  value={factura}
                  onChange={(e) => setFactura(e.target.value)}
                  placeholder="Ej: FAC-2024-001"
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid #d9e2ec",
                    padding: "12px 14px",
                    fontSize: 15,
                  }}
                />
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>
                  Observación
                </label>

                <textarea
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  placeholder="Detalle adicional de la entrega..."
                  rows={3}
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid #d9e2ec",
                    padding: "12px 14px",
                    fontSize: 15,
                    resize: "vertical",
                  }}
                />
              </div>

              <div
                style={{
                  marginBottom: 16,
                  border: "1px solid #fde68a",
                  background: "#fffbeb",
                  color: "#92400e",
                  borderRadius: 14,
                  padding: 16,
                  display: "flex",
                  gap: 12,
                }}
              >
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ display: "block", marginBottom: 6 }}>
                    Acción Irreversible
                  </strong>
                  <span>
                    Una vez finalizada la confirmación, no podrá editar los productos entregados.
                    Asegúrese de verificar toda la información antes de continuar.
                  </span>
                </div>
              </div>

              <div
                style={{
                  marginBottom: 22,
                  border: "1px solid #dbe2ea",
                  background: "#f8fafc",
                  borderRadius: 14,
                  padding: 16,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    fontWeight: 700,
                    color: "#0f172a",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={imprimirReceta}
                    onChange={(e) => setImprimirReceta(e.target.checked)}
                  />
                  Imprimir / guardar receta en PDF al finalizar
                </label>

                <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 14 }}>
                  Si marca esta opción, al finalizar se abrirá una versión lista para imprimir o guardar como PDF.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 12,
                }}
              >
                <button
                  type="button"
                  onClick={cerrarModal}
                  style={{
                    border: "1px solid #d9e2ec",
                    background: "#fff",
                    color: "#0f172a",
                    borderRadius: 12,
                    padding: "12px 18px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={finalizarConfirmacion}
                  disabled={saving}
                  style={{
                    border: "none",
                    background: "#15803d",
                    color: "#fff",
                    borderRadius: 12,
                    padding: "12px 18px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 180,
                    justifyContent: "center",
                  }}
                >
                  <Check size={16} />
                  {saving ? "Finalizando..." : "Finalizar Confirmación"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RecetasSucursales;
