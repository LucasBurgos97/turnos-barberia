# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + Vite (frontend, deploy en Vercel), Node.js + Express (API, deploy en Render), PostgreSQL en Supabase. Elegido por el usuario.

## Users

- **Clientes de la barbería** (principal en volumen): reservan desde el celular, generalmente con apuro, desde el link que la barbería comparte en Instagram/WhatsApp o un QR en el local. No crean cuenta: dejan nombre y celular.
- **Dueño de la barbería** (principal en frecuencia): usa la compu del local para ver y manejar la agenda del día, entre corte y corte.

## Product Purpose

Sistema de turnos online para **una sola barbería** de Salta (Argentina). Reemplaza el ida y vuelta por WhatsApp para pedir turno. Éxito: el cliente reserva en menos de un minuto sin hablar con nadie, y el dueño abre la compu y sabe quién viene, a qué hora y con qué servicio.

## Positioning

Hecho para una barbería concreta, no un marketplace: su nombre, sus barberos, sus servicios, sus horarios. Reserva sin cuenta y recordatorio automático por el canal que el cliente ya usa (WhatsApp).

## Operating Context

- El cliente llega desde Instagram, un estado de WhatsApp o un QR en el local; reserva en el celular, muchas veces en la calle o a la luz del día.
- El dueño atiende con las manos ocupadas; mira la compu del mostrador de reojo. Necesita leer la agenda a distancia.
- Los clientes cancelan con el link que reciben por WhatsApp.
- Horario y moneda locales: America/Argentina/Salta (UTC−3), español rioplatense ("vos").

## Capabilities and Constraints

- Mínimo: reservar turno, cancelar turno, ver agenda del día, recordatorio automático por WhatsApp.
- WhatsApp automático vía API (WhatsApp Cloud API de Meta o Twilio): requiere número verificado, plantillas aprobadas, y tiene costo por mensaje.
- Clientes sin cuenta: identificados por celular; la cancelación se hace con un token único en el link.
- Una sola barbería (single-tenant). Uno o más barberos.
- **Sin decidir:** proveedor exacto de WhatsApp (Meta directo vs. Twilio), cuántas horas antes sale el recordatorio, política de cancelación (hasta cuántas horas antes), si se cobra seña.

## Brand Commitments

- Estilo pedido por el usuario: **moderno, oscuro, masculino**.
- Nombre, logo y fotos de la barbería: aún no provistos.

## Evidence on Hand

Ninguna todavía. No hay nombre, logo, fotos, lista de servicios ni precios reales: no inventarlos como reales; usar datos de ejemplo marcados como tales.

## Product Principles

1. Reservar en tres toques: servicio → horario → nombre y celular.
2. La agenda del día se lee de un vistazo, a distancia.
3. Nadie necesita cuenta salvo el dueño.
4. WhatsApp es el canal: confirmación, recordatorio y cancelación pasan por ahí.
5. Nunca un turno doble: la disponibilidad la decide el servidor.
