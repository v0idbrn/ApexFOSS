<p align="center">
  <img src="assets/icon.png" width="112" alt="Icono de ApexFOSS" />
</p>

<h1 align="center">ApexFOSS</h1>

<p align="center">
  <strong>Una app de entrenamiento gratuita, centrada en la privacidad y sin conexión para Android.</strong><br />
  Planifica tu entrenamiento, ejecútalo con un motor de verdad y guarda cada repetición — cada byte — en tu propio dispositivo.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/plataforma-Android-3DDC84?logo=android&logoColor=white" alt="Plataforma: Android" />
  <img src="https://img.shields.io/badge/React_Native-0.83-61DAFB?logo=react&logoColor=black" alt="React Native 0.83" />
  <img src="https://img.shields.io/badge/Expo-SDK_55-000020?logo=expo&logoColor=white" alt="Expo SDK 55" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/tests-1151%20%2F%2088%20suites-4ade80" alt="1151 pruebas en 88 suites" />
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="#características">Características</a> ·
  <a href="#privacidad-por-diseño">Privacidad</a> ·
  <a href="#instalación">Instalación</a> ·
  <a href="#apoya-a-apexfoss">Apoyo</a> ·
  <a href="#documentación">Documentación</a>
</p>

---

## ¿Por qué ApexFOSS?

- **Sin cuentas, sin servidores, sin anuncios, sin rastreadores.** Tus datos de entrenamiento viven en una base de datos local en tu teléfono — nada se sube a ningún lugar.
- **Funciona sin conexión por diseño.** Toda la app — planificación, ejecución, temporizadores, historial y exportaciones — funciona sin red. La compilación de versión final se genera **sin el permiso INTERNET** (verificado; ver [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)).
- **Un motor de entrenamiento, no una interfaz de juguete.** La ejecución de entrenamientos es un motor puro y determinista, con temporizadores persistentes que sobreviven al reinicio de la app y a la muerte del proceso.
- **Una interfaz coherente.** Un sistema de diseño compartido (tokens, componentes, animación con respeto a la reducción de movimiento, estados vacíos honestos) en lugar de estilos por pantalla.
- **Documentación honesta.** Limitaciones conocidas, una auditoría de seguridad escrita, un mapa de datos y documentos legales en borrador se publican junto al código — no promesas de marketing.

## Características

Todo lo siguiente está implementado en el código actual.

### Planificación del entrenamiento
- Ejercicios, rutinas, bloques, pasos y prescripciones de series con rondas y progresión.
- Tipos de bloque: **normal**, **superset**, **contraste**, **circuito** e **intervalo**.
- Transiciones: **inmediata**, **descanso** (con temporizador) y **avance automático**.
- Notación de tempo por fase (excéntrica / pausa abajo / concéntrica / pausa arriba) y **objetivos de RIR** por prescripción.
- **Vista previa de rutina**: simula una rutina paso a paso (rondas, series, descanso planeado) antes de ejecutarla.
- **Comprobaciones de integridad**: señala rutinas vacías, especificaciones de intervalo ausentes, transiciones huérfanas o circulares y rondas inválidas.

### Ejecución del entrenamiento
- Sesiones persistentes con una instantánea inmutable de la rutina; el estado de ejecución se guarda tras cada acción y **se recupera automáticamente después de que la app sea cerrada**.
- Registro de series con peso, repeticiones, tiempo y distancia, con un **teclado numérico de atleta** para captura rápida con una mano.
- **Deshacer última serie**, saltar serie / saltar descanso, y transiciones inmediatas / con descanso / automáticas.
- Descansos y temporizadores basados en marcas de tiempo absolutas: siguen corriendo con la app en segundo plano y se restauran desde la base de datos al reabrir.
- **Notificaciones** de descanso como avisos — la base de datos sigue siendo la fuente de verdad.
- **Notas de entrenamiento**: anota cómo te fue en el resumen post-entrenamiento; edítalo después desde Historial (guardado con la sesión).

### Entrenamiento de intervalos y tempo
- **Entrenador de intervalos** con modos HIIT, EMOM e intervalos glucolíticos (fases de preparación / trabajo / descanso, rondas, recuperación tras interrupción).
- **Entrenador de tempo** para repeticiones a ritmo, con señales hápticas por fase.
- Mantenimiento de pantalla activa mientras un entrenador está en curso.

