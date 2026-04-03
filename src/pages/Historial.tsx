import { useEffect, useMemo, useState } from "react";
import { Search, History, Download, ChevronDown, ChevronUp, ClipboardList, ArrowUpRight, Box, BarChart3 } from "lucide-react";
import { exportarHistorialCSV, getHistorialRecetas, getHistorialResumen, type HistorialRecetaSP, type HistorialResumenSP } from "../Services/sharepoint";
import "../styles/agro-pages.css";

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-CR", { dateStyle: "long", timeStyle: "short" });
}

function getCumplimientoClass(value: number) {
  if (value >= 90) return "success-soft";
  if (value >= 70) return "warning-soft";
  return "danger-soft";
}

export default function Historial() {
  const [resumen, setResumen] = useState<HistorialResumenSP>({ recetasFinalizadas: 0, efectividadPromedio: 0, productosCompletos: 0, totalProductos: 0 });
  const [recetas, setRecetas] = useState<HistorialRecetaSP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [expanded, setExpanded] = useState<number[]>([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    try {
      setLoading(true); setError("");
      const [r1, r2] = await Promise.all([getHistorialResumen(), getHistorialRecetas()]);
      setResumen(r1); setRecetas(r2);
    } catch (err: any) {
      setError(err.message || "Error cargando historial");
    } finally { setLoading(false); }
  }

  function toggleExpanded(id: number) { setExpanded((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]); }

  async function handleExport() {
    try {
      const blob = await exportarHistorialCSV();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "historial_recetas.csv"; a.click(); URL.revokeObjectURL(url);
    } catch (err: any) { alert(err.message || "No se pudo exportar el historial"); }
  }

  const filtradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return recetas;
    return recetas.filter((r) => `${r.numero} ${r.clienteNombre} ${r.ingenieroNombre} ${r.factura} ${r.fincaNombre}`.toLowerCase().includes(texto));
  }, [recetas, busqueda]);

  return (
    <div>
      <div className="page-toolbar"><div className="page-header" style={{ marginBottom: 0 }}><div className="page-header-icon" style={{ background: "#efe7ff", color: "#7c3aed" }}><History size={22} /></div><div><div className="page-title">Historial de Recetas</div><div className="page-subtitle">{loading ? "Cargando historial..." : `${resumen.recetasFinalizadas} recetas finalizadas`}</div></div></div><div className="toolbar-actions"><button className="btn btn-primary" onClick={handleExport}><Download size={15} />Exportar CSV</button></div></div>

      <div className="summary-grid">
        <div className="summary-card"><div className="summary-icon" style={{ background: "#efe7ff", color: "#7c3aed" }}><ClipboardList size={18} /></div><div><div className="summary-value">{resumen.recetasFinalizadas}</div><div className="summary-label">Recetas Finalizadas</div></div></div>
        <div className="summary-card"><div className="summary-icon" style={{ background: "#dff7ea", color: "#0f8a57" }}><ArrowUpRight size={18} /></div><div><div className="summary-value">{resumen.efectividadPromedio.toFixed(1)}%</div><div className="summary-label">Efectividad Promedio</div></div></div>
        <div className="summary-card"><div className="summary-icon" style={{ background: "#dbeafe", color: "#2156d6" }}><Box size={18} /></div><div><div className="summary-value">{resumen.productosCompletos}</div><div className="summary-label">Productos Completos</div></div></div>
        <div className="summary-card"><div className="summary-icon" style={{ background: "#fff0df", color: "#d97706" }}><BarChart3 size={18} /></div><div><div className="summary-value">{resumen.totalProductos}</div><div className="summary-label">Total Productos</div></div></div>
      </div>

      <div className="search-box"><Search size={15} /><input placeholder="Buscar por número, cliente, ingeniero, factura..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} /></div>
      {loading && <div className="empty-state">Cargando historial...</div>}
      {!loading && error && <div className="error-state">Error: {error}</div>}
      {!loading && !error && filtradas.length === 0 && <div className="empty-state">No hay registros para mostrar.</div>}
      {!loading && !error && filtradas.length > 0 && <div className="recipe-list">{filtradas.map((item) => { const isOpen = expanded.includes(item.id); return <div className="history-card" key={item.id}><div className="recipe-head"><div><div className="recipe-topline"><div style={{ fontWeight: 800, fontSize: 18 }}>{item.numero}</div><span className={`pill ${getCumplimientoClass(item.cumplimiento)}`}>{item.cumplimiento}% cumplimiento</span><span className="pill neutral-soft">🧾 {item.factura}</span></div><div className="recipe-columns"><div><div><strong>Ingeniero:</strong> {item.ingenieroNombre}</div><div><strong>Sucursal:</strong> {item.sucursalNombre}</div><div>Finalizada el {formatDate(item.finalizadaAt)}</div></div><div><div><strong>Cliente:</strong> {item.clienteNombre}</div><div><strong>Finca:</strong> {item.fincaNombre}</div></div></div></div><button className="expand-button" onClick={() => toggleExpanded(item.id)}>{isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button></div>{isOpen && <div className="history-product-list"><div style={{ fontWeight: 800 }}>Detalle de Productos ({item.productos.length})</div>{item.productos.map((p, idx) => <div className="history-product-row" key={idx}><div>{p.productoNombre}</div><div style={{ display: "flex", alignItems: "center", gap: 12 }}><div>{p.cantidadEntregada} / {p.cantidadRecetada}</div><span className={`pill ${getCumplimientoClass(p.porcentaje)}`}>{p.porcentaje}%</span></div></div>)}</div>}</div>; })}</div>}
    </div>
  );
}
