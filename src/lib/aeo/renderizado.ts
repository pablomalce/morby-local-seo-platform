/**
 * QUÉ IMPIDE ESTE ARCHIVO
 *
 * Que la auditoría AEO diga cuánto texto trae el HTML SERVIDO y no tenga contra
 * qué compararlo. La puerta H2-GO-1 pide los dos números —«los caracteres de
 * texto del HTML sin ejecutar JS frente a los del DOM renderizado»— porque con
 * uno solo no se distingue una página corta de una que se dibuja en el cliente:
 * 300 caracteres servidos es un defecto de contenido si renderizada también
 * tiene 300, y es un defecto de JavaScript si renderizada tiene 3 000.
 *
 * Esto abre la URL en Chromium sin interfaz, espera a que el documento cargue y
 * la red se aquiete, y cuenta el texto del DOM con la MISMA función que cuenta
 * el HTML servido (`textoSinJavaScript` de `lectura.ts`) sobre la
 * serialización del DOM CON SUS SOMBRAS (`html()`, que en Chromium es
 * `DOM.getOuterHTML` con `includeShadowDOM`: ver `chromium.ts`, PU-2).
 *
 * Y EL LADO SERVIDO TAMBIÉN SE MIDE ACÁ, CON LA MISMA EXTRACCIÓN. Con el mismo
 * navegador se abre una segunda pestaña con el JavaScript APAGADO, se le
 * entrega el mismo documento que recibió la primera (de la caché de esta
 * medición: no se pide dos veces) y se cuenta su DOM con la misma función. Es
 * el número que la puerta nombra —«los caracteres de texto del HTML sin
 * ejecutar JS»— leído del mismo documento que el renderizado.
 *
 * NINGÚN LADO APLICA CSS, A PROPÓSITO (GATE-1). Un rastreador que no ejecuta
 * JavaScript tampoco aplica CSS: lee el texto del HTML entero, también el que
 * una hoja de estilos oculta. Contar «lo visible sin JavaScript» (`innerText`)
 * ponía BLOQUEANTE a las páginas SSR que ocultan su texto hasta que corre el
 * JavaScript —`elementor-invisible`, un anti-FOUC en `<html>`, un `<style>`
 * dentro de `<noscript>`—: MEDIDO con Chrome 154 y la ruta, la web de Vulkan
 * (WordPress con Elementor) salía 1 550 servidos contra 4 405, y con el HTML
 * son 5 447. Y del lado renderizado tampoco se aplica: si sólo un lado contara
 * lo oculto, la diferencia la inventaría la extracción. Así, un mega-menú
 * `display: none` servido cuenta de los dos lados, y lo que el JavaScript
 * agrega —visible u oculto— cuenta sólo del renderizado: es texto que el
 * rastreador no recibe. MEDIDO con Chrome 154: P4 sigue rojo (1 669 servidos
 * contra 4 841), y `elementor-invisible`, el anti-FOUC y el `<style>` en
 * `<noscript>` salen verdes (servido igual a renderizado).
 *
 * TRES ESTADOS, Y NINGÚN CERO INVENTADO
 *
 * `medido` trae el número; `fallo` trae un código con nombre —`timeout`,
 * `sin-navegador`, `http_404`, `red-no-publica`…— y NINGÚN número. Un render que
 * no se pudo hacer no es una página vacía: si devolviera 0, «servido 0 contra
 * renderizado 0» se leería como «la página no depende de JavaScript», que es
 * exactamente el verde que la puerta prohíbe. El tercer estado es la AUSENCIA
 * del campo en una lectura vieja, y `hallazgos.ts` lo trata igual que un fallo:
 * no medido.
 *
 * EL NAVEGADOR SALE A URLs QUE ELIGIÓ UN CLIENTE, ASÍ QUE ESTO ES SSRF
 *
 * El sitio sale de `businesses.website`, que carga un usuario, y la página que
 * se abre ejecuta JavaScript ajeno: puede pedir lo que quiera, a donde quiera,
 * con la red de la plataforma. En la función de Vercel eso incluye la API de
 * runtime de Lambda en loopback y, en cualquier nube, la metadata en
 * `169.254.169.254`. Interceptar los pedidos y abortar los que van a una red
 * privada NO alcanza, y está MEDIDO con Chrome contra un servidor canario local
 * (ver `renderizado.integracion.test.ts`):
 *
 *   - un `WebSocket` no pasa por la intercepción de puppeteer: con la
 *     intercepción puesta y el pedido HTTP abortado, el canario recibió el
 *     `UPGRADE`;
 *   - un `<link rel="preconnect">` abre el socket TCP sin hacer ningún pedido
 *     HTTP: el canario contó 3 conexiones con todos los pedidos abortados;
 *   - y aunque se interceptara todo, `continue()` deja que Chromium resuelva el
 *     nombre OTRA VEZ por su cuenta. Entre el examen y la conexión hay una
 *     segunda consulta DNS, y un DNS hostil contesta una IP pública a la
 *     primera y `169.254.169.254` a la segunda (rebinding).
 *
 * Por eso el navegador NO TIENE RED. `chromium.ts` lo arranca con un proxy que
 * no existe (`127.0.0.1:1`, sin la excepción de loopback) y con su resolvedor
 * de nombres apagado: lo que Chromium intente por su cuenta —WebSocket,
 * preconnect, WebRTC, un service worker— muere en su propia máquina. Y TODO
 * pedido que el navegador necesita para dibujar la página lo hace este archivo,
 * en Node, y se lo ENTREGA con `responder()`:
 *
 *   1. sólo `http:` y `https:` salen a la red. `data:`, `blob:` y `about:` son
 *      del propio navegador y no salen; cualquier otro esquema se aborta;
 *   2. sólo los puertos 80 y 443, y nada de `usuario:clave@`;
 *   3. el nombre se resuelve ANTES de pedir, y se rechaza si CUALQUIERA de sus
 *      direcciones no es pública —la misma `esIpPublica` del chequeo de
 *      evidencia de H1.4, no una segunda lista—;
 *   4. el transporte conecta a la dirección examinada, no a una segunda
 *      resolución, y eso es lo que cierra el rebinding;
 *   5. las redirecciones NO las sigue Node: se le entrega el 3xx al navegador,
 *      que pide el destino, y ese pedido nuevo vuelve a pasar por 1–4. Una
 *      redirección a `127.0.0.1` es un pedido más, y se aborta como cualquiera;
 *   6. una respuesta que se declara descarga (`Content-Disposition:
 *      attachment`) no se entrega, y además el navegador tiene las descargas
 *      denegadas (`chromium.ts`);
 *   7. el render no es un relé (SEC-A2): como mucho `maxPedidos` pedidos a la
 *      red y `maxConcurrencia` a la vez —el resto espera su turno—, y un
 *      `POST` a otro sitio que el del documento, como mucho `maxPostsAjenos`
 *      y con un cuerpo de hasta `maxCuerpoAjeno` bytes. MEDIDO por la
 *      revisión con Chrome 155: una página con 3 000 `fetch` a un tercero le
 *      hizo 3 000 pedidos, 580 a la vez, y un `POST` con el cuerpo que eligió
 *      la página, y el render salió `medido`. Los topes son POR PRESUPUESTO,
 *      como los bytes (RT-4): la página tiene los suyos y los marcos de otro
 *      sitio otros iguales, así los cinco reproductores de una página no le
 *      gastan los pedidos ni los turnos. Lo que pasa un tope se aborta como
 *      `presupuesto` y, si es un pedido que decide (abajo), no llegó.
 *
 * La URL inicial pasa por el mismo examen ANTES de arrancar el navegador: un
 * sitio cargado como `http://10.0.0.7/` no cuesta un Chromium, y la consulta
 * DNS que lo decide pasa por `node:dns`, donde la ve el espía de
 * `precondicionRutas.test.ts`.
 *
 * CUÁNDO SE LEE
 *
 * No a la primera quietud de red. MEDIDO con Chrome 154 (P2): una página que
 * pone 8 699 caracteres con un `setTimeout` de 1,5 s, sin pedir nada, salía
 * con 1 669 renderizados —se leía a los ~500 ms de red quieta— y el punto en
 * VERDE con el 84 % del texto dibujado por JavaScript. Lo mismo vale para la
 * hidratación perezosa, `requestIdleCallback` y las secciones que un
 * `IntersectionObserver` dibuja cuando se las ve. Por eso, después de la
 * quietud de red:
 *
 *   1. se recorre la página hasta el final (`desplazar`), para que lo que se
 *      dibuja al verse se dibuje;
 *   2. se lee el texto cada `sondeoMs` hasta que su MÁXIMO no crezca durante
 *      `quietudDomMs`, y se devuelve ese máximo —un carrusel que cambia de
 *      texto sin crecer no impide la lectura, y contar de más del lado
 *      renderizado empuja al rojo, nunca al verde—;
 *   3. si al vencer `topeDomMs` el texto SIGUE creciendo, el número no se
 *      devuelve: `inestable`, y el punto queda «no medido». Un número parcial
 *      sería el verde que la puerta prohíbe.
 *
 * Lo que NO alcanza, dicho: un texto que aparece más de `quietudDomMs`
 * después del último cambio no se ve. Es un umbral escrito, no una medición.
 *
 * Y UN NÚMERO SÓLO VALE SI LLEGÓ LO QUE ESCRIBE EL TEXTO (RT-1)
 *
 * El JavaScript de la página escribe el texto con lo que el transporte le
 * entregó: sus scripts, los datos que esos scripts piden (`xhr`, `fetch`) y
 * sus marcos. Si uno de esos pedidos NO LLEGÓ —`timeout`, `sin-respuesta`,
 * `tls`, `demasiado-grande`, o el presupuesto de bytes o de tiempo ya
 * gastado—, el DOM que se cuenta es el que quedó sin hidratar, o la pantalla
 * de error del cliente. MEDIDO con el headless shell de producción en AL2023
 * con 1 vCPU: una página con un menú servido y el contenido en `app.js` daba
 * `medido 1249/1249` —VERDE— con el bundle demorado 9 s o de 6 MB, y contra
 * el despliegue real, 3 de 43 renders salieron `medido` con chunks de Next.js
 * en `timeout` (uno con «Application error» como todo el texto). Por eso:
 *
 *   1. si al leer queda alguno de esos pedidos EN VUELO, se lo espera y se
 *      vuelve a leer, mientras quede presupuesto; si se acaba con algo en
 *      vuelo, `subrecurso-pendiente`;
 *   2. si alguno no llegó, `subrecurso-<motivo>`, sin número: el punto queda
 *      «no medido», nunca verde.
 *
 * Y LO QUE LA POLÍTICA RECHAZA TAMPOCO LLEGÓ (F2). Un pedido que decide y el
 * examen no deja salir —un puerto que no es 80/443, un esquema, unas
 * credenciales, un método que escribe, una red que no es pública, un tope de
 * SEC-A2— es contenido que esta auditoría NO VIO, y un navegador del público
 * sí puede recibirlo: un `fetch` a `https://sitio:8443/api` le llega a una
 * persona. Antes eso no contaba como «no llegó», y MEDIDO con Chrome 155 por
 * la revisión: un menú servido de 619 y el contenido de 4 499 detrás de ese
 * `fetch` daban `medido 619/619` y el punto VERDE. Ahora es
 * `subrecurso-<motivo>`, y el punto queda «no medido». Vale para los pedidos
 * que DECIDEN según la regla de abajo (RT-4): los de la página, los de sus
 * marcos del mismo sitio o sin URL de red y los de un worker que no es de
 * otro sitio (W-1). Lo que la política le rechaza a un marco de otro sitio,
 * o a su worker, no decide, como no decide lo que no le llega.
 *
 * Lo ÚNICO que no cuenta como «no llegó» es un nombre que NO EXISTE
 * (`no-resuelve`: NXDOMAIN, o sin registros): un navegador del público tampoco
 * lo recibe. Un DNS que no contestó —timeout, SERVFAIL— SÍ cuenta
 * (`dns-sin-respuesta`): antes los dos eran `no-resuelve`, y un bundle cuyo
 * CDN tuvo un timeout de DNS quedaba fuera (PU-3). Y no cuenta lo que no
 * escribe texto: imágenes, fuentes, videos, CSS, y los `ping` y reportes de
 * CSP, que la página no puede leer. Un reporte de CSP se reconoce por su
 * `content-type`, no por su tipo: MEDIDO por la revisión con Chrome 155,
 * Chromium se lo pasa al interceptor como `other` con `POST`, y antes salía
 * al tercero y le gastaba a la página sus `POST` ajenos (ver `esReporte`).
 *
 * NI UN WEBSOCKET (F3). Un `WebSocket` o un `WebTransport` no pasa por el
 * interceptor: muere en el proxy que no existe y no dejaba rastro. MEDIDO
 * por la revisión con Chrome 155: un menú de 619 y un `WebSocket` que
 * escribía 4 499 daban `medido 619/619` y VERDE. Chromium avisa cada intento
 * por CDP (`salidasPropias`: lo dice el navegador, no la página), de la
 * pestaña y de cada worker, y un intento que decide deja el render sin número
 * (`subrecurso-websocket`). Decide con la misma regla que un pedido (RT-4):
 * el de un marco, según el ORIGEN del contexto que lo abrió, que también lo
 * dice Chromium (`chromium.ts`); el de un worker, según el origen de su
 * script (W-1); y si no se sabe, cuenta. MEDIDO con el headless shell 153,
 * que corre los marcos de otro sitio en el mismo proceso: sin ese origen, el
 * `WebSocket` de un reproductor o de un chat en un `<iframe>` de otro sitio
 * dejaba la página «no medida». Es estricto a propósito: un chat que abre un `WebSocket` desde
 * la página misma también la deja «no medida», y es el precio de no dar un
 * verde sin haber visto lo que el socket traía.
 *
 * Los tipos que escriben texto son `script`, `xhr`, `fetch`, `document` (un
 * marco) y `eventsource`, y además `other` cuando no sale de ningún marco:
 * así nombra Chromium el `importScripts` de un worker. MEDIDO por la revisión
 * con Chrome 155 y el headless shell 153 (FV-4), también en main: un worker
 * cuyo `importScripts` no llegaba, o un `EventSource` que no llegaba, dejaban
 * la página `medido 1249/1249`, VERDE. El costo, dicho: una página con un
 * `EventSource` que no se cierra nunca no termina de llegar, y queda
 * `subrecurso-timeout`. Se cuenta de más, nunca de menos.
 *
 * NI LO QUE PIDE UN MARCO DE OTRO SITIO (RT-4)
 *
 * Lo que decide es DESDE DÓNDE sale el pedido, no sólo su tipo. Cuentan los
 * de la página, los de sus marcos del mismo sitio —su JavaScript puede
 * escribir en ella— y los de un worker DEDICADO de la página o de su sitio
 * —sus `fetch`, `xhr` e `importScripts`—, que le puede pasar los datos a la
 * página. Un `SharedWorker` no entra: ver «Lo que NO cubre». No cuentan los
 * que salen de un marco de OTRO sitio, ni de un worker cuyo script es de
 * otro sitio (W-1, abajo), ni la navegación de un marco a otro sitio:
 * mientras su documento sea de otro sitio, la política del mismo origen no
 * le deja escribir en el DOM de la página, y su propio contenido no está en
 * la serialización (`chromium.ts`, PU-2). Ante la duda —un marco
 * `about:blank`, `about:srcdoc`, `blob:` o sin URL, un worker `data:` o
 * de origen opaco, un pedido sin marco que Chromium no atribuyó a ningún
 * worker— cuenta. El sitio se aproxima hacia arriba (los dos últimos rótulos
 * del nombre): se cuenta de más, nunca de menos.
 *
 * La página es el documento CONFIRMADO de la pestaña (`urlDeLaPagina`, que
 * `chromium.ts` lee de `page.mainFrame().url()`), y no el último PEDIDO de
 * navegación. Reproducido por la revisión con Chrome 155 y el headless shell
 * 153 (FV-1): una página que mandaba la pestaña a otro sitio con una
 * navegación que no se confirma —un 204, un archivo que Chromium trata como
 * descarga, un `window.stop()`— seguía siendo el documento que se lee, pero
 * sus propios `fetch` se juzgaban «de otro sitio»: el que no llegaba no
 * contaba, y salía `medido 1249/1249`, VERDE. Y lo que se decide de un pedido
 * se decide al entrar: uno de la página que estaba en vuelo cuando la pestaña
 * intentó irse cuenta igual si después no llega.
 *
 * MEDIDO contra la web real. https://vulkan-studios.com salía
 * `subrecurso-sin-respuesta` en producción (2 de 2), y acá con Chrome 155 con
 * todo lo de la página entregado. El que no llegaba era un `fetch` a
 * `brunhild.challenges.cloudflare.com` —un nombre con SÓLO registros AAAA—
 * desde el desafío de Cloudflare, dentro del reproductor de
 * `player.vimeo.com`, dentro de la página: sin ruta IPv6 no llega, y un Chrome
 * normal en una red sin IPv6 tampoco lo trae (`net::ERR_ADDRESS_UNREACHABLE`).
 * Con el headless shell 153 en un contenedor AL2023 salía
 * `subrecurso-presupuesto` 3 de 3: los `xhr` del video de Vimeo y de los
 * cinco reproductores de YouTube se esperaban como si escribieran texto, y
 * bajaban 25 MB contra 1,35 MB de la página. Con esta regla, 10 de 11
 * corridas con los dos binarios dieron `medido`, 5 892 renderizados contra
 * 5 456 servidos; la otra, un script DE LA PÁGINA que no conectó en 8 s, y
 * eso sigue siendo `subrecurso-timeout`. Por lo mismo, los bytes de esos
 * marcos salen de un presupuesto aparte (`maxBytesDeOtrosSitios`): no le
 * quitan bytes a la página.
 *
 * NI LO QUE PIDE EL WORKER DE UN MARCO DE OTRO SITIO (W-1)
 *
 * MEDIDO en producción el 2026-10-21 a las 06:02 UTC, con el detalle de
 * #124: https://vulkan-studios.com salía `subrecurso-sin-respuesta` por un
 * `fetch` a `brunhild.challenges.cloudflare.com/cdn-cgi/challenge-platform/…`
 * con origen `worker`. Es el mismo `fetch` sólo-IPv6 de arriba, pero esta vez
 * lo hacía un WORKER que crea el desafío de Cloudflare en su marco de
 * `challenges.cloudflare.com`, dentro del de `player.vimeo.com`. Sus pedidos
 * no traen marco, y «sin marco» decidía siempre: el desafío aparece en ~2 de
 * cada 6 corridas, y la medición de la web real era intermitente.
 *
 * Ahora un pedido sin marco se juzga por el ORIGEN DEL SCRIPT DE SU WORKER,
 * que Chromium da por pedido (`urlDelWorker`, ver `chromium.ts`), con la misma
 * aproximación de sitio que los marcos y con el presupuesto de otros sitios.
 * Un worker sólo se construye con un script de SU MISMO origen —o con un
 * `blob:`, que lleva adentro el de quien lo creó (`blob:https://sitio/<uuid>`),
 * o un `data:`, que queda opaco—, así que su origen es el del contexto que lo
 * creó: el worker de un marco de otro sitio es tan ajeno como el marco, y una
 * página no puede crear uno «de otro sitio» para no contar. Un worker de la
 * página, de su sitio o `blob:` de la página decide (`worker`); uno `data:`,
 * de origen opaco, o un pedido sin marco que no se pudo atribuir, decide por
 * la duda, y el detalle lo dice (`sin-origen`). Lo mismo vale para el
 * `WebSocket` que abre un worker (F3).
 *
 * Lo que NO se pudo medir, dicho: el desafío contra la web real. Desde la
 * Mac, con Chrome 155, vulkan-studios.com midió 8 de 8 con esta regla y 8 de
 * 8 con la anterior, y el desafío no apareció en ninguna; con el headless
 * shell en AL2023, con un DNS que contesta AAAA y sin ruta IPv6 como en
 * Vercel, 8 de 10 contra 7 de 10 —los no medidos, de los dos lados, por el
 * plazo total—, y tampoco apareció el `fetch` a `brunhild`. Lo reproduce la
 * integración: página → marco de otro sitio → marco de otro sitio → workers
 * `blob:` y con script propio que piden a un nombre sólo-IPv6 sin ruta.
 *
 * El costo, dicho: el worker de un marco de otro sitio que le trae los datos
 * a la página por `postMessage` tampoco decide («LO QUE NO CUBRE», 2).
 *
 * Y LO QUE TRAE UN WORKER DE LA PÁGINA LLEGA (PRE-SESION-EQUIVOCADA). Un
 * `fetch` de un worker que sí llegaba al interceptor podía no llegarle
 * nunca a la página: puppeteer le contestaba por la sesión del worker, que no
 * lo había pausado, y se tragaba el error. REPRODUCIDO por la revisión con
 * los dos binarios, también en main: un worker `blob:` que hace
 * `importScripts` y después `fetch` daba `medido 1249/1249` y VERDE en todas
 * las corridas. `chromium.ts` le contesta por la sesión que lo pausó, y si no
 * la encuentra, la respuesta no llegó y cuenta.
 *
 * Y CUANDO UN PEDIDO DEJA LA PÁGINA SIN NÚMERO, SE DICE CUÁL
 *
 * Un `subrecurso-<motivo>` solo no se puede diagnosticar. Con el #121 en
 * producción, https://vulkan-studios.com seguía saliendo
 * `subrecurso-sin-respuesta` desde la red de Vercel —en la Mac y en un
 * contenedor `lambda/nodejs:24` medía 5 892 contra 5 456—: el pedido que no
 * llegaba ya era de la página, de su sitio o de un worker, y ni la respuesta
 * ni los logs de Vercel decían cuál. Por eso un fallo `subrecurso-*` lleva
 * `detalle` (`DetalleDelSubrecurso`): el PRIMER pedido que lo decidió —el
 * mismo que da el código—, con su tipo de recurso, su host, su ruta SIN query
 * ni fragmento (un token en la query no sale de este archivo) y cortada a
 * `MAX_RUTA_DEL_DETALLE`, de dónde salió (`OrigenDelPedido`), su motivo, y
 * cuántos pedidos no llegaron en total. El detalle sólo describe: qué pedido
 * decide sigue siendo lo de arriba, y se decide igual que antes.
 *
 * Y CADA PRESUPUESTO DE BYTES SE DESCUENTA MIENTRAS SE BAJA (RED-121-2)
 *
 * No al terminar cada pedido. MEDIDO por la revisión: un marco de otro sitio
 * con 30 `fetch` EN PARALELO de 4,5 MB bajó 40,5 MB contra los 10 MB
 * declarados con Chrome 155, y 36 MB con el headless shell 153; la página y
 * el marco juntos, 81 y 90 MB contra 35. Cada pedido miraba lo que quedaba
 * ANTES de salir, y nadie lo descontaba hasta que llegaba: los treinta veían
 * el presupuesto entero. Ahora el transporte descuenta cada parte del cuerpo
 * al recibirla (`PedidoHttp.presupuesto`) y corta el pedido cuando no
 * alcanza, así que lo bajado entre todos los pedidos en vuelo no pasa el
 * tope. Lo descontado no se devuelve: un pedido que se cortó o no se
 * entregó igual se bajó. Una página cuyo pedido propio se corta así queda
 * `subrecurso-presupuesto`, como antes; uno de otro sitio sólo no sale.
 *
 * LO QUE NO CUBRE, DICHO
 *
 * Reproducido por las revisiones con Chrome 155 y el headless shell 153: la
 * de RT-4 (FV-2, FV-3, FV-4, FV-5, RED-121-4, F4) y la de W-1
 * (W1-FV3-WORKER). Las tres primeras formas salen `medido` y VERDE donde
 * antes de RT-4 —la 2, antes de W-1— se decía `subrecurso-sin-respuesta`:
 * son el costo de no contar lo que pide un marco de otro sitio o su worker,
 * porque al momento del pedido un reproductor caído y un marco de
 * autenticación caído no se distinguen. Las otras tres ya estaban antes. La
 * integración (`renderizado.integracion.test.ts`, «LO QUE NO CUBRE») fija hoy
 * las cuatro primeras: si una cambia, ese test se pone rojo y esta lista se
 * corrige.
 *
 *   1. Un marco de otro sitio que le pasa datos a la página con `postMessage`
 *      y la página escribe texto con ellos (FV-3). Si a ese marco no le llegó
 *      algo —un `fetch` suyo, o su propio DOCUMENTO—, la página escribe menos,
 *      o se queda en «Cargando…», y no se ve. Es la autenticación silenciosa
 *      de muchas SPA: Auth0 con `response_mode=web_message`, el iframe oculto
 *      de MSAL. La página espera el mensaje del marco para pedir lo suyo.
 *   2. Lo mismo, cuando los datos los trae un WORKER de ese marco
 *      (W1-FV3-WORKER): el marco de otro sitio crea un worker —un `blob:`
 *      suyo—, el worker hace el `fetch` y el marco le pasa el texto a la
 *      página. Si no llega, la página escribe menos y sale `medido` y VERDE;
 *      antes de W-1, «sin marco» decidía siempre y era
 *      `subrecurso-sin-respuesta`. También cuando el worker le pide los datos
 *      al SITIO de la página: se juzga desde dónde sale el pedido, no adónde
 *      va, como el `fetch` del marco en el punto 1. REPRODUCIDO por la
 *      revisión con Chrome 155 (5 de 5) y el headless shell 153 (4 de 4), con
 *      el oráculo ROJO. Es el precio de que el worker del desafío de
 *      Cloudflare no deje sin número a la web real: al momento del pedido, los
 *      dos son el `fetch` de un worker de otro sitio que no llegó.
 *   3. Un marco cuyo PRIMER salto es de otro sitio y redirige al origen de la
 *      página (FV-2): el documento del mismo origen sí puede escribir en
 *      `parent`, pero si el primer salto no llega, ese documento nunca carga.
 *      Es el silent-auth de OIDC: iframe → `/authorize?prompt=none` del IdP →
 *      302 → el callback del propio sitio, que escribe o avisa al padre.
 *   4. Un `SharedWorker`: lo que pide no pasa por la intercepción de
 *      puppeteer (FV-4), y muere en la red apagada de Chromium sin que nadie
 *      lo anote. Si la página escribe con eso, escribe menos y no se ve. La
 *      red sigue cerrada: el canario de la integración lo afirma.
 *   5. Un marco de otro sitio que SE NAVEGA a sí mismo al origen de la
 *      página (FV-5): la navegación se intercepta y cuenta —se juzga por la
 *      URL del pedido—, pero con Chrome 155 los subrecursos del documento al
 *      que llega NO pasan por la intercepción: MEDIDO, ni su `script` ni su
 *      `fetch` llegan al interceptor, 3 de 3. No llegan y no se anotan. Con
 *      el headless shell 153, el de producción, sí se interceptan y cuentan,
 *      y con una redirección HTTP en vez de `location.href`, con los dos.
 *   6. `falloDocumento` y `statusDocumento` se miran UNA vez, después de la
 *      quietud de red. Si la página manda la pestaña a otra parte durante el
 *      recorrido o la lectura, y ese salto se rechaza o contesta 4xx/5xx, el
 *      fallo no se ve, y lo que se lee puede ser la página de error de
 *      Chromium y no el sitio.
 *
 * EL TIEMPO
 *
 * `topeMs` es TOTAL: arranque del navegador —en Vercel incluye descomprimir
 * Chromium la primera vez—, navegación, quietud, recorrido, lectura y la
 * pestaña sin JavaScript. La ruta lo corre en paralelo con los pedidos por
 * agente, después de traer la portada (8 s), así que el peor caso es 8 + 40 +
 * 5 de cierre = 53 s, dentro de los 59 s de `maxDuration` de la ruta (59 y no
 * 60 a propósito: ver la ruta; `renderizado.test.ts` suma la cuenta). El
 * navegador se cierra en `finally`, también cuando vence el plazo, y si el
 * cierre se cuelga `chromium.ts` mata el proceso.
 *
 * 40 y no 25 (RT-2). MEDIDO con el headless shell de producción en AL2023 con
 * 1 vCPU: el arranque en frío tardó hasta 7,1 s, una página estática de
 * Next.js hasta 22,9 s en frío —y una de siete corridas, `timeout` a los
 * 24,4 s—, y la web de Vulkan 27,3 s en caliente (`timeout`). Con 25 s, la
 * primera auditoría de una instancia fría no medía sin que el sitio cambiara,
 * y la puerta pide rojo 3/3 y verde 3/3 en la MISMA corrida.
 *
 * LO QUE ESTE ARCHIVO NO SABE
 *
 * No sabe de puppeteer ni de `node:http`: el navegador, el transporte y el DNS
 * se inyectan, como `peticion.ts` inyecta `fetch`. Así los tests recorren la
 * secuencia entera —redirección a loopback, subrecurso a la metadata, nombre que
 * resuelve a `10.x`— con dobles, y además con el Chromium de verdad.
 */
