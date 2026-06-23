# App Recetas - SQL + PM2 + Cloudflare

## Qué quedó cambiado

- El backend ahora puede cargar **productos/clientes desde SQL Server** para que el inventario, disponible, reservado y precio de venta no dependan de SharePoint.
- SharePoint se mantiene para **usuarios, fincas, ingenieros, sucursales, recetas e historial**.
- En receta de ingeniero se agregaron:
  - `¿Para cuánto es?`
  - `Lotes o cultivos`
  - `Observación general`
  - `Precio total venta` sin mostrar precio unitario.
  - Productos seleccionados siempre visibles para que no desaparezca la cantidad.
- En receta de sucursal/tienda se puede marcar un producto como cambiado y seleccionar el producto sustituto.
- Si se cambia o se entrega menos cantidad, el porcentaje de efectividad se recalcula con base en lo entregado contra lo recetado.
- Se agregó configuración PM2 para correr el API en el servidor.

## Variables importantes

Copie `server/.env.example` a `server/.env` en el servidor y complete los valores reales.

```bash
cp server/.env.example server/.env
```

También deje permitido el dominio del frontend en `CORS_ORIGINS`, por ejemplo `https://TU-FRONTEND.vercel.app`.

Active SQL con:

```env
USE_SQL_CATALOGS=true
SQL_SERVER=172.22.1.7
SQL_DATABASE=CobsysSurco
SQL_USER=usuario_sql
SQL_PASSWORD=clave_sql
SQL_PORT=1433
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERTIFICATE=true
```

El frontend usa:

```env
VITE_API_URL=https://TU-DOMINIO-O-TUNNEL.trycloudflare.com/api
```

En Vercel, configure esa variable en **Settings > Environment Variables** y redeploy.

## SQL esperado

Por defecto el backend busca estas vistas:

```sql
vw_AppRecetas_Productos
vw_AppRecetas_Clientes
```

### Vista sugerida de productos

Debe devolver estos alias mínimos:

```sql
SELECT TOP 5000
  idProducto      AS id,
  codigo          AS codigo,
  Producto        AS nombre,
  Unidad          AS unidad,
  Stock           AS stock,
  Disponible      AS disponible,
  Reservada       AS reservada,
  PrecioVenta     AS precioVenta
FROM vw_AppRecetas_Productos
ORDER BY Producto;
```

### Vista sugerida de clientes

Debe devolver estos alias mínimos:

```sql
SELECT TOP 5000
  idCliente AS id,
  Nombre    AS nombre,
  Apellido  AS apellido,
  Telefono  AS telefono
FROM vw_AppRecetas_Clientes
ORDER BY Nombre, Apellido;
```

Si no quiere crear vistas, puede pegar sus consultas reales en el `.env` usando:

```env
SQL_PRODUCTOS_QUERY=SELECT ...
SQL_CLIENTES_QUERY=SELECT ...
```

## Columnas nuevas recomendadas en SharePoint

El código usa `setIfExists`, entonces no revienta si una columna no existe, pero para guardar todo completo conviene agregarlas.

### Lista `SP_Receta Ingeniero`

- `ClienteSqlId` — Número o texto
- `ClienteNombre` — Texto
- `ParaCuantoEs` — Texto
- `LotesCultivos` — Texto
- `PrecioTotalVenta` — Número
- `Observacion` — Texto multilínea

### Lista `SP_Receta Producto`

- `ProductoSqlId` — Número o texto
- `PrecioVenta` — Número
- `TotalVenta` — Número
- `FueCambiado` — Sí/No
- `ProductoOriginalNombre` — Texto
- `CodigoProductoOriginal` — Texto
- `ProductoCambioNombre` — Texto
- `CodigoProductoCambio` — Texto
- `CambioProducto` — Texto
- `MotivoCambio` — Texto multilínea

### Historial opcional

Si quiere que historial guarde esos mismos datos, cree las mismas columnas nuevas en:

- `SP_Historial`
- `SP_HistorialRecetaProducto`

## Instalar en el servidor

En el servidor Windows, dentro de la carpeta del proyecto:

```powershell
npm install
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

El API queda por defecto en:

```txt
http://localhost:3007/api
```

Comandos útiles:

```powershell
pm2 status
pm2 logs app-recetas-api
pm2 restart app-recetas-api
```

## Cloudflare Tunnel rápido

Para prueba rápida:

```powershell
cloudflared tunnel --url http://localhost:3007
```

Luego ponga en Vercel:

```env
VITE_API_URL=https://URL-QUE-DIO-CLOUDFLARE.trycloudflare.com/api
```

Para producción real, es mejor usar un tunnel nombrado fijo para que no cambie la URL.

## Pruebas rápidas

```powershell
curl.exe http://localhost:3007/api/health
curl.exe http://localhost:3007/api/catalogos/status
curl.exe http://localhost:3007/api/productos
curl.exe http://localhost:3007/api/clientes
```

Si `/api/catalogos/status` devuelve `sqlActivo: true`, el backend está intentando usar SQL para productos/clientes.