### Herramientas del atleta
- **Panel del atleta**: sesión de hoy, volumen y tiempo semanales, racha y acceso rápido a las herramientas siguientes.
- Vista de **carga de entrenamiento** más **tendencias de carga** (comparaciones de volumen y sesiones a 7 y 28 días) y gráfico de **ritmo semanal**.
- **Mapa de distribución muscular** por grupos musculares principales.
- **Test de disponibilidad de respuesta** (taps en 10 segundos, guardado localmente).
- **Autorregulación por RIR**: recomendaciones deterministas de carga para la siguiente serie a partir del RIR objetivo vs. real.
- **Inventario de carga**: indica los discos que posees y la app resuelve — o rechaza — una carga objetivo de barra. El inventario **persiste** entre sesiones.
- **Récords personales**: mejores series y 1RM estimado por ejercicio, calculados desde tu historial.
- **Comparación de sesiones**: elige dos sesiones y ve volumen, series y carga por ejercicio lado a lado.
- **Sustituciones de ejercicios**: alternativas ordenadas para el ejercicio actual con los motivos mostrados (patrón de movimiento, equipo, músculos) — heurísticas transparentes, sin caja negra.

### Portabilidad de datos
- **Exportación CSV** del historial de entrenamiento (segura para hojas de cálculo).
- **Compartición de rutinas** como JSON portable (`.apexroutine`), por hoja de compartición o **código QR**, con enlaces profundos bajo el esquema `apexfoss://`.
- **Copia de seguridad sin conexión** (`.apexbackup`, esquema versionado) con validación y **restauración atómica con reversión** — una restauración fallida deja tus datos intactos.
- **Importación local de archivos** `.apexroutine` y `.apexbackup` mediante selector de archivos del sistema (Fase 5A).
- **Revisión de importación mejorada** que muestra ejercicios coincidentes/no coincidentes, validación de checksum y conflictos de esquema/versión antes de confirmar (Fase 5B).
- **Intents de compartir entrantes** — abre `.apexroutine` o `.apexbackup` desde cualquier gestor de archivos o hoja de compartir directamente en el flujo de importación/restauración (Fase 5C).
- **Informes de entrenamiento** con selector de período (7d/28d/todo), volumen, marcas/e1RM, adherencia, métricas corporales, objetivos y tendencias, exportables como CSV (Fase 5D).
- Centro **Confianza, Seguridad y Legal** dentro de la app: resumen de privacidad, términos, límite de salud, conteo de datos locales y borrado completo local.

## Privacidad por diseño

- **Almacenamiento local primero.** Todos los datos de la app (ejercicios, rutinas, sesiones, registros de series, tests de disponibilidad) permanecen en una base de datos local (WatermelonDB) en tu dispositivo.
- **Sin cuenta, sin backend, sin analítica, sin telemetría.** El proyecto no opera servidores y no envía datos de la app a ningún lugar.
- **Tú controlas tus datos.** Exporta todo como CSV o JSON, comparte rutinas de forma deliberada o elimina todo desde dentro de la app.
- **Las exportaciones salen de tu dispositivo solo por tu acción** — un archivo que exportas puede compartirse, así que trata las exportaciones con cuidado.

Detalles completos: [docs/PRIVACY.md](docs/PRIVACY.md) · inventario de datos: [docs/DATA_MAP.md](docs/DATA_MAP.md)

## Seguridad y confianza

La seguridad se trata como una responsabilidad de ingeniería, **no como una garantía**. Estado actual:

- La compilación de versión final se entrega **sin el permiso INTERNET** y sin depuración (verificado con `aapt`/`apksigner`; ver [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)).
- Límites de importación: tope de tamaño y validación de esquema en importaciones de rutinas/copias; las exportaciones CSV están protegidas contra inyección de fórmulas de hoja de cálculo.
- El borrado local de datos cubre todos los registros de la app, con confirmación antes de eliminar.
- Las carencias conocidas se documentan en lugar de ocultarse: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

Reporta vulnerabilidades según [SECURITY.md](SECURITY.md). Licencias de componentes: [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md).

## Salud y fitness

ApexFOSS ofrece **herramientas generales de fitness y organización del entrenamiento**. No es un dispositivo médico y no ofrece consejo médico, diagnóstico ni tratamiento, ni predice ni previene lesiones. Ver [docs/HEALTH_AND_FITNESS.md](docs/HEALTH_AND_FITNESS.md).

## Arquitectura