import { esIpPublica, type Resolucion } from "@/lib/profile/evidenceCheck";
import { textoSinJavaScript } from "./lectura";

// ─────────────────────────────────────────────────────────────────────────────
// El resultado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Por qué el examen de un destino lo rechazó, antes de cualquier conexión.
 * `dns-sin-respuesta` NO es una política: el DNS no contestó (timeout,
 * SERVFAIL, cancelado), y un subrecurso así NO LLEGÓ —RT-1 lo cuenta—, a
 * diferencia de `no-resuelve`, que es un nombre que no existe (PU-3).
 */
export type MotivoDeBloqueo =
  | "esquema"
  | "credenciales"
  | "puerto"
  | "red-no-publica"
  | "no-resuelve"
  | "dns-sin-respuesta";

/** Por qué el transporte no trajo una respuesta. */
export type MotivoDeTransporte = "timeout" | "sin-respuesta" | "tls" | "demasiado-grande";

/**
 * Por qué un pedido que decide NO LLEGÓ (RT-1): el transporte no lo trajo, se
 * pasó un tope, o la política no lo dejó salir (F2). Todo menos un nombre que
 * no existe (`no-resuelve`), que tampoco le llega a un navegador del público.
 */
export type MotivoDeNoLlegada =
  | MotivoDeTransporte
  | Exclude<MotivoDeBloqueo, "no-resuelve">
  | "presupuesto"
  | "metodo"
  | "descarga";

