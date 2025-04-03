import { util } from '../../common/util.js';
import { lang } from '../../common/language.js';
import { storage } from '../../common/storage.js';
import { request, defaultJSON, HTTP_GET } from '../../connection/request.js';

export const gif = (() => {

    const cacheName = 'gifs';

    const gifDefault = 'default';

    const breakPoint = {
        128: 2,
        256: 3,
        512: 4,
        768: 5,
    };

    /**
     * @type {Map<string, string>|null}
     */
    let urls = null;

    /**
     * @type {Map<string, object>|null}
     */
    let objectPool = null;

    /**
     * @type {Map<string, function>|null}
     */
    let queue = null;

    /**
     * @type {ReturnType<typeof storage>|null}
     */
    let config = null;

    /**
     * @param {string} url
     * @returns {Promise<string>}
     */
    const cache = async (url) => {
        if (urls.has(url)) {
            return urls.get(url);
        }

        /**
        * @param {Cache} c 
        * @param {number} retries
        * @param {number} delay
        * @returns {Promise<Blob>}
        */
        const fetchPut = (c, retries = 3, delay = 1000) => request(HTTP_GET, url)
            .default()
            .then((r) => r.blob().then((b) => c.put(url, new Response(b, { headers: new Headers(r.headers) })).then(() => b)))
            .catch((err) => {
                if (retries <= 0) {
                    throw err;
                }

                console.warn('Retrying fetch:' + url);
                return new Promise((res, rej) => util.timeOut(() => fetchPut(c, retries - 1, delay + 1000).then(res, rej), delay));
            });

        /**
        * @param {Cache} c 
        * @returns {Promise<Blob>}
        */
        const imageCache = (c) => c.match(url).then((res) => {
            if (!res) {
                return fetchPut(c);
            }

            const expiresHeader = res.headers.get('expires');
            const expiresTime = expiresHeader ? (new Date(expiresHeader)).getTime() : 0;

            if (Date.now() > expiresTime) {
                return c.delete(url).then((s) => s ? fetchPut(c) : res.blob());
            }

            return res.blob();
        });

        const res = await caches.open(cacheName)
            .then((c) => imageCache(c))
            .then((b) => URL.createObjectURL(b))
            .then((uri) => {
                urls.set(url, uri);
                return uri;
            });

        return res;
    };

    /**
     * @param {object} ctx
     * @param {object} data
     * @returns {Promise<void>}
     */
    const show = async (ctx, data) => {
        const { id, media_formats: { tinygif: { url } }, content_description: description } = data;

        if (ctx.pointer === -1) {
            ctx.pointer = 0;
        } else if (ctx.pointer === (ctx.col - 1)) {
            ctx.pointer = 0;
        } else {
            ctx.pointer++;
        }

        let k = 0;
        for (const el of ctx.lists.childNodes) {
            if (k === ctx.pointer) {
                await cache(url).then((uri) => {
                    el.insertAdjacentHTML('beforeend', `
                    <figure class="gif-figure m-0 position-relative">
                        <button onclick="undangan.comment.gif.click('${ctx.uuid}', '${id}', '${util.base64Encode(url)}')" class="btn gif-checklist position-absolute justify-content-center align-items-center top-0 end-0 bg-overlay-auto p-1 m-1 rounded-circle border shadow-sm z-1">
                            <i class="fa-solid fa-circle-check"></i>
                        </button>
                        <img src="${uri}" class="img-fluid" alt="${util.escapeHtml(description)}" style="width: 100%;">
                    </figure>`);
                });
                return;
            }
            k++;
        }
    };

    /**
     * @param {object} ctx 
     * @returns {object}
     */
    const loading = (ctx) => {
        const list = ctx.lists;
        const load = document.getElementById(`gif-loading-${ctx.uuid}`);
        const prog = document.getElementById(`progress-bar-${ctx.uuid}`);
        const info = document.getElementById(`progress-info-${ctx.uuid}`);

        let total = 0;
        let loaded = 0;

        if (!list.classList.contains('d-none')) {
            load.classList.replace('d-none', 'd-flex');
        }

        info.innerText = `${loaded}/${total}`;
        list.setAttribute('data-continue', 'false');
        list.classList.replace('overflow-y-scroll', 'overflow-y-hidden');

        const release = () => {
            if (!list.classList.contains('d-none')) {
                load.classList.replace('d-flex', 'd-none');
            }

            prog.style.width = '0%';
            info.innerText = `${loaded}/${total}`;
            list.setAttribute('data-continue', 'true');
            list.classList.replace('overflow-y-hidden', 'overflow-y-scroll');
        };

        /**
         * @param {number} num 
         */
        const until = (num) => {
            total = num;
            info.innerText = `${loaded}/${total}`;
        };

        const step = () => {
            loaded += 1;
            info.innerText = `${loaded}/${total}`;
            prog.style.width = Math.min((loaded / total) * 100, 100).toString() + '%';
        };

        return {
            release,
            until,
            step,
        };
    };

    /**
     * @param {object} ctx
     * @param {string} path 
     * @param {object} params
     * @returns {void}
     */
    const render = (ctx, path, params) => {
        params = {
            media_filter: 'tinygif',
            client_key: 'undangan_app',
            key: config.get('tenor_key'),
            country: lang.getCountry(),
            locale: lang.getLocale(),
            ...(params ?? {}),
        };

        const param = Object.keys(params)
            .filter((k) => params[k] !== null && params[k] !== undefined)
            .map((k) => `${k}=${encodeURIComponent(params[k])}`)
            .join('&');

        const url = `https://tenor.googleapis.com/v2${path}?${param}`;

        const reqCancel = new Promise((r) => {
            ctx.reqs.push(r);
        });

        ctx.last = new Promise((res) => {
            let run = true;

            (async () => {
                await reqCancel;
                run = false;
            })();

            (async () => {
                const load = loading(ctx);

                try {
                    const data = await request(HTTP_GET, url)
                        .withCancel(reqCancel)
                        .default(defaultJSON)
                        .then((r) => r.json())
                        .then((j) => {
                            if (!j.error) {
                                return j;
                            }

                            throw new Error(j.error.message);
                        });

                    if (data.results.length > 0) {

                        ctx.next = data?.next;
                        load.until(data.results.length);

                        for (const el of data.results) {
                            try {
                                if (run) {
                                    ctx.gifs.push(el);
                                    await show(ctx, el);
                                    load.step();
                                }
                            } catch (err) {
                                run = false;
                                throw err;
                            }
                        }
                    }
                } catch (err) {
                    run = false;
                    if (err.name === 'AbortError') {
                        console.warn('Fetch abort:', err);
                    } else {
                        alert(err);
                    }
                } finally {
                    load.release();
                    res();
                }
            })();
        });
    };

    /**
     * @param {string} uuid 
     * @returns {string}
     */
    const template = (uuid) => {
        return `
        <label for="gif-search-${uuid}" class="form-label my-1"><i class="fa-solid fa-photo-film me-2"></i>Gif</label>

        <div class="d-flex mb-3" id="gif-search-nav-${uuid}">
            <button class="btn btn-secondary btn-sm rounded-4 shadow-sm me-1 my-1" onclick="undangan.comment.gif.back(this, '${uuid}')" data-offline-disabled="false"><i class="fa-solid fa-arrow-left"></i></button>
            <input type="text" name="gif-search" id="gif-search-${uuid}" autocomplete="on" class="form-control shadow-sm rounded-4" placeholder="Search for a GIF on Tenor" data-offline-disabled="false">
        </div>

        <div class="position-relative">
            <div class="position-absolute d-flex flex-column justify-content-center align-items-center top-50 start-50 translate-middle w-100 h-100 bg-overlay-auto rounded-4 z-3" id="gif-loading-${uuid}">
                <div class="progress w-25" role="progressbar" style="height: 0.5rem;" aria-label="progress bar">
                    <div class="progress-bar" id="progress-bar-${uuid}" style="width: 0%"></div>
                </div>
                <small class="mt-1 text-theme-auto bg-theme-auto py-0 px-2 rounded-4" id="progress-info-${uuid}" style="font-size: 0.7rem;"></small>
            </div>
            <div id="gif-lists-${uuid}" class="d-flex rounded-4 p-0 overflow-y-scroll border" data-continue="true" style="height: 15rem;"></div>
        </div>

        <figure class="d-flex m-0 position-relative" id="gif-result-${uuid}">
            <button onclick="undangan.comment.gif.cancel('${uuid}')" id="gif-cancel-${uuid}" class="btn d-none position-absolute justify-content-center align-items-center top-0 end-0 bg-overlay-auto p-2 m-1 rounded-circle border shadow-sm z-1">
                <i class="fa-solid fa-circle-xmark"></i>
            </button>
        </figure>`;
    };

    /**
     * @param {object} ctx
     * @returns {Promise<void>}
     */
    const waitLastRequest = async (ctx) => {
        ctx.reqs.forEach((f) => f());
        ctx.reqs = [];

        if (ctx.last) {
            await ctx.last;
            ctx.last = null;
        }
    };

    /**
     * @param {object} ctx
     * @returns {Promise<void>}
     */
    const bootUp = async (ctx) => {
        await waitLastRequest(ctx);

        let last = 0;
        for (const [k, v] of Object.entries(breakPoint)) {
            last = v;
            if (ctx.lists.clientWidth >= parseInt(k)) {
                ctx.col = last;
            }
        }

        if (ctx.col === null) {
            ctx.col = last;
        }

        ctx.pointer = -1;
        ctx.limit = ctx.col * 5;
        ctx.lists.innerHTML = '<div class="d-flex flex-column"></div>'.repeat(ctx.col);

        if (ctx.gifs.length === 0) {
            return;
        }

        const load = loading(ctx);
        load.until(ctx.gifs.length);

        for (const el of ctx.gifs) {
            try {
                await show(ctx, el);
                load.step();
            } catch {
                ctx.gifs = [];
                break;
            }
        }

        load.release();

        // reset if error
        if (ctx.gifs.length === 0) {
            await bootUp(ctx);
        }
    };

    /**
     * @param {object} ctx
     * @returns {Promise<void>}
     */
    const infinite = async (ctx) => {
        if (ctx.lists.getAttribute('data-continue') !== 'true') {
            return;
        }

        // Don't try to load more if there's no next page token
        if (!ctx.next || ctx.next.length === 0) {
            return;
        }

        const isQuery = ctx.query && ctx.query.trim().length > 0;
        const params = { pos: ctx.next, limit: ctx.limit };

        if (isQuery) {
            params.q = ctx.query;
        }

        if (ctx.lists.scrollTop > (ctx.lists.scrollHeight - ctx.lists.clientHeight) * 0.9) {
            await waitLastRequest(ctx);
            render(ctx, isQuery ? '/search' : '/featured', params);
        }
    };

    /**
     * @param {object} ctx
     * @param {string|null} [q=null]
     * @returns {Promise<void>}
     */
    const search = async (ctx, q = null) => {
        ctx.query = q !== null ? q : ctx.query;
        if (!ctx.query || ctx.query.trim().length === 0) {
            ctx.query = null;
        }

        ctx.next = null;
        ctx.gifs = [];
        ctx.pointer = -1;

        await bootUp(ctx);
        render(ctx, ctx.query === null ? '/featured' : '/search', { q: ctx.query, limit: ctx.limit });
    };

    /**
     * @param {string} uuid
     * @returns {{
     *   uuid: string, 
     *   last: Promise<void>|null,
     *   limit: number|null,
     *   query: string|null, 
     *   next: string|null, 
     *   col: number|null, 
     *   pointer: number, 
     *   gifs: object[],
     *   reqs: function[],
     *   lists: HTMLElement, 
     * }}
     */
    const singleton = (uuid) => {
        if (!objectPool.has(uuid)) {

            document.getElementById(`gif-form-${uuid}`).innerHTML = template(uuid);
            objectPool.set(uuid, {
                uuid: uuid,
                last: null,
                limit: null,
                query: null,
                next: null,
                col: null,
                pointer: -1,
                gifs: [],
                reqs: [],
                lists: document.getElementById(`gif-lists-${uuid}`),
            });

            const ctx = objectPool.get(uuid);
            const deBootUp = util.debounce(bootUp, 750);
            const deSearch = util.debounce(search, 750);
            const deScroll = util.debounce(infinite, 250);

            window.addEventListener('resize', () => deBootUp(ctx));
            ctx.lists.addEventListener('scroll', () => deScroll(ctx));
            document.getElementById(`gif-search-${uuid}`).addEventListener('input', (e) => deSearch(ctx, e.target.value));
        }

        return objectPool.get(uuid);
    };

    /**
     * @param {string} uuid
     * @param {string} id
     * @param {string} urlBase64
     * @returns {void}
     */
    const click = (uuid, id, urlBase64) => {
        const res = document.getElementById(`gif-result-${uuid}`);
        res.setAttribute('data-id', id);
        res.querySelector(`#gif-cancel-${uuid}`).classList.replace('d-none', 'd-flex');
        res.insertAdjacentHTML('beforeend', `<img src="${urls.get(util.base64Decode(urlBase64))}" class="img-fluid mx-auto gif-image rounded-4" alt="selected-gif">`);

        objectPool.get(uuid).lists.classList.replace('d-flex', 'd-none');
        document.getElementById(`gif-search-nav-${uuid}`).classList.replace('d-flex', 'd-none');
    };

    /**
     * @param {string} uuid
     * @returns {void} 
     */
    const cancel = (uuid) => {
        const res = document.getElementById(`gif-result-${uuid}`);
        res.removeAttribute('data-id');
        res.querySelector(`#gif-cancel-${uuid}`).classList.replace('d-flex', 'd-none');
        res.querySelector('img').remove();

        objectPool.get(uuid).lists.classList.replace('d-none', 'd-flex');
        document.getElementById(`gif-search-nav-${uuid}`).classList.replace('d-none', 'd-flex');
    };

    /**
     * @param {string|null} uuid 
     * @returns {Promise<void>}
     */
    const remove = async (uuid = null) => {
        if (uuid) {
            if (objectPool.has(uuid)) {
                await waitLastRequest(objectPool.get(uuid));
                objectPool.delete(uuid);
                queue.delete(uuid);
            }
        } else {
            await Promise.all(Array.from(objectPool.keys()).map((k) => waitLastRequest(objectPool.get(k))));
            objectPool.clear();
            queue.clear();
        }
    };

    /**
     * @param {HTMLButtonElement} button
     * @param {string} uuid
     * @returns {Promise<void>} 
     */
    const back = async (button, uuid) => {
        const btn = util.disableButton(button, util.loader.replace('me-1', 'me-0'), true);
        await waitLastRequest(objectPool.get(uuid));
        btn.restore();

        document.getElementById(`gif-form-${uuid}`).classList.toggle('d-none', true);
        document.getElementById(`comment-form-${uuid}`)?.classList.toggle('d-none', false);
    };

    /**
     * @param {string} uuid
     * @returns {Promise<void>} 
     */
    const open = async (uuid) => {
        const ctx = singleton(uuid);

        document.getElementById(`gif-form-${uuid}`).classList.toggle('d-none', false);
        document.getElementById(`comment-form-${uuid}`)?.classList.toggle('d-none', true);

        if (queue.has(uuid)) {
            queue.get(uuid)();
        }

        await search(ctx);
    };

    /**
     * @param {string} uuid 
     * @returns {boolean}
     */
    const isOpen = (uuid) => {
        const container = document.getElementById(`gif-form-${uuid}`);
        return container === null ? false : !container.classList.contains('d-none');
    };

    /**
     * @param {string} uuid 
     * @returns {string|null}
     */
    const getResultId = (uuid) => document.getElementById(`gif-result-${uuid}`)?.getAttribute('data-id');

    /**
     * @param {string} uuid 
     * @returns {void}
     */
    const removeGifSearch = (uuid) => document.querySelector(`[for="gif-search-${uuid}"]`)?.remove();

    /**
     * @param {string} uuid 
     * @returns {void}
     */
    const removeButtonBack = (uuid) => document.querySelector(`[onclick="undangan.comment.gif.back(this, '${uuid}')"]`)?.remove();

    /**
     * @param {string} uuid 
     * @param {function} callback
     * @returns {void}
     */
    const onOpen = (uuid, callback) => queue.set(uuid, callback);

    /**
     * @param {string|null} [uuid=null] 
     * @returns {{ show: function(): void, hide: function(): void, click: function(): void }}
     */
    const buttonCancel = (uuid = null) => {
        const btnCancel = document.getElementById(`gif-cancel-${uuid ? uuid : gifDefault}`);

        return {
            show: () => btnCancel.classList.replace('d-none', 'd-flex'),
            hide: () => btnCancel.classList.replace('d-flex', 'd-none'),
            click: () => btnCancel.dispatchEvent(new Event('click')),
        };
    };

    /**
     * @returns {void}
     */
    const init = () => {
        urls = new Map();
        queue = new Map();
        objectPool = new Map();
        config = storage('config');

        if (config.get('tenor_key') === null) {
            document.querySelector('[onclick="undangan.comment.gif.open(undangan.comment.gif.default)"]')?.remove();
        }
    };

    return {
        default: gifDefault,
        init,
        cache,
        back,
        open,
        cancel,
        click,
        remove,
        isOpen,
        onOpen,
        getResultId,
        buttonCancel,
        removeGifSearch,
        removeButtonBack,
    };
})();