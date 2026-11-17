# DESIGN — Turnos Barbería

> Dirección elegida antes de construir (`/impeccable shape`, 17/11/2026). Cuando la primera pantalla esté construida, este archivo se regenera desde el código real con `/impeccable document`. Hasta entonces, esto es la regla.

## Dirección: "Etiqueta de altura"

**La idea:** cada turno es una **etiqueta numerada**, como la de un vino de altura de Cafayate: fondo oscuro, filetes de cobre y un **bloque técnico** con los datos en columnas (servicio, barbero, día, hora, Nº de turno). Es oscuro, moderno y masculino como pediste, y sale de Salta, no de una plantilla de barbería genérica.

**Lo que evita:** el negro mate con dorado y letra cursiva, el poste rojo y azul, la foto de navaja de fondo. Eso lo hace cualquier barbería.

**Riesgo:** si el guiño al vino se exagera, parece una bodega. Lo que tiene que mandar es el nombre, el logo y las fotos de la barbería. La etiqueta pone el **sistema** (tipografía, color, densidad y una firma). Nunca dibujos de uvas, viñedos ni copas.

### El mundo aporta exactamente cuatro cosas

Son pantallas de trabajo (el dueño opera la agenda, el cliente reserva). El mundo de la etiqueta pone **tipo, paleta, densidad y una firma**. Nunca pone el layout, la navegación ni los controles: los botones, inputs, tabs y selects son los estándar de la web, dibujados en esta paleta.

1. **Tipo:** mayúsculas condensadas para rótulos y cifras tabulares para horas, como el texto de una contraetiqueta.
2. **Paleta:** fondo casi negro con un tinte vino, un rail en malbec y el cobre como acento de acción.
3. **Densidad:** el bloque técnico, con filas compactas de rótulo y valor y filetes de 1px.
4. **Firma:** **el turno como etiqueta numerada**, en la confirmación del cliente y en cada bloque de la agenda.

### Mejoras tomadas de las alternativas descartadas

- **Del campo de datos:** contraste total en la agenda. Hora y nombre se leen a tres metros del mostrador.
- **Del catálogo de convención:** la grilla de horarios usa siempre celdas enteras y se reacomoda sin cortar ninguna.
- **Del folio botánico:** un turno mantiene la misma escala y línea base en todos sus estados (libre, reservado, en curso, cancelado). Lo único que cambia es el color y la marca.
- **Del atlas estelar:** el turno **en curso** lleva un único anillo de cobre. Ningún otro elemento de la pantalla usa ese anillo.

---

## Escena física

- **Cliente:** celular en la mano, a menudo en la calle a pleno sol de Salta, llegando desde Instagram o un QR. El modo oscuro tiene que aguantar el brillo: el texto principal va en hueso sobre casi negro, nunca gris sobre gris.
- **Dueño:** compu del mostrador, con luz cálida de local y vista de reojo entre corte y corte. La agenda se escanea a distancia: horas grandes y nombres en peso medio.

Por eso va oscuro en las dos superficies, y tiene sentido además de ser lo que pediste.

## Paleta (estrategia: comprometida en la estructura, contenida en los datos)

El color hace trabajo real: el rail o encabezado en malbec identifica el local, el cobre marca la acción y el turno en curso, y los colores de estado solo aparecen donde dicen algo.

| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#121012` | Fondo general (casi negro con tinte vino) |
| `--surface` | `#1b1719` | Tarjetas, paneles, filas |
| `--surface-raised` | `#241e21` | Hover, panel lateral, modales |
| `--malbec` | `#6b1f33` | Rail del admin y encabezado del cliente (zona de identidad) |
| `--malbec-deep` | `#2a1a1f` | Fondo de la etiqueta de confirmación |
| `--copper` | `#c0814a` | Acción primaria, anillo "en curso", filetes de la etiqueta |
| `--copper-hairline` | `rgba(192,129,74,.35)` | Filetes de 1px del bloque técnico |
| `--bone` | `#ece4d6` | Texto principal |
| `--muted` | `#a89d92` | Rótulos y texto secundario (contraste ≥ 4.5:1 sobre `--bg`) |
| `--line` | `#2e272a` | Divisores neutros |
| `--ok` | `#6fae86` | Confirmado / asistió / WhatsApp entregado |
| `--warn` | `#d9a441` | Recordatorio pendiente / por vencer |
| `--danger` | `#e0574f` | Cancelado, error, no vino |

Reglas:
- El texto sobre `--copper` va en `--bg`, no en blanco.
- El cobre es escaso: un botón primario por pantalla, el anillo de "en curso" y los filetes de la etiqueta. Si aparece en tres lugares más, sobra.
- Un turno cancelado no desaparece: queda en su lugar, en `--muted` y tachado, con la marca `--danger`.