/** Lo que la página intentó abrir por fuera del interceptor, y Chromium avisó (F3). */
export type SalidaPropia = "websocket" | "webtransport";

/**
 * Lista cerrada más `http_<status>`. Un motivo libre sería texto, y lo que se
 * hace con esto es decidir un color.
 */
/** Un pedido que decide y no llegó, que seguía en vuelo al leer, o un socket propio (RT-1, F2, F3). */
export type MotivoDeSubrecurso = MotivoDeNoLlegada | "pendiente" | SalidaPropia;

export type CodigoDeFallo =
  | "timeout"
  | "sin-navegador"
  | "navegacion"
  | "lectura"
  | "lectura-servida"
  | "inestable"
  | "descarga"
  | MotivoDeBloqueo
  | MotivoDeTransporte
  | `subrecurso-${MotivoDeSubrecurso}`
  | `http_${number}`;

/**
 * De dónde salió un pedido que escribe texto: SÓLO para decir cuál fue, no
 * para decidir si cuenta (eso es `escribeTexto`). Se lee de lo mismo que
 * `deOtroSitio`, al entrar el pedido:
 *
 *   - `pagina`: del documento de la pestaña —su marco es el de la página—;
 *   - `mismo-sitio`: de un marco con URL `http(s)` del sitio de la página, o
 *     la navegación de un marco a ese sitio;
 *   - `worker`: sin marco, de un worker dedicado cuyo script es de la página
 *     o de su sitio —o con la página todavía sin documento confirmado—;
 *   - `sin-origen`: sin marco, y sin un worker con origen de red: un worker
 *     `data:` o de origen opaco (`blob:null/…`), o un pedido que Chromium no
 *     atribuyó a ningún worker. Cuenta por la duda (falla cerrado), y el
 *     nombre dice que la atribución no se pudo hacer;
 *   - `marco-desconocido`: de un marco sin URL de red —`about:blank`,
 *     `about:srcdoc`, `blob:`—, o con la página todavía sin documento
 *     confirmado: cuenta por la duda, y no se sabe más que eso.
 *
 * Un `<iframe>` del mismo sitio con la MISMA URL que la página sale `pagina`:
 * la URL es lo único que el pedido trae para distinguirlos.
 */
export type OrigenDelPedido = "pagina" | "mismo-sitio" | "worker" | "sin-origen" | "marco-desconocido";

/** El largo máximo de `ruta` en el detalle: lo que se ve en la pantalla y en un log. */
export const MAX_RUTA_DEL_DETALLE = 120;

/**
 * El PRIMER pedido que dejó el render sin número (`subrecurso-<motivo>`), sin
 * la query, ni el fragmento, ni credenciales (que el examen ya rechaza). Ver
 * «SE DICE CUÁL» en el encabezado. Lo que NO tapa, dicho: un token escrito
 * en la RUTA misma (`/s/<token>/app.js`) sale como está, cortado a
 * `MAX_RUTA_DEL_DETALLE`.
 */
