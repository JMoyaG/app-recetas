# Fix BI Historial v7

Este ajuste corrige el guardado de BI en SharePoint:

- `SP_Historial` ahora mapea columnas nuevas exactas:
  - ParaCuantoEs
  - LoteCultivo
  - ObservacionIngeniero
  - ObservacionEntrega
  - PrecioTotalAprox
- `SP_HistorialRecetaProducto` ahora mapea columnas nuevas exactas:
  - ProductoOriginal
  - ProductoEntregado
  - DosisOriginal
  - DosisEntregada
  - FueEntregado
  - FueCambiado
  - MotivoCambio
  - InventarioAlCrear
  - PrecioAproxProducto
  - CambioDescripcion
- `createItem` ahora reintenta campo por campo si Graph rechaza una columna. Así no se pierde toda la fila de historial por una columna problemática.
- Se evita escribir texto en columnas lookup si no hay ID válido, especialmente con clientes SQL.

Después de subir al server, confirmar una receta nueva y revisar ambas listas de historial.