```
Interfaz (React Native / NativeWind)
  → estado de aplicación (Zustand, espejo visual únicamente)
    → motor de ejecución de entrenamiento (TypeScript puro)
      → acciones de dominio (modelos WatermelonDB / escritor)
        → SQLite (fuente de verdad local)
```

- **Programación y ejecución están separadas.** Las rutinas son datos editados; iniciar un entrenamiento crea una instantánea de la rutina dentro de la sesión.
- El motor es una función pura: `(definition, cursor, event) → { cursor', effects[] }`. La interfaz nunca interpreta transiciones por su cuenta.
- La verdad de ejecución vive en `cursor_json` (incluido el `expiresAt` absoluto del temporizador); `session_status` / `timer_expires_at` son solo cachés derivadas.
- Las notificaciones son avisos, no estado: los temporizadores se recuperan desde la base de datos, nunca desde el estado en memoria de la interfaz.

## Instalación

ApexFOSS **aún no está publicado en ninguna tienda ni canal** (ni Play Store, ni F-Droid, ni GitHub Release). La publicación está preparada, no completada — ver [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md). Estado: candidato a versión final — en preparación para Google Play (primero pruebas internas) y preparación de envío a F-Droid; sigue el progreso en [docs/DISTRIBUTION_MATRIX.md](docs/DISTRIBUTION_MATRIX.md).

- **Recomendado:** instala el `app-release.apk` firmado de la compilación 1.0.0 actual, obtenido del mantenedor del proyecto, abriéndolo en tu dispositivo Android. Un APK universal para ARM (`arm64-v8a` + `armeabi-v7a`), que requiere **Android 7.0+** (minSdk 24, targetSdk 36). `x86`/`x86_64` (orientados a emuladores) no forman parte del objetivo actual de compatibilidad.
- **Compilar desde el código fuente** es opcional y está documentado para desarrolladores en [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- **Estado de validación:** la compilación 1.0.0 está compilada para versión final con las pruebas automatizadas en verde; la validación final en dispositivo físico y las pruebas con amigos siguen pendientes — ver [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) #21. Un pase previo parcial en dispositivo (Fase 2K, Samsung SM-A045M, Android 14) es evidencia histórica, no validación final.

## Pruebas

```bash
npm test                # 1151 pruebas en 88 suites — motor, persistencia,
                        # temporizadores, migraciones, analítica, portabilidad,
                        # exportación, seguridad, interfaz
npm run typecheck       # TypeScript pasa sin errores
```

- Las compilaciones debug y de versión final se generan localmente (`npm run build:apk`), y el conjunto de permisos del APK de versión final ha sido auditado (ver [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)).
- La CI de GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) ejecuta verificación de tipos y pruebas en cada push y pull request a `main`.
- La suite corre en Jest sin dispositivo conectado. **La validación en dispositivo está pendiente para 1.0.0**: la compilación final aún necesita un pase de humo en dispositivo y pruebas reales con amigos. Un pase histórico parcial en dispositivo (Fase 2K, Samsung SM-A045M, Android 14) cubrió instalación/inicio, Home, autorización de rutinas → previsualización/integridad, inicio de entrenamiento, reanudación de sesión con sincronización del temporizador y persistencia tras reinicio en frío; el resto de la matriz — pausa/reanudación completa del temporizador, flujos de sesión completada, Trust Center, EN/ES — **no** se ejercitó en hardware; ver [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) #21.

## Estado del proyecto

Estado actual, en términos precisos:

