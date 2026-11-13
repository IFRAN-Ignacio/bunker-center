# BUNKER — Crossfit & Training

Sitio web del box **Bunker** (Mar del Plata) con backend completo:

- Página pública: clases, horarios, **planes y precios**, **mostrador de productos** (solo vidriera, se compra en el gym), **asistente virtual con IA** (reemplaza al FAQ) y contacto.
- **Registro e inicio de sesión** de socios.
- **Planes** (mensualidad o por actividad) con **pago** por transferencia o en efectivo en el gimnasio (el admin aprueba o rechaza cada pago).
- **Reservas** de clases eligiendo día, horario y lugar.
- **Mi cuenta**: plan vigente, historial de pagos, **calendario mensual de actividades** y perfil.
- **Panel de profes** (`profe.html`): cada profe ve sus clases día por día con **cuántos y quiénes** están anotados, su calendario mensual, y **avisa si falta**. La clase pasa a mostrar "Falta 1 profe" o "Sin profe".
- **Panel de administración** para editar todo: reservas, socios (con su calendario), pagos, actividades y horarios, horario del gimnasio, planes y precios, productos (con foto), **profes** (cuentas, horarios asignados y ausencias), **asistente** (conocimiento extra), bloqueos, avisos, configuración y auditoría.

**Diseño:** Diseño original del proyecto: violeta y negro, Oswald + Montserrat.

> Proyecto escolar de pasantía (7.º año — E.E.S.T. N.º 5 «Amancio Williams»). Preparado para publicarse, pero se usa como **simulación**: los datos para transferir son de prueba.

**Este sitio corre en http://localhost:3000**.

## 0. Forma rápida (Windows)

Doble clic en **`iniciar.bat`**. La primera vez instala todo, crea la base y abre el navegador. Para apagarlo, cerrá la ventana negra. Para borrar los datos de prueba, `reiniciar-base.bat`.

## 1. Requisitos

- **Node.js 20, 22 o 24 (versión LTS)** → https://nodejs.org
- Nada más: la base de datos es **SQLite** (un archivo), no hace falta instalar MySQL.

## 2. Instalación y puesta en marcha

En una terminal (PowerShell o CMD) dentro de esta carpeta:

```bash
npm install                 # instala dependencias
copy .env.example .env      # en Linux/Mac: cp .env.example .env   (si no existe ya)
npm run seed                # crea la base con los datos iniciales y el admin
npm start                   # levanta el servidor
```