export interface DetalleDelSubrecurso {
  /** El tipo de recurso como lo nombra Chromium: `script`, `fetch`, `document`… */
  tipo: string;
  host: string;
  /** La ruta de la URL, sin query ni fragmento, de `MAX_RUTA_DEL_DETALLE` caracteres como mucho. */
  ruta: string;
  origen: OrigenDelPedido;
  motivo: MotivoDeSubrecurso;
  /** Cuántos pedidos que escriben texto no llegaron, éste incluido, contando los que seguían en vuelo. */
  noLlegaron: number;
}

export type ResultadoRenderizado =
  | {
      estado: "medido";
      /** Los caracteres de texto del DOM CON JavaScript (sin aplicar CSS). */
      caracteres: number;
      /**
       * Los caracteres de texto del HTML SIN JavaScript: el mismo documento en
       * una pestaña con el JavaScript apagado, con la misma extracción.
       * Opcional para que las lecturas viejas sigan valiendo; sin él, la regla
       * usa el conteo del HTML que trajo la ruta.
       */
      servidos?: number;
    }
  | {
      estado: "fallo";
      codigo: CodigoDeFallo;
      /** Sólo en un `subrecurso-<motivo>`: cuál pedido lo decidió. */
      detalle?: DetalleDelSubrecurso;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se inyecta
// ─────────────────────────────────────────────────────────────────────────────

/** Un pedido ya examinado: la dirección a la que se conecta está decidida. */
export interface PedidoHttp {
  url: string;
  /** La dirección que pasó el examen. El transporte conecta ACÁ, no re-resuelve. */
  ip: string;
  /**
   * Las OTRAS direcciones del mismo nombre, todas examinadas, en orden (IPv4
   * primero): si la conexión a `ip` no se establece, el transporte prueba la
   * siguiente dentro del mismo plazo (PU-3). Ninguna es de una segunda
   * resolución.
   */
  alternativas?: string[];
  metodo: string;
  encabezados: Record<string, string>;
  cuerpo?: string;
  timeoutMs: number;
  /** Bytes de cuerpo como máximo, ya descomprimido. Pasado eso, `demasiado-grande`. */
  maxBytes: number;
  /**
   * El presupuesto de bytes que este pedido COMPARTE con los que van en
   * paralelo (RED-121-2): el transporte le pasa cada parte del cuerpo al
   * recibirla, y si devuelve `false` corta el pedido como
   * `demasiado-grande` —el interceptor sabe que fue el presupuesto y lo
   * anota así—. Sin esto, cada pedido paralelo veía el presupuesto entero.
   * Lo usa el navegador; los pedidos de la ruta (`red.ts`) no lo pasan.
   */
  presupuesto?: (bytes: number) => boolean;
  /**
   * Sólo el status y los encabezados: el cuerpo no se lee y la conexión se
   * corta. Lo usan los pedidos de la ruta que preguntan «¿cómo trata el sitio a
   * este agente?» (`red.ts`), no el navegador, que necesita el cuerpo.
   */
  sinCuerpo?: boolean;
}

export type RespuestaHttp =
  | {
      tipo: "respuesta";
      status: number;
      encabezados: Record<string, string | string[]>;
      cuerpo: Buffer;
    }
  | { tipo: "error"; motivo: MotivoDeTransporte };

export type Transporte = (pedido: PedidoHttp) => Promise<RespuestaHttp>;

/** El DNS: TODAS las direcciones del nombre. La señal corta la consulta. */
export type Resolvedor = (host: string, senal: AbortSignal) => Promise<Resolucion>;

/** Un pedido que el navegador quiere hacer, detenido antes de salir. */
export interface PedidoDelNavegador {
  url: string;
  metodo: string;
  encabezados: Record<string, string>;
  cuerpo?: string;
  /** El tipo de recurso como lo nombra Chromium: `document`, `script`, `image`… */
  tipo: string;
  /** La navegación del documento de la pestaña, incluido cada salto de redirección. */
  esDocumentoPrincipal: boolean;
  /**
   * La URL del documento del MARCO desde el que sale el pedido: la de la
   * página para lo que pide la página, la de un `<iframe>` para lo que pide
   * ese marco (RT-4). `null` si no sale de un marco —un worker— o no se sabe.
   * En la navegación de un marco (`document` que no es el principal) no se
   * usa: ahí el marco todavía tiene el documento anterior, y manda la URL del
   * pedido.
   */
  urlDelMarco: string | null;
  /**
   * Para un pedido SIN marco: la URL del script del WORKER del que sale, como
   * la dice Chromium —el `documentURL` del pedido en la sesión de CDP de ese
   * worker (`chromium.ts`)—, y no la página. `null` si no sale de un worker o
   * no se supo de cuál: entonces el pedido cuenta (falla cerrado). Con marco
   * no se usa: manda el marco. De esta URL sale el ORIGEN del worker, que es
   * el de quien lo creó: un worker sólo se construye con un script de su
   * mismo origen, o con un `blob:` que lleva ese origen adentro.
   */
  urlDelWorker: string | null;
  /**
   * La URL del documento CONFIRMADO de la pestaña cuando sale el pedido —el
   * que se lee—, no la del último PEDIDO de navegación (RT-4, FV-1). Una
   * navegación de la pestaña que no se confirma —un 204, una descarga
   * denegada, un `window.stop()`, una que sigue en vuelo— no cambia el
   * documento ni esto. `null`, o una URL que no es `http(s)` —`about:blank`
   * antes de la primera navegación—, no dice de qué sitio es la página, y el
   * pedido cuenta como de ella.
   */
  urlDeLaPagina: string | null;
  /** Sólo para lo que no sale a la red: `data:`, `blob:`, `about:`. */
  continuar(): Promise<void>;
  abortar(): Promise<void>;
  responder(respuesta: {
    status: number;
    encabezados: Record<string, string | string[]>;
    cuerpo: Buffer;
  }): Promise<void>;
}

export interface PaginaAbierta {
  /** Desde que esto resuelve, TODO pedido de la página pasa por `atender`. */
  interceptar(atender: (pedido: PedidoDelNavegador) => Promise<void>): Promise<void>;
  /** Navega hasta el `load` del documento, o rechaza: bloqueado, red, plazo. */
  navegar(url: string, timeoutMs: number): Promise<void>;
  /** Espera a que la red se aquiete, como mucho `timeoutMs`. Nunca rechaza. */
  esperarQuietud(timeoutMs: number): Promise<void>;
  /**
   * Recorre la página de arriba abajo, una ventana por vez, como mucho
   * `timeoutMs`: lo que se dibuja al verse (`IntersectionObserver`, carga
   * perezosa) se dibuja. Nunca rechaza.
   */
  desplazar(timeoutMs: number): Promise<void>;
  /**
   * El DOM serializado, tal como está ahora, CON cada shadow root de autor
   * como `<template shadowrootmode>` (PU-2): `outerHTML` las deja afuera, y
   * el contenido que un componente dibuja en su sombra no contaba. La
   * extracción del texto es de este archivo —`textoSinJavaScript`, la misma
   * del HTML servido—, no del navegador: ver «NINGÚN LADO APLICA CSS» arriba.
   */
  html(): Promise<string>;
  /**
   * Lo que la página —sus marcos o sus workers— intentó abrir SIN pasar por
   * `interceptar`: un `WebSocket` o un `WebTransport`, que el navegador sin
   * red nunca conecta. Lo avisa Chromium (F3); la página no lo puede borrar.
   */
  salidasPropias(): SalidaPropiaVista[];
}

/**
 * Un `WebSocket` o `WebTransport` que Chromium avisó (F3), con lo necesario
 * para juzgarlo con la regla de RT-4. Todo lo dice el navegador, no la página.
 */
export interface SalidaPropiaVista {
  url: string;
  tipo: SalidaPropia;
  /** Lo abrió un worker: Chromium lo avisó en la sesión del worker. */
  deUnWorker: boolean;
  /**
   * Si lo abrió un worker, la URL de su script como la da Chromium para esa
   * sesión (`worker.url()`), o `null` si no se supo: se juzga con la misma
   * regla que los pedidos de un worker (`urlDelWorker` del pedido).
   */
  urlDelWorker: string | null;
  /**
   * El ORIGEN del contexto que lo abrió (`https://www.youtube.com`), como lo
   * da Chromium para ese contexto, o `null` si no se supo cuál fue. Ver
   * `chromium.ts`.
   */
  origenDelMarco: string | null;
  /** El documento CONFIRMADO de la pestaña cuando Chromium lo avisó (FV-1). */
  urlDeLaPagina: string | null;
}

export interface NavegadorAbierto {
  /**
   * `javascript: false` es la pestaña del lado servido: no corre ningún
   * script. Su `<noscript>` se parsea como elementos y el de la pestaña con
   * JavaScript como texto crudo; `textoSinJavaScript` lo saca de los dos.
   */
  nuevaPagina(opciones?: { javascript?: boolean }): Promise<PaginaAbierta>;
  /** Cierra, y si no cierra a tiempo, mata. Nunca rechaza. */
  cerrar(): Promise<void>;
}

export type AbrirNavegador = () => Promise<NavegadorAbierto>;

export interface DependenciasRender {
  abrirNavegador: AbrirNavegador;
  transporte: Transporte;
  resolver: Resolvedor;
  /** El reloj y la espera van juntos: un test con reloj propio no duerme de verdad. */
  ahora?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

export interface OpcionesRender {
  /** Presupuesto TOTAL: arranque, navegación, quietud y lectura. */
  topeMs: number;
  /** Plazo de cada pedido que hace el transporte. */
  plazoPorPedidoMs: number;
  /** Cuánto se espera, después del `load`, a que la red quede quieta. */
  quietudMs: number;
  /** Cuánto se recorre la página, como mucho, para que se dibuje lo perezoso. */
  desplazarMs: number;
  /** Cuánto tiempo sin que el texto crezca hace falta para leerlo. */
  quietudDomMs: number;
  /** Cada cuánto se vuelve a leer el texto mientras se espera esa quietud. */
  sondeoMs: number;
  /** Cuánto se espera esa quietud, como mucho: pasado esto, `inestable`. */
  topeDomMs: number;
  /** Cuánto se espera al cierre antes de matar el proceso. */
  cierreMs: number;
  maxBytesPorRespuesta: number;
  /**
   * Bytes de lo que pide la PÁGINA —el documento, sus subrecursos y sus
   * marcos del mismo sitio—, sumados MIENTRAS SE BAJAN: también con pedidos
   * en paralelo, lo bajado no pasa esto (RED-121-2).
   */
  maxBytesTotales: number;
  /**
   * Bytes de lo que piden los marcos de OTRO SITIO, sumados igual, en un
   * presupuesto aparte: no escriben el texto que se cuenta (RT-4), y no le
   * pueden quitar bytes a la página. MEDIDO en https://vulkan-studios.com:
   * sus cinco reproductores de YouTube y uno de Vimeo bajaron de 8,4 a 25 MB
   * por corrida, contra 1,35 MB de la página. Con los dos presupuestos, una
   * medición baja como mucho 25 + 10 MB.
   */
  maxBytesDeOtrosSitios: number;
  /**
   * Pedidos a la red por medición, como mucho, en CADA presupuesto: los de la
   * página y los de los marcos de otro sitio, por separado (SEC-A2). Pasado
   * esto, `presupuesto`.
   */
  maxPedidos: number;
  /** Pedidos en el transporte a la vez, como mucho, en cada presupuesto (SEC-A2). El resto espera turno. */
  maxConcurrencia: number;
  /** Pedidos con cuerpo (`POST`) a OTRO sitio que el del documento, como mucho, en cada presupuesto (SEC-A2). */
  maxPostsAjenos: number;
  /** Bytes de cuerpo de un `POST` a otro sitio, como mucho (SEC-A2). */
  maxCuerpoAjeno: number;
}

/**
 * Los topes de SEC-A2 son un juicio, como los demás, y están escritos acá:
 * 200 pedidos alcanzan con margen para una página real —sin imágenes,
 * fuentes ni videos, que no salen—, MEDIDO contra vulkan-studios.com por la
 * revisión: 33 pedidos de la página. 16 a la vez no frenan una página con 60
 * scripts. Y 20 `POST` a otros sitios dejan pasar la analítica que manda por
 * `fetch`/XHR (Clarity, Segment) sin que el render sea un relé. Cada
 * presupuesto tiene los suyos (RT-4): una medición hace como mucho 400
 * pedidos, 32 a la vez y 40 `POST` ajenos de 64 KB, y con el tope de la ruta
 * (10 auditorías por minuto) una instancia le puede mandar a terceros, como
 * mucho, 4 000 pedidos y 400 `POST` por minuto. Antes, 30 000.
 */
export const OPCIONES_RENDER: OpcionesRender = {
  topeMs: 40_000,
  plazoPorPedidoMs: 8_000,
  quietudMs: 3_000,
  desplazarMs: 2_000,
  quietudDomMs: 2_000,
  sondeoMs: 250,
  topeDomMs: 8_000,
  cierreMs: 5_000,
  maxBytesPorRespuesta: 5 * 1024 * 1024,
  maxBytesTotales: 25 * 1024 * 1024,
  maxBytesDeOtrosSitios: 10 * 1024 * 1024,
  maxPedidos: 200,
  maxConcurrencia: 16,
  maxPostsAjenos: 20,
  maxCuerpoAjeno: 64 * 1024,
};

// ─────────────────────────────────────────────────────────────────────────────
// El examen de un destino
// ─────────────────────────────────────────────────────────────────────────────

export type Examen =
  | { ok: true; ip: string; /** Las demás direcciones del nombre, ya examinadas. */ alternativas?: string[] }
  | { ok: false; motivo: MotivoDeBloqueo };

const ESQUEMAS_DE_RED = new Set(["http:", "https:"]);
/** No salen a la red: el contenido ya está en el navegador. */
const ESQUEMAS_LOCALES = new Set(["data:", "blob:", "about:"]);

/**
 * La IP escrita en la URL, sin corchetes, o null si el host es un nombre.
 *
 * Se apoya en que el `URL` de WHATWG ya normalizó el host: `http://2130706433/`,
 * `http://0x7f000001/` y `http://127.1/` llegan acá como `127.0.0.1`, y una IPv6
 * llega siempre entre corchetes. Por eso alcanza con mirar la forma, y no hace
 * falta `node:net` en este archivo.
 */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function ipLiteral(hostname: string): string | null {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname.slice(1, -1);
  if (IPV4.test(hostname)) return hostname;
  return null;
}

/**
 * Examina un destino ANTES de cualquier conexión, y devuelve la dirección a la
 * que hay que conectar. Un examinador por medición, con su caché por nombre: el
 * mismo host da la misma dirección en toda la página, y un recurso no le
 * cuesta otra consulta DNS a cada imagen.
 */
export type Examinador = (url: URL, senal: AbortSignal) => Promise<Examen>;

export function crearExaminador(resolver: Resolvedor): Examinador {
  const cache = new Map<string, Promise<Resolucion>>();

  return async function examinar(url: URL, senal: AbortSignal): Promise<Examen> {
    if (!ESQUEMAS_DE_RED.has(url.protocol)) return { ok: false, motivo: "esquema" };
    if (url.username !== "" || url.password !== "") return { ok: false, motivo: "credenciales" };
    const puerto = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
    if (puerto !== 80 && puerto !== 443) return { ok: false, motivo: "puerto" };

    // Una IP escrita en la URL no se resuelve: se examina tal cual. Una pública
    // pasa —un recurso servido por IP es raro, no peligroso—; cualquier otra no.
    const literal = ipLiteral(url.hostname);
    if (literal !== null) {
      return esIpPublica(literal) ? { ok: true, ip: literal } : { ok: false, motivo: "red-no-publica" };
    }

    const host = url.hostname.toLowerCase();
    let resolucion = cache.get(host);
    if (!resolucion) {
      // Un resolvedor que TIRA no dijo que el nombre no exista: no contestó.
      resolucion = resolver(host, senal).catch((): Resolucion => ({ ok: false, transitorio: true }));
      cache.set(host, resolucion);
    }
    const r = await resolucion;
    if (!r.ok) return { ok: false, motivo: r.transitorio ? "dns-sin-respuesta" : "no-resuelve" };
    if (r.direcciones.length === 0) return { ok: false, motivo: "no-resuelve" };
    // TODAS públicas, no alguna: un nombre con una A pública y otra privada
    // deja que la conexión elija, y quien elige es el atacante.
    if (!r.direcciones.every(esIpPublica)) return { ok: false, motivo: "red-no-publica" };
    // IPv4 primero, sea cual sea el orden del DNS: una función sin ruta IPv6
    // no puede conectar a una AAAA (PU-3), y las demás quedan de alternativa.
    const ordenadas = [...r.direcciones.filter((d) => IPV4.test(d)), ...r.direcciones.filter((d) => !IPV4.test(d))];
    const [ip, ...alternativas] = ordenadas;
    return alternativas.length > 0 ? { ok: true, ip, alternativas } : { ok: true, ip };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// El interceptor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los métodos que se mandan. `PUT`, `DELETE`, `PATCH` y el resto no salen
 * nunca. `POST` SÍ sale —GraphQL y muchas APIs leen con `POST`, y la analítica
 * escribe con él—, pero a otro sitio que el del documento sólo dentro de
 * `maxPostsAjenos` y `maxCuerpoAjeno` (SEC-A2): con cuerpo elegido por la
 * página, sin tope, el render era un relé desde las IP de la plataforma.
 */
const METODOS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);

/**
 * Tipos de recurso que no cambian el texto del DOM: una imagen, un video o una
 * fuente no agregan ni quitan un carácter. Se abortan para que el presupuesto
 * de tiempo y de bytes vaya a lo que sí lo cambia —el documento, los scripts y
 * los datos que traen los scripts—. El `alt` de una imagen es un atributo, y
 * tampoco cuenta. Un `ping` (`sendBeacon`, `<a ping>`) y un reporte de CSP
 * tampoco: la página no puede leer su respuesta, y son justo el `POST` con
 * cuerpo propio que hace del render un relé (SEC-A2).
 *
 * `csp_violation_report` no lo nombra así ningún Chromium: puppeteer da el
 * tipo de CDP en minúsculas (`cspviolationreport`), y en Chrome 155 un
 * reporte de `report-uri` llega como `other` (CSP-SIN-TEXTO-MUERTO). Se queda
 * por unión; el reporte se reconoce en `esReporte`.
 */
const SIN_TEXTO = new Set(["image", "media", "font", "ping", "csp_violation_report", "cspviolationreport"]);

/**
 * El cuerpo de un reporte que arma el NAVEGADOR: `report-uri` de CSP
 * (`application/csp-report`) y el Reporting API (`application/reports+json`).
 */
const CUERPO_DE_REPORTE = /^\s*application\/(?:csp-report|reports\+json)\s*(?:;|$)/i;

/**
 * Si el pedido es un reporte del navegador —de CSP o del Reporting API—, que
 * no escribe texto y no tiene por qué salir (CSP-SIN-TEXTO-MUERTO). MEDIDO
 * por la revisión con Chrome 155 y una página con `report-uri` a un tercero
 * y 30 imágenes bloqueadas: el interceptor vio 30 `other POST` por pestaña,
 * al tercero le llegaron 20 con el cuerpo que arma el navegador, y el `fetch`
 * con el contenido que la página hacía después quedaba sin `POST` ajenos:
 * `subrecurso-presupuesto` donde main medía.
 *
 * Se reconoce por el `content-type` del pedido, y SÓLO en un tipo con el que
 * la página no escribe: `other` —como lo pasa Chromium— y
 * `cspviolationreport`. Un `fetch` o un `xhr` con ese `content-type` lo arma
 * la página, que sí lee su respuesta: sigue el camino de cualquier pedido, y
 * si decide y no sale, no llegó (F2). Si no, una página podía esconder un
 * pedido que escribe detrás de un `content-type`.
 */
function esReporte(pedido: PedidoDelNavegador): boolean {
  if (pedido.tipo !== "other" && pedido.tipo !== "cspviolationreport") return false;
  return Object.entries(pedido.encabezados).some(
    ([nombre, valor]) => nombre.toLowerCase() === "content-type" && CUERPO_DE_REPORTE.test(valor)
  );
}

/** Encabezados que no se reenvían: son del salto, o los pone el transporte. */
const DEL_SALTO = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "accept-encoding",
  "content-length",
]);

/** Los que no se le devuelven al navegador: el cuerpo ya viene decodificado y medido. */
const DE_LA_RESPUESTA = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

export interface Bitacora {
  /** Cada pedido que no salió, con su motivo. Para los tests y para el diagnóstico. */
  bloqueados: Array<{ url: string; motivo: MotivoDeBloqueo | MotivoDeTransporte | "metodo" | "sin-texto" | "descarga" | "presupuesto" }>;
  /** Cada pedido que el transporte hizo de verdad, con la dirección a la que conectó. */
  pedidos: Array<{ url: string; ip: string }>;
  /** El status del documento principal, el último de la cadena de redirecciones. */
  statusDocumento: number | null;
  /** Si un salto del documento principal no salió, por qué. */
  falloDocumento: CodigoDeFallo | null;
  /**
   * Los pedidos que DECIDEN —escriben texto y salen de donde se puede
   * escribir en la página (RT-4)— y no llegaron: por el transporte, por un
   * tope o por la política (F2). Uno solo deja el render sin número.
   */
  noLlegaron: Array<{
    url: string;
    tipo: string;
    motivo: MotivoDeNoLlegada;
    origen: OrigenDelPedido;
  }>;
  /** Cuántos de esos pedidos están en camino ahora mismo: esperando turno o en el transporte. */
  enVuelo: number;
  /**
   * Los mismos pedidos en vuelo, en el orden en que salieron: si la lectura
   * termina en `subrecurso-pendiente`, el detalle es el primero. No decide
   * nada: lo que decide es `enVuelo`.
   */
  enCamino: Set<{ url: string; tipo: string; origen: OrigenDelPedido }>;
  /** El máximo de pedidos que estuvieron en el transporte A LA VEZ, por presupuesto (SEC-A2). */
  picoConcurrente: { pagina: number; deOtrosSitios: number };
  /** Lo que la página intentó abrir por fuera del interceptor, todo lo que Chromium avisó (F3). */
  salidasPropias: SalidaPropiaVista[];
}

type MotivoDelBloqueo = Bitacora["bloqueados"][number]["motivo"];

/** Un bloqueo que, si el pedido decide, es contenido que no llegó (F2): todo menos un nombre que no existe. */
function esNoLlegada(motivo: MotivoDelBloqueo): motivo is MotivoDeNoLlegada {
  return motivo !== "no-resuelve" && motivo !== "sin-texto";
}

export function nuevaBitacora(): Bitacora {
  return {
    bloqueados: [],
    pedidos: [],
    statusDocumento: null,
    falloDocumento: null,
    noLlegaron: [],
    enVuelo: 0,
    enCamino: new Set(),
    picoConcurrente: { pagina: 0, deOtrosSitios: 0 },
    salidasPropias: [],
  };
}

/**
 * Los tipos de pedido con los que el JavaScript de la página escribe texto en
 * el DOM: el código, los datos que el código trae —también por un
 * `EventSource` (FV-4)—, y un marco (`document` que no es el principal), que
 * puede ser del mismo origen y escribir en él.
 */
const ESCRIBEN_TEXTO = new Set(["script", "xhr", "fetch", "document", "eventsource"]);

/**
 * El sitio de un host, aproximado HACIA ARRIBA: la IP tal cual, o los dos
 * últimos rótulos del nombre (`player.vimeo.com` → `vimeo.com`). Dos marcos
 * que comparten dominio registrable —lo único con lo que `document.domain`
 * los deja tocarse— comparten siempre esos dos rótulos; al revés no
 * (`a.co.uk` y `b.co.uk`), y entonces se los trata como del mismo sitio:
 * se cuentan de más, que empuja a «no medido», nunca a verde (RT-4).
 */
function sitioAproximado(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (ipLiteral(host) !== null) return host;
  return host.split(".").slice(-2).join(".");
}

/** La URL si es `http(s)`; si no lo es, o no es una URL, `null`. */
function urlDeRed(url: string | null): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return ESQUEMAS_DE_RED.has(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

/**
 * El ORIGEN de un worker, leído de la URL de su script, o `null` si no tiene
 * uno de red (W-1). `http(s)` da el suyo; un `blob:` da el que lleva adentro
 * (`blob:https://sitio/<uuid>` → `https://sitio`), que es el de quien lo
 * creó. Un `data:`, un `blob:null/…` (lo creó un contexto de origen opaco),
 * cualquier otro esquema o algo que no es una URL no dicen de quién es: `null`,
 * y el worker cuenta como de la página.
 *
 * Que el script diga el origen de quien creó el worker no es una suposición:
 * `new Worker(url)` exige una URL del MISMO origen que quien lo crea (o un
 * `data:`, que queda opaco), y un `blob:` sólo lo arma su propio origen. Una
 * página no puede crear un worker «de otro sitio» para que no cuente.
 */
function origenDelWorker(url: string | null): URL | null {
  if (!url) return null;
  try {
    const origen = new URL(url).origin;
    return origen === "null" ? null : urlDeRed(origen);
  } catch {
    return null;
  }
}

/**
 * Desde dónde se juzga un pedido con la regla de RT-4: la URL a la que va,
 * si es la navegación de un marco; la de su marco; y sin marco, el origen del
 * worker del que sale (W-1). `null` si no se sabe.
 */
function desdeDonde(pedido: PedidoDelNavegador): URL | null {
  if (pedido.tipo === "document") return urlDeRed(pedido.url);
  if (pedido.urlDelMarco === null) return origenDelWorker(pedido.urlDelWorker);
  return urlDeRed(pedido.urlDelMarco);
}

/**
 * Si el pedido sale de un marco de OTRO SITIO que la página, de un WORKER
 * cuyo script es de otro sitio, o es la navegación de un marco a otro sitio
 * (RT-4, W-1). Ante la duda, `false`: un pedido sin marco y sin un worker con
 * origen de red (`data:`, opaco, o que Chromium no atribuyó), un marco
 * `about:blank`, `blob:` o `srcdoc` —heredan el origen de quien lo creó— y
 * una página que todavía no se conoce cuentan como de la página.
 *
 * La página es `urlDeLaPagina`, el documento CONFIRMADO de la pestaña y no el
 * último pedido de navegación (FV-1, ver el encabezado). Se decide sólo con
 * lo que el pedido trae, sin estado del interceptor.
 */
function deOtroSitio(pedido: PedidoDelNavegador): boolean {
  if (pedido.esDocumentoPrincipal) return false;
  const pagina = urlDeRed(pedido.urlDeLaPagina);
  const desde = desdeDonde(pedido);
  if (pagina === null || desde === null) return false;
  return sitioAproximado(desde.hostname) !== sitioAproximado(pagina.hostname);
}

/**
 * Si un pedido puede cambiar el texto que se cuenta: es de un tipo que lo
 * escribe y sale de un lugar desde el que se puede escribir en la página.
 *
 * `other` SIN marco es el `importScripts` de un worker (MEDIDO con Chrome 155
 * y el headless shell 153, FV-4): el código del worker que trae los datos.
 * Con marco, `other` es, por ejemplo, el `favicon.ico` que Chromium pide por
 * su cuenta, que no escribe nada.
 */
function escribeTexto(pedido: PedidoDelNavegador): boolean {
  if (pedido.esDocumentoPrincipal) return false;
  const escribe = ESCRIBEN_TEXTO.has(pedido.tipo) || (pedido.tipo === "other" && pedido.urlDelMarco === null);
  return escribe && !deOtroSitio(pedido);
}

/**
 * De dónde salió un pedido que `escribeTexto` cuenta (ver `OrigenDelPedido`).
 * Lee lo mismo que `deOtroSitio` y no decide nada: sólo lo nombra.
 */
function origenDelPedido(pedido: PedidoDelNavegador): OrigenDelPedido {
  // La navegación de un marco se juzga por la URL a la que va: si cuenta, va
  // al sitio de la página.
  if (pedido.tipo === "document") return urlDeRed(pedido.urlDeLaPagina) === null ? "marco-desconocido" : "mismo-sitio";
  // Sin marco: si cuenta, es de un worker de la página o de su sitio, o de
  // uno que no se pudo atribuir (W-1).
  if (pedido.urlDelMarco === null) return origenDelWorker(pedido.urlDelWorker) === null ? "sin-origen" : "worker";
  if (urlDeRed(pedido.urlDeLaPagina) === null || urlDeRed(pedido.urlDelMarco) === null) return "marco-desconocido";
  return pedido.urlDelMarco === pedido.urlDeLaPagina ? "pagina" : "mismo-sitio";
}

/**
 * Si un `WebSocket` o `WebTransport` que Chromium avisó DECIDE, con la regla
 * de RT-4, y de dónde salió; `null` si no decide (F3). Cuenta el de un
 * contexto que no se sabe cuál fue, y el de uno cuyo origen no es `http(s)`
 * (un marco con `sandbox` tiene origen `null`, un worker `data:` también); no
 * cuenta el de un contexto de OTRO sitio que la página. El de un worker se
 * juzga por el origen de SU script, como sus pedidos (W-1): el de un worker
 * de un marco de otro sitio no decide, y el de uno de la página sí.
 *
 * Con el origen y no con la URL del marco: un marco del mismo origen que la
 * página sale `pagina`. Es sólo el nombre del detalle, no decide nada.
 */
function juzgarSalidaPropia(salida: SalidaPropiaVista): OrigenDelPedido | null {
  const desde = salida.deUnWorker ? origenDelWorker(salida.urlDelWorker) : urlDeRed(salida.origenDelMarco);
  const pagina = urlDeRed(salida.urlDeLaPagina);
  if (desde === null) return salida.deUnWorker ? "sin-origen" : "marco-desconocido";
  if (pagina === null) return salida.deUnWorker ? "worker" : "marco-desconocido";
  if (sitioAproximado(desde.hostname) !== sitioAproximado(pagina.hostname)) return null;
  if (salida.deUnWorker) return "worker";
  return desde.origin === pagina.origin ? "pagina" : "mismo-sitio";
}

/**
 * Si `host` es del mismo sitio que el documento, para el tope de `POST`
 * ajenos (SEC-A2): el mismo nombre, o un subdominio del documento sin su
 * `www.`. `api.ejemplo.com` es del sitio de `www.ejemplo.com`;
 * `otro.vercel.app` NO es del de `mio.vercel.app`. Nunca se sube de nivel,
 * sólo se baja: al revés que `sitioAproximado`, que aproxima hacia arriba
 * porque allá contar de más empuja a «no medido», y acá un sitio de más sería
 * un relé sin tope. Sin documento confirmado, todo es ajeno.
 */
function mismoSitio(host: string, delDocumento: string | null): boolean {
  if (delDocumento === null) return false;
  const h = host.toLowerCase();
  const d = delDocumento.toLowerCase();
  const base = d.startsWith("www.") ? d.slice(4) : d;
  return h === d || h === base || h.endsWith(`.${base}`);
}

/**
 * El detalle de UN pedido que no llegó. La ruta sale de `pathname`, que no
 * trae ni la query ni el fragmento: una URL firmada o con un token no se
 * copia a la respuesta ni al log.
 */
function detalleDelSubrecurso(
  pedido: { url: string; tipo: string; origen: OrigenDelPedido },
  motivo: MotivoDeSubrecurso,
  noLlegaron: number
): DetalleDelSubrecurso {
  let host = "";
  let ruta = "";
  try {
    const url = new URL(pedido.url);
    host = url.hostname;
    ruta = url.pathname;
  } catch {
    // Sin URL legible no hay ni host ni ruta que decir: el resto vale igual.
  }
  if (ruta.length > MAX_RUTA_DEL_DETALLE) ruta = `${ruta.slice(0, MAX_RUTA_DEL_DETALLE - 1)}…`;
  return { tipo: pedido.tipo, host, ruta, origen: pedido.origen, motivo, noLlegaron };
}

function esDescarga(encabezados: Record<string, string | string[]>): boolean {
  const disposicion = encabezados["content-disposition"];
  const valor = Array.isArray(disposicion) ? disposicion.join(",") : (disposicion ?? "");
  return /^\s*attachment/i.test(valor);
}

/**
 * Atiende UN pedido del navegador: lo deja pasar sin red, lo aborta, o lo hace
 * en Node y le entrega la respuesta. Nunca lo deja colgado: cualquier excepción
 * termina en `abortar()`.
 */
/** Las respuestas que ya se entregaron, por URL, para la pestaña sin JavaScript. */
export type CacheDeRespuestas = Map<
  string,
  { status: number; encabezados: Record<string, string | string[]>; cuerpo: Buffer }
>;

export function crearInterceptor(
  deps: Pick<DependenciasRender, "transporte" | "resolver">,
  opciones: OpcionesRender,
  bitacora: Bitacora,
  restanteMs: () => number,
  senal: AbortSignal,
  examinar: Examinador = crearExaminador(deps.resolver),
  pestana: {
    guardarEn?: CacheDeRespuestas;
    servirDesde?: CacheDeRespuestas;
    /**
     * La pestaña sin JavaScript: sólo el documento. Sin scripts que corran,
     * ningún subrecurso cambia el texto de su DOM —el CSS ya no cuenta, y un
     * marco no está en la serialización del principal—, así que no sale nada
     * más a la red.
     */
    soloDocumento?: boolean;
  } = {}
) {
  // Los dos presupuestos (RT-4): el de la página y el de los marcos de otro
  // sitio. Cada uno con sus bytes, descontados MIENTRAS se baja (RED-121-2):
  // `usados` es lo que ya se bajó, también lo de los pedidos que siguen en
  // vuelo, y sólo crece. Y cada uno con sus topes de SEC-A2 —pedidos a la red,
  // `POST` a otros sitios y turnos en el transporte—, así lo que piden los
  // marcos de otro sitio no le gasta a la página ni los pedidos ni los turnos.
  const nuevaBolsa = (nombre: "pagina" | "deOtrosSitios", tope: number) => ({
    nombre,
    tope,
    usados: 0,
    pedidos: 0,
    postsAjenos: 0,
    enCurso: 0,
    /** Los que esperan un turno en el transporte, en orden. */
    enEspera: [] as Array<() => void>,
  });
  type Bolsa = ReturnType<typeof nuevaBolsa>;
  const bolsas = {
    pagina: nuevaBolsa("pagina", opciones.maxBytesTotales),
    deOtrosSitios: nuevaBolsa("deOtrosSitios", opciones.maxBytesDeOtrosSitios),
  };
  // Si el presupuesto de tiempo vence, los que esperan turno se despiertan
  // para abortarse: nadie queda colgado esperando un turno que no llega.
  senal.addEventListener(
    "abort",
    () => {
      for (const b of Object.values(bolsas)) b.enEspera.splice(0).forEach((despertar) => despertar());
    },
    { once: true }
  );

  /** Un turno en el transporte de esa bolsa, o `false` si el presupuesto de tiempo venció esperándolo. */
  async function tomarTurno(bolsa: Bolsa): Promise<boolean> {
    while (bolsa.enCurso >= opciones.maxConcurrencia && !senal.aborted) {
      await new Promise<void>((despertar) => bolsa.enEspera.push(despertar));
    }
    if (senal.aborted) return false;
    bolsa.enCurso += 1;
    bitacora.picoConcurrente[bolsa.nombre] = Math.max(bitacora.picoConcurrente[bolsa.nombre], bolsa.enCurso);
    return true;
  }

  function soltarTurno(bolsa: Bolsa) {
    bolsa.enCurso -= 1;
    bolsa.enEspera.shift()?.();
  }

  return async function atender(pedido: PedidoDelNavegador): Promise<void> {
    // Si escribe el texto que se cuenta, y si sale de otro sitio (RT-4): se
    // decide UNA vez, al entrar, con lo que el pedido trae. Antes se volvía a
    // juzgar al fallar contra el último pedido de navegación, y un `fetch` de
    // la página que estaba en vuelo cuando la pestaña intentó irse a otro
    // sitio se descartaba al no llegar (FV-1).
    const escribe = escribeTexto(pedido);
    const ajeno = deOtroSitio(pedido);
    // De dónde salió, para el detalle de un fallo: también al entrar.
    const origen = origenDelPedido(pedido);
    // Lo de un marco de otro sitio sale de su propio presupuesto (RT-4). Lo
    // que ESTE pedido ya descontó de su bolsa, y si la bolsa le dijo que no:
    // el transporte llama `tomar` con cada parte del cuerpo que llega, así lo
    // que bajan los pedidos en paralelo sale de la misma cuenta, y no cada
    // uno de lo que veía al salir (RED-121-2).
    const bolsa = ajeno ? bolsas.deOtrosSitios : bolsas.pagina;
    let tomados = 0;
    let sinPresupuesto = false;
    const tomar = (bytes: number): boolean => {
      if (bytes <= 0) return true;
      if (bolsa.usados + bytes > bolsa.tope) {
        sinPresupuesto = true;
        return false;
      }
      bolsa.usados += bytes;
      tomados += bytes;
      return true;
    };
    // Si este pedido ya tiene un desenlace decidido —se bloqueó con su
    // motivo, o se le entregó la respuesta—. Lo que tire ANTES de eso, en el
    // `catch` de abajo, es un pedido que no llegó y nadie anotó (PU-3).
    let decidido = false;
    const bloquear = async (motivo: MotivoDelBloqueo) => {
      decidido = true;
      bitacora.bloqueados.push({ url: pedido.url, motivo });
      // F2: TODO lo que decide y no salió, no llegó —también lo que la
      // política no dejó salir—, salvo un nombre que no existe.
      if (escribe && esNoLlegada(motivo)) {
        bitacora.noLlegaron.push({ url: pedido.url, tipo: pedido.tipo, motivo, origen });
      }
      if (pedido.esDocumentoPrincipal && motivo !== "sin-texto") {
        bitacora.falloDocumento =
          motivo === "presupuesto" ? "timeout" : motivo === "metodo" ? "navegacion" : motivo;
      }
      await pedido.abortar();
    };

    try {
      let url: URL;
      try {
        url = new URL(pedido.url);
      } catch {
        return await bloquear("esquema");
      }

      if (ESQUEMAS_LOCALES.has(url.protocol)) {
        decidido = true;
        return await pedido.continuar();
      }
      if (!ESQUEMAS_DE_RED.has(url.protocol)) return await bloquear("esquema");
      const metodo = pedido.metodo.toUpperCase();
      if (!METODOS.has(metodo)) return await bloquear("metodo");
      if (!pedido.esDocumentoPrincipal && (SIN_TEXTO.has(pedido.tipo) || esReporte(pedido) || pestana.soloDocumento)) {
        return await bloquear("sin-texto");
      }
      if (senal.aborted) return await bloquear("presupuesto");

      // La pestaña sin JavaScript recibe lo MISMO que recibió la primera, sin
      // volver a la red: el examen ya se hizo cuando se pidió.
      const guardada = metodo === "GET" ? pestana.servirDesde?.get(url.toString()) : undefined;
      if (guardada) {
        if (pedido.esDocumentoPrincipal) bitacora.statusDocumento = guardada.status;
        await pedido.responder(guardada);
        decidido = true;
        return;
      }

      const examen = await examinar(url, senal);
      if (!examen.ok) return await bloquear(examen.motivo);

      // SEC-A2: el render no es un relé. Un tope de pedidos por presupuesto, y
      // un `POST` a otro sitio que el documento CONFIRMADO de la pestaña
      // (FV-1) sólo dentro de su propio tope y con un cuerpo acotado. Lo que
      // pasa un tope es `presupuesto`: si el pedido decide, no llegó.
      if (bolsa.pedidos >= opciones.maxPedidos) return await bloquear("presupuesto");
      if (metodo === "POST" && !mismoSitio(url.hostname, urlDeRed(pedido.urlDeLaPagina)?.hostname ?? null)) {
        const largo = Buffer.byteLength(pedido.cuerpo ?? "");
        if (bolsa.postsAjenos >= opciones.maxPostsAjenos || largo > opciones.maxCuerpoAjeno) {
          return await bloquear("presupuesto");
        }
        bolsa.postsAjenos += 1;
      }
      bolsa.pedidos += 1;

      const encabezados: Record<string, string> = {};
      for (const [nombre, valor] of Object.entries(pedido.encabezados)) {
        if (!DEL_SALTO.has(nombre.toLowerCase())) encabezados[nombre.toLowerCase()] = valor;
      }

      // En vuelo desde que pide turno hasta que el navegador lo tiene (o se
      // aborta): la lectura no se da por buena mientras un pedido que decide
      // siga en camino, tampoco si está esperando turno.
      const enCamino = { url: pedido.url, tipo: pedido.tipo, origen };
      if (escribe) {
        bitacora.enVuelo += 1;
        bitacora.enCamino.add(enCamino);
      }
      let turno = false;
      try {
        turno = await tomarTurno(bolsa);
        if (!turno) return await bloquear("presupuesto");
        // El plazo y los bytes, recién con el turno: esperarlo gasta tiempo, y
        // mientras tanto otros pedidos gastaron bytes.
        const plazo = Math.min(opciones.plazoPorPedidoMs, restanteMs());
        const quedan = bolsa.tope - bolsa.usados;
        if (plazo <= 0 || quedan <= 0) return await bloquear("presupuesto");

        bitacora.pedidos.push({ url: pedido.url, ip: examen.ip });
        let respuesta: RespuestaHttp;
        try {
          respuesta = await deps.transporte({
            url: url.toString(),
            ip: examen.ip,
            ...(examen.alternativas ? { alternativas: examen.alternativas } : {}),
            metodo,
            encabezados,
            cuerpo: pedido.cuerpo,
            timeoutMs: plazo,
            maxBytes: Math.min(opciones.maxBytesPorRespuesta, quedan),
            presupuesto: tomar,
          });
        } catch {
          // Un transporte que RECHAZA no trajo nada: es «sin respuesta», con
          // su lugar en `noLlegaron`, y no una excepción que el `catch` de
          // abajo sólo aborta. MEDIDO (PU-3): el `TypeError` de un connect
          // IPv6 sin ruta dejaba fuera de RT-1 al bundle, y el render salía
          // `medido` y VERDE.
          respuesta = { tipo: "error", motivo: "sin-respuesta" };
        }
        await entregar(respuesta, url.toString());
      } finally {
        if (turno) soltarTurno(bolsa);
        if (escribe) {
          bitacora.enVuelo -= 1;
          bitacora.enCamino.delete(enCamino);
        }
      }
    } catch {
      // Un pedido que el interceptor no supo atender NO sale: abortado. Dejarlo
      // colgado frenaría el `load`, y dejarlo seguir sería salir sin examen.
      //
      // Y si escribe texto y no tenía desenlace —tiró el examen, o el
      // navegador no aceptó la respuesta (`responder` tira con un encabezado
      // inválido)—, NO LLEGÓ: se anota, y el render no da número (PU-3).
      if (!decidido && escribe) {
        bitacora.noLlegaron.push({ url: pedido.url, tipo: pedido.tipo, motivo: "sin-respuesta", origen });
      }
      await pedido.abortar().catch(() => {});
    }

    async function entregar(respuesta: RespuestaHttp, clave: string) {
      // Un corte del transporte porque la bolsa no alcanzó es «presupuesto»,
      // no «demasiado-grande»: la respuesta podía caber en su tope propio.
      if (respuesta.tipo === "error") return await bloquear(sinPresupuesto ? "presupuesto" : respuesta.motivo);
      if (esDescarga(respuesta.encabezados)) return await bloquear("descarga");
      // Lo que el transporte no descontó parte por parte —lo que creció al
      // descomprimir, o un transporte que no usa `presupuesto`— se descuenta
      // ahora, y si no alcanza, no se entrega.
      if (!tomar(respuesta.cuerpo.length - tomados)) return await bloquear("presupuesto");

      if (pedido.esDocumentoPrincipal) bitacora.statusDocumento = respuesta.status;

      const devueltos: Record<string, string | string[]> = {};
      for (const [nombre, valor] of Object.entries(respuesta.encabezados)) {
        if (!DE_LA_RESPUESTA.has(nombre.toLowerCase())) devueltos[nombre.toLowerCase()] = valor;
      }
      const entregada = { status: respuesta.status, encabezados: devueltos, cuerpo: respuesta.cuerpo };
      // Sólo el documento: la pestaña sin JavaScript no pide otra cosa
      // (`soloDocumento`), y guardar lo demás —los segmentos de video de un
      // reproductor— era memoria de la función sin uso (F3).
      if (pedido.esDocumentoPrincipal && pedido.metodo.toUpperCase() === "GET") pestana.guardarEn?.set(clave, entregada);
      await pedido.responder(entregada);
      decidido = true;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// La medición
// ─────────────────────────────────────────────────────────────────────────────

function fallo(codigo: CodigoDeFallo): ResultadoRenderizado {
  return { estado: "fallo", codigo };
}

const dormir = (ms: number) => new Promise<void>((listo) => setTimeout(listo, Math.max(ms, 0)));

/**
 * Lee el texto del DOM hasta que su MÁXIMO deje de crecer durante
 * `quietudDomMs`, y devuelve ese máximo. Si el tope llega con el texto todavía
 * creciendo, `inestable`: el número de ese momento es parcial, y un parcial
 * del lado renderizado es un verde inventado.
 */
async function leerCuandoSeQuede(
  pagina: PaginaAbierta,
  opciones: OpcionesRender,
  topeMs: number,
  ahora: () => number,
  esperar: (ms: number) => Promise<void>
): Promise<number | "inestable" | "plazo"> {
  const inicio = ahora();
  let maximo = textoSinJavaScript(await pagina.html());
  let crecioEn = inicio;
  while (ahora() - crecioEn < opciones.quietudDomMs) {
    // Al tope: si el texto creció mientras se miraba, sigue creciendo y el
    // número es parcial; si no creció pero no hubo tiempo de ver una quietud
    // entera, es el presupuesto el que no alcanzó, no la página.
    if (ahora() - inicio >= topeMs) return crecioEn === inicio ? "plazo" : "inestable";
    await esperar(opciones.sondeoMs);
    const n = textoSinJavaScript(await pagina.html());
    if (n > maximo) {
      maximo = n;
      crecioEn = ahora();
    }
  }
  return maximo;
}

/**
 * Espera a `promesa` como mucho `ms`. Al vencer llama `alVencer`, que es lo que
 * CORTA el trabajo de abajo: sin eso, el plazo sólo deja de esperar.
 */
async function conPlazo<T>(promesa: Promise<T>, ms: number, alVencer?: () => void): Promise<T | "plazo"> {
  if (ms <= 0) {
    alVencer?.();
    return "plazo";
  }
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<"plazo">((listo) => {
    reloj = setTimeout(() => {
      alVencer?.();
      listo("plazo");
    }, ms);
  });
  try {
    return await Promise.race([promesa, plazo]);
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Los caracteres de texto del DOM renderizado de `url`, o el motivo por el que
 * no se pudieron medir.
 *
 * `bitacora`, si se pasa, se llena con lo que salió y lo que no: la ruta no la
 * necesita, los tests sí.
 */
export async function medirRenderizado(
  url: string,
  deps: DependenciasRender,
  opciones: OpcionesRender = OPCIONES_RENDER,
  bitacora: Bitacora = nuevaBitacora()
): Promise<ResultadoRenderizado> {
  const ahora = deps.ahora ?? Date.now;
  const esperar = deps.esperar ?? dormir;
  const limite = ahora() + opciones.topeMs;
  const restante = () => limite - ahora();
  const corte = new AbortController();

  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return fallo("esquema");
  }

  // UN examinador para toda la medición: la URL inicial y cada pedido del
  // navegador comparten su caché, así que un nombre se resuelve una sola vez y
  // da la misma dirección de principio a fin. Dos examinadores serían dos
  // consultas DNS, y entre las dos un DNS hostil cambia la respuesta.
  const examinar = crearExaminador(deps.resolver);
  // Lo que la pestaña con JavaScript recibió, para entregárselo igual a la
  // pestaña sin JavaScript.
  const respuestas: CacheDeRespuestas = new Map();

  // La URL inicial se examina ANTES de arrancar nada: un destino prohibido no
  // cuesta un Chromium. El interceptor la vuelve a ver —es un pedido más— y la
  // caché le da la misma respuesta.
  const previo = await conPlazo(examinar(destino, corte.signal), restante(), () => corte.abort());
  if (previo === "plazo") return fallo("timeout");
  if (!previo.ok) return fallo(previo.motivo);

  // En un objeto y no en dos `let`: lo escribe el trabajo y lo lee el
  // `finally`, y así el cierre ve lo que de verdad pasó.
  const vivo: { navegador: NavegadorAbierto | null; arranque: Promise<NavegadorAbierto> | null } = {
    navegador: null,
    arranque: null,
  };

  const trabajo = async (): Promise<ResultadoRenderizado> => {
    try {
      vivo.arranque = deps.abrirNavegador();
      vivo.navegador = await vivo.arranque;
    } catch {
      return fallo("sin-navegador");
    }
    if (corte.signal.aborted) return fallo("timeout");

    try {
      const pagina = await vivo.navegador.nuevaPagina();
      await pagina.interceptar(
        crearInterceptor(deps, opciones, bitacora, restante, corte.signal, examinar, { guardarEn: respuestas })
      );

      try {
        await pagina.navegar(destino.toString(), Math.max(restante(), 1));
      } catch {
        // El motivo que vio el interceptor manda sobre el error de puppeteer:
        // `net::ERR_BLOCKED_BY_CLIENT` no dice si fue una IP privada o un DNS
        // que no contestó, y la bitácora sí.
        if (bitacora.falloDocumento) return fallo(bitacora.falloDocumento);
        return fallo(corte.signal.aborted || restante() <= 0 ? "timeout" : "navegacion");
      }

      await pagina.esperarQuietud(Math.min(opciones.quietudMs, Math.max(restante() - 1_000, 0)));

      // Después de la quietud, y no antes: un script puede mandar la pestaña a
      // otra URL —`location.href = …`— mientras se espera, y ese salto también
      // pasa por el examen. Si lo rechazó, o si contestó 4xx/5xx, lo que se
      // leería es una página de error de Chromium, no el sitio.
      if (bitacora.falloDocumento) return fallo(bitacora.falloDocumento);
      if (bitacora.statusDocumento === null) return fallo("navegacion");
      if (bitacora.statusDocumento >= 400) return fallo(`http_${bitacora.statusDocumento}`);

      // Lo que se dibuja al verse, y lo que llega tarde sin pedir nada a la
      // red: ver «CUÁNDO SE LEE» arriba. El recorrido y la espera salen del
      // mismo presupuesto total, y dejan un segundo para cerrar.
      await pagina.desplazar(Math.min(opciones.desplazarMs, Math.max(restante() - 1_000, 0)));
      const leer = async (): Promise<number | ResultadoRenderizado> => {
        let leidos: number | "inestable" | "plazo";
        try {
          leidos = await leerCuandoSeQuede(
            pagina,
            opciones,
            Math.min(opciones.topeDomMs, Math.max(restante() - 1_000, 0)),
            ahora,
            esperar
          );
        } catch {
          return fallo("lectura");
        }
        if (leidos === "inestable") return fallo("inestable");
        if (leidos === "plazo") return fallo("timeout");
        return leidos;
      };
      let caracteres = await leer();
      if (typeof caracteres !== "number") return caracteres;

      // RT-1: lo que escribe el texto tiene que haber LLEGADO. Lo que sigue en
      // vuelo se espera y se vuelve a leer, mientras quede presupuesto: cada
      // pedido tiene su propio plazo, así que lo que no termina es una página
      // que no deja de pedir, y al acabarse el presupuesto se dice
      // `subrecurso-pendiente`. Una página que pide cada tanto (un sondeo
      // corto) se lee en un momento en que no hay nada en vuelo.
      //
      // Y el fallo dice CUÁL pedido lo decidió: el primero, el mismo que da
      // el código. `noLlegaron` cuenta también los que siguen en vuelo.
      while (bitacora.enVuelo > 0) {
        while (bitacora.enVuelo > 0 && restante() > 1_000) await esperar(opciones.sondeoMs);
        if (bitacora.enVuelo > 0) {
          const primero = bitacora.enCamino.values().next().value;
          const total = bitacora.noLlegaron.length + bitacora.enVuelo;
          return primero
            ? { estado: "fallo", codigo: "subrecurso-pendiente", detalle: detalleDelSubrecurso(primero, "pendiente", total) }
            : fallo("subrecurso-pendiente");
        }
        caracteres = await leer();
        if (typeof caracteres !== "number") return caracteres;
      }
      const perdido = bitacora.noLlegaron[0];
      if (perdido) {
        return {
          estado: "fallo",
          codigo: `subrecurso-${perdido.motivo}`,
          detalle: detalleDelSubrecurso(perdido, perdido.motivo, bitacora.noLlegaron.length),
        };
      }
      // F3: lo que la página intentó abrir sin pasar por el interceptor —un
      // `WebSocket`— nunca conectó, y lo que iba a traer no está en el DOM. Si
      // decide (la regla de RT-4, con el origen que da Chromium), el render no
      // da número, y el detalle dice cuál.
      bitacora.salidasPropias.push(...pagina.salidasPropias());
      const deciden = bitacora.salidasPropias.flatMap((s) => {
        const origen = juzgarSalidaPropia(s);
        return origen === null ? [] : [{ url: s.url, tipo: s.tipo, origen }];
      });
      const propia = deciden[0];
      if (propia) {
        return {
          estado: "fallo",
          codigo: `subrecurso-${propia.tipo}`,
          detalle: detalleDelSubrecurso(propia, propia.tipo, deciden.length),
        };
      }

      // El lado servido, del MISMO documento y con la misma extracción: ver
      // el encabezado. Si no se puede medir, el resultado no se da: un número
      // servido de otro documento (el que trajo la ruta, con otro
      // user-agent) compararía dos páginas que pueden no ser la misma.
      const servida = nuevaBitacora();
      try {
        const sinJs = await vivo.navegador.nuevaPagina({ javascript: false });
        await sinJs.interceptar(
          crearInterceptor(deps, opciones, servida, restante, corte.signal, examinar, {
            servirDesde: respuestas,
            soloDocumento: true,
          })
        );
        await sinJs.navegar(destino.toString(), Math.max(restante(), 1));
        bitacora.pedidos.push(...servida.pedidos);
        // Lo que la pestaña sin JavaScript no pidió a propósito (todo lo que no
        // es el documento) no es un hallazgo: sería ruido en la bitácora.
        bitacora.bloqueados.push(...servida.bloqueados.filter((b) => b.motivo !== "sin-texto"));
        if (servida.falloDocumento || servida.statusDocumento === null || servida.statusDocumento >= 400) {
          return fallo("lectura-servida");
        }
        const servidos = textoSinJavaScript(await sinJs.html());
        return { estado: "medido", caracteres, servidos };
      } catch {
        return fallo(corte.signal.aborted ? "timeout" : "lectura-servida");
      }
    } catch {
      return fallo(corte.signal.aborted ? "timeout" : "navegacion");
    }
  };

  try {
    const resultado = await conPlazo(trabajo(), restante(), () => corte.abort());
    return resultado === "plazo" ? fallo("timeout") : resultado;
  } finally {
    corte.abort();
    // El navegador se cierra SIEMPRE. Si el plazo venció durante el arranque,
    // `vivo.navegador` todavía es null y el arranque sigue en vuelo: se lo
    // espera —con tope— para cerrarlo, en vez de dejar un Chromium huérfano en
    // la función hasta la próxima invocación.
    let abierto = vivo.navegador;
    if (!abierto && vivo.arranque) {
      const tarde = await conPlazo(
        vivo.arranque.catch(() => null),
        opciones.cierreMs
      );
      abierto = tarde === "plazo" ? null : tarde;
    }
    if (abierto) await abierto.cerrar();
  }
}