## Tipografía

Una sola familia con eje de ancho: **Archivo** (Google Fonts, variable `wdth` 62–125, `wght` 100–900), servida desde el proyecto.

| Rol | Ajuste | Ejemplo |
|---|---|---|
| Rótulo de etiqueta | Archivo `wdth 62`, 600, MAYÚSCULAS, tracking +0.08em, 12–13px | `SERVICIO · BARBERO · HORA` |
| Valor del bloque técnico | Archivo `wdth 100`, 500, 16px | `Corte + barba` |
| Hora (cliente) | Archivo `wdth 75`, 700, `tabular-nums`, 20px | `17:30` |
| Hora (agenda del dueño) | Archivo `wdth 75`, 700, `tabular-nums`, 28–32px | `17:30` |
| Nº de turno | Archivo `wdth 62`, 700, `tabular-nums`, tracking +0.04em | `Nº 0142` |
| Título de pantalla | Archivo `wdth 75`, 700, 24–32px | `Agenda de hoy` |
| Cuerpo | Archivo `wdth 100`, 400, 16px, interlineado 1.5 | — |

- Todas las cifras (horas, precios, Nº) van en `font-variant-numeric: tabular-nums`.
- Los precios en pesos van como `$ 12.000`, con punto de miles y sin decimales.
- El texto mínimo en celular es de 16px en inputs, para que iOS no haga zoom.

## La firma: la etiqueta numerada

```
┌───────────────────────────────┐   fondo --malbec-deep
│  [LOGO]  NOMBRE BARBERÍA      │   filete cobre 1px
│ ───────────────────────────── │
│  TURNO              Nº 0142   │   rótulos condensados
│  SERVICIO    Corte + barba    │   filas rótulo / valor
│  BARBERO     Nico             │   filetes --copper-hairline
│  DÍA         Jue 19 nov       │
│  HORA        17:30 → 18:15    │
│  VALOR       $ 12.000         │
│ ───────────────────────────── │
│  SALTA · 1.187 msnm           │   pie chico, --muted
└───────────────────────────────┘
```

- Va **en la confirmación** (el cliente le saca captura) y **en la página del link de cancelación**.
- En la agenda del dueño, cada turno es la versión compacta: la hora a la izquierda en grande y el bloque de dos o tres filas a la derecha.
- El Nº de turno es correlativo y real, sale de la base de datos.
- "1.187 msnm" es la altura de Salta capital: un detalle del lugar, no un reclamo comercial.

## Componentes (estándar, en esta paleta)

- **Botón primario:** fondo `--copper`, texto `--bg`, 48px de alto en celular y 40px en compu, radio de 6px. Uno por pantalla.
- **Botón secundario:** contorno `--line` y texto `--bone`.
- **Acción destructiva (Cancelar turno):** contorno `--danger` y siempre **aislada**, separada de las demás acciones, con confirmación en dos pasos.
- **Celda de horario:** una grilla de celdas enteras con hora en tabular; libre en `--surface`, elegida con borde `--copper`, ocupada no se muestra (el cliente solo ve lo libre).
- **Inputs:** fondo `--surface`, borde `--line`, borde `--copper` con foco. El celular va **sin** prefijo fijo: el cliente lo escribe como le sale (`387 15 412-3456`) y la API lo normaliza, así también entran turistas con `+56…` o `+591…`.
- **Chip de estado:** punto de color más texto. Nunca solo color.
- **Radio:** 6px en controles y 10px en etiquetas y paneles. Sin sombras: la elevación se marca con superficie más clara y filete.

## Movimiento

- Mínimo y funcional: el panel de detalle se desliza 160 ms en un solo eje, la celda elegida cambia de borde sin rebote, y la etiqueta de confirmación aparece con un fundido de 200 ms.
- En la agenda, cuando entra un turno nuevo o se cancela uno, la fila mantiene su lugar y se marca, sin saltos de layout.
- Con `prefers-reduced-motion`, todo es instantáneo.

## Accesibilidad

- WCAG AA: todo par texto/fondo de la tabla de arriba se valida en la build.
- Áreas táctiles de 44px como mínimo en celular.
- El estado nunca depende solo del color (chip con texto, tachado en cancelados).
- Foco visible: anillo `--copper` de 2px con separación.
- Idioma `es-AR`, con voseo en la interfaz: "Elegí", "Reservá", "Tu turno".

## Lo que haría que esto se sienta mal aunque se vea pulido

- Uvas, copas o ilustraciones de viñedo.
- Dorado brillante con cursiva tipo "Barber Shop Est. 1920".
- Grises sobre grises sin contraste al sol.
- Más de un botón cobre por pantalla.
- Agenda con letra chica que obliga al dueño a acercarse a la pantalla.
