# Cambios Recetas UI v2

Cambios incluidos:

- Receta guarda y muestra:
  - ¿Para cuánto es?
  - Lote / Cultivo
  - Observación general del ingeniero
  - Precio aproximado total
- Productos muestran inventario disponible al momento de crear la receta.
- En sucursal la receta se ve más completa, con datos enviados por ingeniería.
- Confirmación de sucursal muestra inventario, dosis y precio aproximado por producto.
- Cambio de producto conserva Original -> Nuevo, motivo y afecta la efectividad del original.
- Historial muestra por qué quedó en 0% o parcial, cambio realizado, motivo, inventario y precio.
- PDF se abre antes del guardado para evitar bloqueo de ventanas emergentes.
- Fallback para SharePoint: si no existen columnas nuevas, la metadata se guarda dentro de Observación/Dosis y se limpia al mostrar.

Importante del precio:

El frontend/backend ya leen `PrecioVenta`, pero si la vista SQL sigue con:

```sql
CAST(0 AS decimal(18,2)) AS PrecioVenta
```

entonces el precio seguirá saliendo en ₡0. Falta conectar ese campo a la tabla real de precios.

Deploy:

1. Subir este código a Git/Vercel para cambios visuales.
2. En Vercel mantener:

```env
VITE_API_URL=https://TU-TUNNEL.trycloudflare.com/api
```

3. En el servidor, copiar `server/index.js` nuevo y reiniciar:

```powershell
pm2 restart app-recetas-api --update-env
```

Si reemplaza todo el proyecto en el server, copie antes el `.env` real desde el backup.
