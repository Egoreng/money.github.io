/* ============================================================================
   Скинемся — офлайн-кеш (service worker)

   Зачем: index.html сам по себе полностью автономен (ни одного внешнего
   запроса), но чтобы приложение открывалось БЕЗ интернета, браузер должен
   откуда-то взять сам файл. Этим и занимается service worker: при первом
   запуске складывает файлы приложения в Cache Storage и дальше отдаёт их
   оттуда, не спрашивая сеть.

   ВАЖНО: при обновлении файлов на хостинге поднимите VERSION на единицу
   (ниже). Старый кеш при этом удалится сам на этапе activate.
   ========================================================================== */

const VERSION = 'v1';
const CACHE = 'skinemsya-' + VERSION;

/* Всё, без чего приложение не откроется офлайн.
   Пути относительные — работает и в корне сайта, и в подпапке
   (username.github.io/имя-репозитория/). */
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* Каждый файл — отдельно: если какого-то нет на хостинге (или сеть
       недоступна прямо сейчас), установка всё равно должна завершиться,
       иначе приложение вообще не получит кеш. */
    await Promise.all(SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        /* молча пропускаем */
      }
    }));
    /* Сразу активируемся, не доживаясь закрытия всех вкладок. */
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n !== CACHE && n.indexOf('skinemsya-') === 0)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  /* Не GET (например, отправка формы) и чужие домены не трогаем вообще. */
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  const wantsHtml = req.mode === 'navigate' ||
    req.destination === 'document' ||
    ((req.headers.get('accept') || '').indexOf('text/html') !== -1);

  /* --- Навигация (открытие/обновление страницы) ---------------------------
     Сначала сеть: так вы сразу видите новую версию, когда интернет есть.
     Не получилось — отдаём кеш. Это и есть «открывается без интернета». */
  if (wantsHtml) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               (await cache.match(req));
      }
    })());
    return;
  }

  /* --- Остальные файлы ----------------------------------------------------
     Кеш-first: отдаём сохранённое и параллельно обновляем в фоне
     (stale-while-revalidate) — при следующем запуске будет новая версия. */
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) await cache.put(req, fresh.clone());
        } catch (err) { /* офлайн — и не надо */ }
      })());
      return hit;
    }
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') await cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      return (await cache.match('./index.html')) || Response.error();
    }
  })());
});