Abrir **http://localhost:3000**

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm run dev` | Igual que `start` pero se reinicia solo al guardar cambios |
| `iniciar.bat` / `reiniciar-base.bat` | Lo mismo con doble clic en Windows |
| `npm run seed -- --reset` | **Borra** la base y la vuelve a crear desde cero |

## 3. Usuarios para probar

Se definen en el archivo `.env` (no se sube a ningún lado).

| Rol | Correo | Contraseña | Extra |
|---|---|---|---|
| Admin | el de `ADMIN_EMAIL` | el de `ADMIN_PASSWORD` | Código de 9 dígitos `ADMIN_CODE` |
| Socio demo | `demo@bunker.com` | `Demo1234` | Ya tiene un plan activo y 2 clases reservadas |
| Profe demo | `profe@bunker.com` | `Profe1234` | Martina: da Crossfit |
| Profe demo | `profe2@bunker.com` | `Profe1234` | Lucas: da Crossfit e Híbrido (Crossfit tiene 2 profes por clase) |

Los profes de prueba se crean solo si `SEED_DEMO=true`. En el panel admin, pestaña **Profes**, se crean los reales.

**Datos para transferir (de prueba):** alias `BUNKER.PRUEBA.MDP`, CBU `0000000000000000000000`, titular «Bunker Center (DATOS DE PRUEBA)». Son falsos, solo para simular. Los reales se cargan en el panel admin → **Configuración** → *Pagos y reservas* (ver sección 7).

## 4. Estructura

```
./
├── page/            HTML (index, nosotros, horarios, planes, asistente, productos, login, reserva, cuenta, pago, profe, admin, manual, 404)
├── css/             estilos (los originales + app.css y admin-extra.css)
├── mains/           JavaScript del navegador (api.js = cliente de la API)
├── img/             logo
├── server/
│   ├── seed-data.js DATOS DE ESTE GYM (actividades, horarios, planes, productos, extras del asistente, contacto)
│   ├── server.js    arranque
│   ├── app.js       Express + cabeceras de seguridad + rutas
│   ├── config.js    configuración desde .env
│   ├── seed.js      datos iniciales
│   ├── db/          esquema SQL y conexión
│   ├── security/    sesiones, CSRF, control de acceso, contraseñas
│   ├── routes/      auth, public, reservations, account, teacher (profes), chat (asistente), admin
│   └── services/    reglas de negocio (reservas, pagos, calendario, profes, asistente, conocimiento, imágenes)
├── data/            base de datos (se crea sola, no se sube)
├── uploads/         fotos de productos (se crean desde el panel)
├── knowledge/       lo ÚNICO que lee el asistente: conocimiento_publico.csv (se genera solo) y extras_gym.csv
├── .env.example     plantilla de configuración
└── package.json
```

## 5. Seguridad implementada (desarrollo seguro)

| Riesgo (OWASP) | Cómo se mitiga |
|---|---|
| **Contraseñas expuestas** | Se guardan con **bcrypt** (hash + sal). Nunca en texto plano. Política: mínimo 8 caracteres, letras y números. |
| **Credenciales en el código** | El usuario, contraseña y código del admin están en `.env` (fuera del código y del repositorio) y se guardan hasheados en la base. Antes estaban escritos en `login.js`, visibles con F12. |
| **Robo de sesión** | Token aleatorio de 256 bits en cookie **HttpOnly** (JavaScript no la lee), **SameSite**, y **Secure** en producción. En la base se guarda solo el hash del token. Vencimiento absoluto y por inactividad. Al iniciar sesión se genera un token nuevo (evita *session fixation*). |
| **Fuerza bruta** | Límite de intentos por IP (*rate limiting*) y **bloqueo de cuenta** 15 min tras 5 contraseñas incorrectas. 5 códigos de admin incorrectos cierran la sesión. |
| **Enumeración de usuarios** | El login responde el mismo mensaje y tarda lo mismo exista o no el correo. |
| **Acceso indebido (control de acceso roto)** | El rol se lee de la base en cada petición, nunca del front. El panel exige rol admin **+ segundo factor** (código de 9 dígitos). Cada socio solo puede ver/modificar sus propios pagos y reservas (probado contra IDOR). |
| **CSRF** | Token CSRF (*double submit*) en un header obligatorio para toda petición que modifica datos + verificación del encabezado `Origin`. |
| **Inyección SQL** | Todas las consultas son **parametrizadas** (`?`), nunca se concatena texto del usuario. |
| **XSS** | Todo dato se **escapa** antes de mostrarse (`esc()` en `mains/api.js`). **Content-Security-Policy** que solo permite scripts propios (se eliminaron los `<script>` en línea). |
| **Validación** | Todo lo que llega del cliente se valida en el servidor con **zod** (tipos, largos, formatos, fechas, rangos). La validación del front es solo comodidad. |
| **Subida de archivos** | Máx. 2 MB, solo JPG/PNG/WEBP verificados por su contenido (*magic bytes*), nombre aleatorio generado por el servidor. |
| **Pagos** | No hay pago con tarjeta: la página nunca recibe ni guarda datos de tarjetas. Transferencia y efectivo quedan en revisión hasta que el admin los aprueba. |
| **Cabeceras HTTP** | Helmet: CSP, `X-Content-Type-Options`, `frame-ancestors 'none'` (anti-clickjacking), `Referrer-Policy`, HSTS en producción, sin `X-Powered-By`. |
| **Exposición de archivos** | Solo se sirven las carpetas públicas (`page`, `css`, `mains`, `img`, `uploads`). El código del servidor, `.env` y la base no son accesibles. |
| **Errores** | Al usuario se le muestran mensajes genéricos; el detalle técnico queda solo en el log del servidor. |
| **Trazabilidad** | **Registro de auditoría**: inicios de sesión, intentos fallidos, pagos y cada cambio hecho en el panel (visible en la pestaña Auditoría). |
| **Concurrencia** | Índices únicos + transacciones: dos personas no pueden quedarse con el mismo boleto aunque reserven al mismo tiempo. |
| **Privacidad** | En la grilla de boletos los demás socios ven "Ocupado", no el nombre de quién reservó. El motivo de la ausencia de un profe solo lo ve el admin. |
| **Rol profe** | API propia (`/api/teacher`): solo ve las clases que tiene asignadas (cada consulta filtra por su id), no entra al admin (404), no reserva ni compra planes. |
| **Asistente con IA** | No lee la base: solo dos CSV con datos públicos. La clave de la IA queda en el servidor. Mensajes de máx. 500 caracteres, 10 por minuto y 80 por día por IP, tope diario global y tiempo máximo de respuesta. Las respuestas se muestran como texto (nunca HTML). |
| **Inyección CSV** | Los valores que empiezan con `= + - @` se guardan con apóstrofe para que Excel no los ejecute como fórmulas. |

## 5 bis. Asistente virtual con IA

Reemplaza al FAQ. Está en el inicio (sección "Asistente") y en un botón flotante.

- **De dónde saca la información:** solo de la carpeta `knowledge/`. `conocimiento_publico.csv` se **regenera solo** cada vez que el admin o un profe cambia algo (y al arrancar y cada hora), así siempre dice lo mismo que la página. `extras_gym.csv` tiene lo que no está en la página pero es obvio de gym (traer toalla y botella, llegar antes, etc.) y se edita desde el panel, pestaña **Asistente IA**.
- **Sin clave funciona igual** en "modo sin IA": busca en los mismos CSV y responde con lo que encuentra.
- **Para usar IA de verdad**, en `.env`:

| Proveedor | Variables |
|---|---|
| Google Gemini (tiene capa gratis, clave en https://aistudio.google.com) | `LLM_PROVIDER=gemini` · `LLM_API_KEY=...` |
| Claude (Anthropic) | `LLM_PROVIDER=anthropic` · `LLM_API_KEY=...` |
| OpenAI o compatibles (Groq, OpenRouter) | `LLM_PROVIDER=openai` · `LLM_API_KEY=...` · `LLM_BASE_URL=...` |
| IA local con LM Studio u Ollama (sin internet ni costo) | `LLM_PROVIDER=openai` · `LLM_BASE_URL=http://localhost:1234/v1` · `LLM_MODEL=nombre-del-modelo` |