- **Implementado:** todo lo listado en [Características](#características).
- **Probado:** 1151 pruebas Jest en 88 suites en verde; verificación de tipos TypeScript en verde; la CI ejecuta ambas en cada push.
- **Compilado para versión final:** los APKs debug y de versión final se generan localmente; el APK de versión final firmado de 1.0.0 está compilado y verificado (paquete `com.apexfoss.app`, versionCode 2, sin permiso INTERNET, no depurable).
- **Validado en dispositivo:** solo un pase histórico parcial (Fase 2K); **la validación final de v1.0 en dispositivo y las pruebas con amigos están pendientes**.
- **Publicado:** no — no se ha enviado nada a ninguna tienda, canal ni GitHub Release.

- **Versión:** 1.0.0 (sin publicar), solo Android, esquema de base de datos local en la versión 12.
- **Distribución:** preparada, no enviada ([docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)).
- **Legal:** existen documentos de privacidad, límite de salud y términos en [docs/](docs/) — los términos son un **borrador pendiente de revisión legal**.
- **Licencia:** GPL-3.0-or-later (ver abajo).

## Hoja de ruta

**Implementado** — todo lo listado en [Características](#características).

**Antes del lanzamiento público** — validación final en dispositivo físico en el equipo del propietario, varios días de pruebas con amigos y correcciones, revisión legal del borrador de términos y, después, publicación en tiendas/canales según [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md). Carencias conocidas restantes: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

**Actualmente no planeado** — iOS, Health Connect, integración con wearables, sincronización en la nube o cuentas, funciones de IA, funciones sociales, entrada por cámara y analítica dentro de la app.

## Documentación

| Documento | Contenido |
| --- | --- |
| [docs/PRIVACY.md](docs/PRIVACY.md) | Política de privacidad completa |
| [docs/DATA_MAP.md](docs/DATA_MAP.md) | Inventario exacto de datos recopilados y almacenados |
| [docs/HEALTH_AND_FITNESS.md](docs/HEALTH_AND_FITNESS.md) | Límite de salud y fitness |
| [docs/TERMS_OF_USE.md](docs/TERMS_OF_USE.md) | Términos de uso (borrador, pendiente de revisión legal) |
| [SECURITY.md](SECURITY.md) | Cómo reportar vulnerabilidades |
| [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) | Hallazgos de la auditoría de seguridad y verificación del APK de versión final |
| [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) | Lista honesta de carencias conocidas |
| [docs/ATHLETE_PLATFORM.md](docs/ATHLETE_PLATFORM.md) | Superficie de la plataforma de atleta (Fase 2J): panel, analítica, herramientas del motor |
| [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) | Canales de distribución, bloqueos y requisitos |
| [docs/DISTRIBUTION_PLAYSTORE.md](docs/DISTRIBUTION_PLAYSTORE.md) | Preparación para Google Play: técnica, ficha, Data Safety, AAB |
| [docs/DISTRIBUTION_FDROID.md](docs/DISTRIBUTION_FDROID.md) | Preparación para F-Droid: compilación desde fuente, dependencias, AntiFeatures |
| [docs/DISTRIBUTION_MATRIX.md](docs/DISTRIBUTION_MATRIX.md) | Tabla de estado de requisitos por canal |
| [docs/STORE_ASSETS.md](docs/STORE_ASSETS.md) | Lista de gráficos de tienda (sin recursos inventados) |
| [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md) | Licencias de componentes de terceros |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Registro de decisiones de arquitectura y producto |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Configuración de desarrollo, compilaciones y lista de verificación de versión final |

## Apoya a ApexFOSS

ApexFOSS es libre y de código abierto. Si te resulta útil, puedes apoyar su desarrollo continuo mediante [GitHub Sponsors](https://github.com/sponsors/v0idbrn), [PayPal](https://paypal.me/amelie615) o [Mercado Pago](https://link.mercadopago.com.ar/openv0id).

El apoyo es totalmente voluntario — la app no tiene muro de pago, ni suscripción, ni anuncios, y funciona sin conexión sin aportar nunca nada.

## Contribuir

Se reciben incidencias y pull requests. Antes de enviar:

- Ejecuta `npm test` y `npm run typecheck` y mantén ambos en verde.
- Preserva la arquitectura: el motor se mantiene puro, WatermelonDB sigue siendo la fuente de verdad y nada nuevo se comunica con la red.
- Nunca subas secretos, llaves de firma, rutas locales del SDK ni artefactos de compilación.
- Reporta problemas de seguridad de forma privada según [SECURITY.md](SECURITY.md), no en incidencias públicas.

## Licencia

ApexFOSS se distribuye bajo la **GNU General Public License v3.0 o posterior** (GPL-3.0-or-later). El texto completo está en [LICENSE](LICENSE). En resumen: puedes usar, estudiar, compartir y modificar este software, y las obras derivadas deben permanecer como software libre bajo la misma licencia. Las licencias de las dependencias de terceros están en [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md); el registro de decisiones está en [docs/DECISIONS.md](docs/DECISIONS.md).

## Descargo de responsabilidad

ApexFOSS es software de fitness general, no software médico. Se ofrece "tal cual", sin garantía de ningún tipo. Ver [docs/HEALTH_AND_FITNESS.md](docs/HEALTH_AND_FITNESS.md) y [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).