Opcionales: `LLM_MODEL` (por defecto `gemini-2.5-flash`, `claude-haiku-4-5` o `gpt-4o-mini`), `LLM_DAILY_LIMIT` (tope de consultas por día, 400). Si la IA falla o tarda, responde en modo sin IA.

## 6. Reglas de negocio

- Para reservar se necesita un **plan activo** que cubra esa actividad y fecha (se puede desactivar desde Configuración).
- Planes con **límite semanal** (ej. "3 veces por semana") se respetan de lunes a domingo.
- Reservas con hasta **14 días** de anticipación; cancelación hasta **2 h** antes (ambos editables).
- Si el admin **bloquea un día u horario**, o **cambia/borra un horario**, las reservas afectadas se cancelan y el socio lo ve en su cuenta con el motivo.
- Renovar un plan vigente hace que el nuevo período empiece cuando termina el actual.
- Pagos por transferencia/efectivo quedan **en revisión** hasta que el admin los aprueba. Pagos que quedan sin completar 3 días se cancelan solos.
- El **mostrador** es solo vitrina: muestra precio y disponibilidad; la compra se hace en el box.
- **Profes:** el admin les asigna horarios (un horario puede tener varios profes). Un profe puede avisar que falta hasta que empieza la clase y con hasta 60 días de anticipación, con un motivo. Al reservar, el socio ve "Profe: Ana P.", "Falta 1 profe" o "Sin profe".

## 7. Pagos: transferencia o efectivo (y cómo poner los datos reales)

- **Transferencia:** el socio ve alias, CBU/CVU y titular, transfiere desde su banco e informa el número de operación. El pago queda **en revisión**.
- **Efectivo:** el socio avisa que paga en la recepción. El pago queda **en revisión**.
- El admin, en la pestaña **Pagos**, lo **aprueba** (el plan se activa) o lo **rechaza** (con un motivo que ve el socio).
- No hay pago con tarjeta.

**Cambiar los datos de prueba por los reales del gimnasio** (sin tocar código): entrar como admin → **Configuración** → *Pagos y reservas* → completar **Alias**, **CBU / CVU** (22 dígitos) y **Titular** → **Guardar**. Desde ese momento la página de pago y el asistente muestran los datos nuevos.

Si se quiere que una base nueva arranque ya con los datos reales, se cambian también en `server/seed-data.js` (`transfer_alias`, `transfer_cbu`, `transfer_holder`). Ojo: una base que ya existe no se pisa con el seed; ahí se cambian desde el panel.

## 7 bis. Mostrarla online por un rato (túnel temporal, sin hosting)

La página **no está publicada**: usa el nombre y los datos de un gimnasio real con el que nunca tuvimos autorización. Si hace falta verla desde internet (por ejemplo, para mostrársela a la profe), se usa un **Quick Tunnel de Cloudflare**:

1. Cerrar la ventana negra de `iniciar.bat` si está abierta.
2. Doble clic en **`mostrar-online.bat`**. La primera vez instala `cloudflared` con winget.
3. Muestra (y copia) una dirección `https://….trycloudflare.com/page/index.html` y abre el navegador.
4. Para apagarla: **Ctrl + C** o cerrar la ventana. La dirección deja de existir y no queda nada subido.

No se cambia código ni base: el script solo prende el servidor con `TRUST_PROXY=true` (adelante hay un intermediario con HTTPS) y `ALLOWED_ORIGINS` con la dirección del túnel (para que la defensa de "origen externo" la acepte). Conviene publicar antes un aviso desde el panel: "Proyecto escolar — no es la página oficial del gimnasio".

## 8. Publicar en un servidor

1. Servidor con Node.js LTS (VPS, Render, Railway, etc.).
2. En `.env`: `NODE_ENV=production`, contraseña y código de admin **fuertes**, `SEED_DEMO=false`, y si hay proxy delante `TRUST_PROXY=true`. Si se usa IA, la clave va en `LLM_API_KEY` (nunca en el front).
3. `npm ci --omit=dev && npm run seed && npm start` (idealmente con **pm2** para que se reinicie solo).
4. **HTTPS obligatorio** (Nginx + Let's Encrypt, o el que da el hosting). Con `NODE_ENV=production` las cookies pasan a ser `Secure` y se activa HSTS.
5. Hacer copias de seguridad de `data/bunker.db`, `uploads/` y `knowledge/extras_gym.csv`.
